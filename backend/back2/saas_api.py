import pandas as pd
import aiofiles
import os
from dotenv import load_dotenv
load_dotenv()

import io
import uuid
import json
import asyncio
import pickle
import shutil
import numpy as np
import tempfile
import random
import time
from threading import RLock
from scipy.sparse import issparse, save_npz
import jwt
from fastapi import FastAPI, File, UploadFile, Form, Depends, HTTPException, BackgroundTasks, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import or_, desc
from sqlalchemy.orm import Session
from sqlalchemy.exc import OperationalError
from contextlib import asynccontextmanager
from typing import List, Optional, Dict, Any
from kafka.producer import emit_event, emit_event_bg, shutdown_producer, get_kafka_status

from pydantic import BaseModel

import models
import schemas
import database
import httpx
from superagent import InMemorySessionStore, SuperAgent, infer_top_k_from_text
from feature_store import FeatureStore
from vector_store import ProjectVectorStore, get_vector_store, evict_vector_store, to_dense_for_index, FAISS_AVAILABLE
# --- MLflow path-only URI fix: patch registry before mlflow is used so all callers get the wrapper ---
_BACK2_DIR = os.path.dirname(os.path.abspath(__file__))


class InProcessTTLCache:
    def __init__(self, default_ttl_seconds: int = 45, max_entries: int = 1000):
        self.default_ttl_seconds = max(1, int(default_ttl_seconds))
        self.max_entries = max(100, int(max_entries))
        self._data: Dict[str, Any] = {}
        self._lock = RLock()

    def get(self, key: str) -> Optional[Any]:
        now = time.time()
        with self._lock:
            entry = self._data.get(key)
            if not entry:
                return None
            expires_at, value = entry
            if expires_at <= now:
                self._data.pop(key, None)
                return None
            return value

    def set(self, key: str, value: Any, ttl_seconds: Optional[int] = None) -> None:
        ttl = max(1, int(ttl_seconds or self.default_ttl_seconds))
        expires_at = time.time() + ttl
        with self._lock:
            self._data[key] = (expires_at, value)
            if len(self._data) > self.max_entries:
                # Drop oldest expiry entries first to keep cache bounded.
                stale_first = sorted(self._data.items(), key=lambda kv: kv[1][0])[: len(self._data) - self.max_entries]
                for cache_key, _ in stale_first:
                    self._data.pop(cache_key, None)

    def invalidate_prefix(self, prefix: str) -> None:
        with self._lock:
            to_delete = [k for k in self._data.keys() if str(k).startswith(prefix)]
            for k in to_delete:
                self._data.pop(k, None)


class PersistentSuperAgentSessionStore:
    """DB-backed session persistence with in-memory fallback."""

    def __init__(self):
        self._fallback = InMemorySessionStore()

    def get(self, session_id: str) -> Dict[str, Any]:
        sid = str(session_id or "").strip()
        if not sid:
            return {}
        db = database.SessionLocal()
        try:
            row = db.query(models.SuperAgentSession).filter(models.SuperAgentSession.session_id == sid).first()
            if not row:
                return self._fallback.get(sid)
            payload = json.loads(row.payload_json or "{}")
            return payload if isinstance(payload, dict) else {}
        except Exception:
            return self._fallback.get(sid)
        finally:
            db.close()

    def upsert(self, session_id: str, data: Dict[str, Any]) -> None:
        sid = str(session_id or "").strip()
        if not sid:
            return
        incoming = dict(data or {})
        db = database.SessionLocal()
        try:
            row = db.query(models.SuperAgentSession).filter(models.SuperAgentSession.session_id == sid).first()
            prev: Dict[str, Any] = {}
            if row and row.payload_json:
                try:
                    loaded = json.loads(row.payload_json)
                    if isinstance(loaded, dict):
                        prev = loaded
                except Exception:
                    prev = {}
            merged = {**prev, **incoming}
            encoded = json.dumps(merged)
            if row:
                row.payload_json = encoded
            else:
                db.add(models.SuperAgentSession(session_id=sid, payload_json=encoded))
            db.commit()
        except Exception:
            db.rollback()
            self._fallback.upsert(sid, incoming)
        finally:
            db.close()

    def new_session(self) -> str:
        sid = self._fallback.new_session()
        self.upsert(sid, {"created_at_ms": int(time.time() * 1000)})
        return sid


def _path_to_file_uri(path: str) -> str:
    path = os.path.abspath(path)
    if os.name == "nt":
        path = path.replace("\\", "/")
        return "file:///" + path if path[0] != "/" else "file://" + path
    return "file://" + path


def _ensure_file_uri(uri: str) -> str:
    if "://" in uri or uri.startswith("runs:") or uri.startswith("models:"):
        return uri
    path = os.path.normpath(uri)
    if os.name == "nt":
        path = path.replace("\\", "/")
        return "file:///" + path if path and path[0] != "/" else "file://" + path
    return "file://" + path


import mlflow
# --- Import your classes ---
from Content import ContentBasedRecommender
from Collaborative import CollaborativeFilteringRecommender
from ParameterDriven import ParameterDrivenRecommender
# --- Import the MLflow wrapper ---
from dynamic_recommender import MLflowRecommenderWrapper
from datetime import datetime, timezone



def _webhook_service_url():
    return (os.getenv("WEBHOOK_SERVICE_URL") or "http://localhost:3001").rstrip("/")


_webhook_breaker_state = {"failures": 0, "open_until_ts": 0.0}
WEBHOOK_RETRY_ATTEMPTS = int(os.getenv("WEBHOOK_RETRY_ATTEMPTS", "2"))
WEBHOOK_TIMEOUT_SECONDS = float(os.getenv("WEBHOOK_TIMEOUT_SECONDS", "10"))
WEBHOOK_BREAKER_FAILURE_THRESHOLD = int(os.getenv("WEBHOOK_BREAKER_FAILURE_THRESHOLD", "5"))
WEBHOOK_BREAKER_COOLDOWN_SECONDS = int(os.getenv("WEBHOOK_BREAKER_COOLDOWN_SECONDS", "30"))


def _webhook_breaker_open() -> bool:
    return _webhook_breaker_state["open_until_ts"] > time.time()


def _webhook_record_success() -> None:
    _webhook_breaker_state["failures"] = 0
    _webhook_breaker_state["open_until_ts"] = 0.0


def _webhook_record_failure() -> None:
    failures = int(_webhook_breaker_state.get("failures", 0)) + 1
    _webhook_breaker_state["failures"] = failures
    if failures >= WEBHOOK_BREAKER_FAILURE_THRESHOLD:
        _webhook_breaker_state["open_until_ts"] = time.time() + WEBHOOK_BREAKER_COOLDOWN_SECONDS
        _webhook_breaker_state["failures"] = 0


async def _post_with_resilience(client: httpx.AsyncClient, webhook_url: str, payload: Dict[str, Any]) -> bool:
    if _webhook_breaker_open():
        return False
    for attempt in range(1, WEBHOOK_RETRY_ATTEMPTS + 1):
        try:
            res = await client.post(webhook_url, json=payload, timeout=WEBHOOK_TIMEOUT_SECONDS)
            if 200 <= int(res.status_code) < 300:
                _webhook_record_success()
                return True
        except Exception:
            pass
        _webhook_record_failure()
        if attempt < WEBHOOK_RETRY_ATTEMPTS:
            await asyncio.sleep(0.2 * attempt)
    return False


async def notify_webhooks(event_type: str, payload: dict):
    """Send event payload to all registered external apps via the Node webhook service."""
    try:
        base = _webhook_service_url()
        if _webhook_breaker_open():
            print("WARN: webhook circuit breaker open, skipping notify_webhooks")
            return
        async with httpx.AsyncClient() as client:
            res = await client.get(f"{base}/api/apps", timeout=WEBHOOK_TIMEOUT_SECONDS)
            if res.status_code != 200:
                print("WARN: Could not fetch registered apps from webhook service")
                _webhook_record_failure()
                return
            apps = res.json()
            _webhook_record_success()

            for app in apps:
                try:
                    ok = await _post_with_resilience(
                        client,
                        app["webhook_url"],
                        {
                            "event": event_type,
                            "data": payload,
                            "api_key": app["api_key"],
                        },
                    )
                    if ok:
                        print(f"INFO: Notified {app['app_name']} at {app['webhook_url']}")
                    else:
                        print(f"WARN: Skipped {app['app_name']} due to retry/circuit policy")
                except Exception as e:
                    _webhook_record_failure()
                    print(f"ERROR: Failed to send to {app['app_name']}: {e}")
    except Exception as e:
        _webhook_record_failure()
        print(f"ERROR: notify_webhooks failed: {e}")
# --- App Setup & Model Storage ---
# Override with USER_UPLOADS_DIR in .env when deploying (e.g. Docker volume path).
USER_UPLOADS_DIR = os.path.normpath(os.getenv("USER_UPLOADS_DIR") or os.path.join(_BACK2_DIR, "user_uploads"))
os.makedirs(USER_UPLOADS_DIR, exist_ok=True)

# Bundled CSVs for domain agents (parameter-driven training). Repo layout: backend/agent_datasets/
AGENT_DATASETS_DIR = os.path.normpath(os.path.join(os.path.dirname(_BACK2_DIR), "agent_datasets"))

# Preset id -> dataset templates for domain agents.
# If `interaction_csv` is provided, we train HYBRID (content + interactions).
AGENT_PRESETS: Dict[str, Dict[str, Any]] = {
    "logistics_carriers": {
        "content_csv": "logistics_carriers_content.csv",
        "interaction_csv": "logistics_carriers_interactions.csv",
        "domain_slug": "logistics_carriers",
        "description": "Rank carriers from logistics constraints (mode, region, transit, cost, reliability, …).",
        "content_schema": {
            "item_id": "item_id",
            "item_title": "carrier_name",
            "target_column": "carrier_name",
            "feature_cols": [
                "mode",
                "region",
                "country",
                "capacity_type",
                "capacity_unit",
                "avg_transit_days",
                "max_transit_days",
                "min_transit_days",
                "service_level",
                "temperature_controlled",
                "hazardous_capable",
                "tracking_available",
                "carrier_type",
                "certifications",
                "cost_per_kg",
                "cost_per_shipment_base",
                "currency",
                "reliability_score",
                "on_time_pct_typical",
            ],
        },
        "interaction_schema": {"user_id": "user_id", "item_id": "item_id", "rating": "rating"},
    },
    "logistics_lanes": {
        "content_csv": "logistics_lanes_content.csv",
        "interaction_csv": "logistics_lanes_interactions.csv",
        "domain_slug": "logistics_lanes",
        "description": "Rank lanes from origin/destination constraints (mode, distance, transit, customs, …).",
        "content_schema": {
            "item_id": "item_id",
            "item_title": "lane_id",
            "target_column": "lane_id",
            "feature_cols": [
                "origin_region",
                "origin_country",
                "dest_region",
                "dest_country",
                "mode",
                "distance_km",
                "typical_volume_teu",
                "transit_days_typical",
                "avg_cost_per_shipment",
                "customs_required",
            ],
        },
        "interaction_schema": {"user_id": "user_id", "item_id": "item_id", "rating": "rating"},
    },
    "logistics_warehouses": {
        "content_csv": "logistics_warehouses_content.csv",
        "interaction_csv": "logistics_warehouses_interactions.csv",
        "domain_slug": "logistics_warehouses",
        "description": "Rank warehouses from capacity + lead-time + capability constraints.",
        "content_schema": {
            "item_id": "item_id",
            "item_title": "warehouse_id",
            "target_column": "warehouse_id",
            "feature_cols": [
                "country",
                "region",
                "city",
                "capacity_volume_cbm",
                "capacity_pallets",
                "capacity_sqft",
                "temperature_zone",
                "hazmat_capable",
                "lead_time_days_receipt",
                "lead_time_days_ship",
                "last_mile_radius_km",
                "automation_level",
                "capabilities",
            ],
        },
        "interaction_schema": {"user_id": "user_id", "item_id": "item_id", "rating": "rating"},
    },
    "supply_chain_suppliers": {
        "content_csv": "supply_chain_suppliers_content.csv",
        "interaction_csv": "supply_chain_suppliers_interactions.csv",
        "domain_slug": "supply_chain_suppliers",
        "description": "Rank suppliers from supply constraints (category, region, lead time, MOQ, risk, …).",
        "content_schema": {
            "item_id": "item_id",
            "item_title": "supplier_name",
            "target_column": "supplier_name",
            "feature_cols": [
                "category",
                "region",
                "country",
                "lead_time_days",
                "min_order_value",
                "min_order_qty",
                "payment_terms",
                "quality_score",
                "reliability_score",
                "risk_rating",
            ],
        },
        "interaction_schema": {"user_id": "user_id", "item_id": "item_id", "rating": "rating"},
    },
    "supply_chain_materials": {
        "content_csv": "supply_chain_materials_content.csv",
        "interaction_csv": "supply_chain_materials_interactions.csv",
        "domain_slug": "supply_chain_materials",
        "description": "Rank materials from supply constraints (type, grade, lead time, cost, shelf life, …).",
        "content_schema": {
            "item_id": "item_id",
            "item_title": "material_id",
            "target_column": "material_id",
            "feature_cols": [
                "material_type",
                "spec_grade",
                "unit",
                "supplier_id",
                "category",
                "lead_time_days",
                "min_order_qty",
                "price_per_unit",
                "shelf_life_days",
                "substitute_ids",
                "bom_parent_sku",
            ],
        },
        "interaction_schema": {"user_id": "user_id", "item_id": "item_id", "rating": "rating"},
    },
    "supply_chain_skus": {
        "content_csv": "supply_chain_skus_content.csv",
        "interaction_csv": "supply_chain_skus_interactions.csv",
        "domain_slug": "supply_chain_skus",
        "description": "Rank SKUs from inventory constraints (lead time, reorder policy, demand class, cost, …).",
        "content_schema": {
            "item_id": "item_id",
            "item_title": "sku_id",
            "target_column": "sku_id",
            "feature_cols": [
                "category",
                "brand",
                "subcategory",
                "unit",
                "lead_time_days",
                "min_order_qty",
                "reorder_point",
                "safety_stock",
                "weight_kg",
                "volume_cbm",
                "supplier_id",
                "material_ids",
                "abc_class",
                "demand_volatility",
                "price",
                "cost",
            ],
        },
        "interaction_schema": {"user_id": "user_id", "item_id": "item_id", "rating": "rating"},
    },
}


def _upload_search_dirs() -> List[str]:
    """Dirs to search for CSVs when DB has a stale absolute path (another host/container)."""
    raw = os.getenv("USER_UPLOADS_FALLBACK_DIRS", "")
    extra = [os.path.normpath(p.strip()) for p in raw.split(",") if p.strip()]
    seen = set()
    out: List[str] = []
    for p in [USER_UPLOADS_DIR] + extra:
        if p and p not in seen and os.path.isdir(p):
            seen.add(p)
            out.append(p)
    return out


def _resolve_uploaded_file_path(file: models.UploadedFile, db: Optional[Session] = None) -> Optional[str]:
    """
    Return a path to the uploaded CSV on this machine. Updates DB if the file is found under
    USER_UPLOADS_DIR (or fallbacks) by basename while the stored path points elsewhere.
    """
    if not file or not (file.storage_path or "").strip():
        return None
    stored = str(file.storage_path).strip()
    if os.path.isfile(stored):
        return stored
    base = os.path.basename(stored.replace("\\", "/"))
    for d in _upload_search_dirs():
        cand = os.path.join(d, base)
        if os.path.isfile(cand):
            if cand != stored and db is not None:
                file.storage_path = cand
                db.commit()
            return cand
    orig = (file.original_filename or "").strip()
    if orig:
        suffix = "_" + orig.replace("\\", "/").split("/")[-1]
        matches: List[str] = []
        for d in _upload_search_dirs():
            try:
                for name in os.listdir(d):
                    if name.endswith(suffix):
                        matches.append(os.path.join(d, name))
            except OSError:
                continue
        if len(matches) == 1:
            cand = matches[0]
            if cand != stored and db is not None:
                file.storage_path = cand
                db.commit()
            return cand
    return None
# Save models to a local directory (avoids MLflow artifact store and Windows path issues).
PROJECT_MODELS_DIR = os.path.join(_BACK2_DIR, "project_models")
os.makedirs(PROJECT_MODELS_DIR, exist_ok=True)
# --- END CONFIG ---

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Server starting...")
    if not os.getenv("JWT_SECRET"):
        print("WARNING: JWT_SECRET not set in backend/back2/.env. Set it (same value as auth service) or project list will return 500 and users will see no projects.")
    try:
        database.create_db_and_tables()
        print("Database tables created.")
    except Exception as e:
        print(f"WARNING: Could not connect to database. Server will start but project/recommendation APIs will fail. Error: {e}")
        print("  Check DATABASE_URL in .env and network (PostgreSQL/Neon required).")
        if "could not translate host name" in str(e) or "Name or service not known" in str(e):
            print("  → DNS cannot resolve the Neon host. Try: Neon dashboard → Connection string → use 'Direct' (non-pooler) URL, or check network/VPN/DNS (e.g. 8.8.8.8).")
    try:
        yield
    finally:
        await shutdown_producer()
        print("Server shutting down.")

app = FastAPI(lifespan=lifespan)
_cors_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "http://localhost:8000",
    "http://localhost:3001",
]
if os.getenv("CORS_ORIGINS"):
    _cors_origins.extend(o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip())
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {
        "ok": True,
        "service": "ml-backend",
        "docs": "/docs",
        "kafka_status": "/kafka/status",
    }


@app.get("/health")
def health():
    return {"ok": True, "service": "ml-backend"}

@app.exception_handler(OperationalError)
def handle_db_unavailable(request: Request, exc: OperationalError):
    """Return 503 with a clear message when DB (Neon/PostgreSQL) is unreachable."""
    return JSONResponse(
        status_code=503,
        content={
            "detail": "Database unavailable. Check DATABASE_URL in backend/back2/.env and ensure Neon/PostgreSQL is reachable (network, DNS)."
        },
    )

# --- Auth: JWT from auth service, or X-Internal-Key for server-to-server (webhook service) ---
BACK2_INTERNAL_KEY = os.getenv("BACK2_INTERNAL_KEY", "")

def get_current_user_id(
    authorization: Optional[str] = Header(None, alias="Authorization"),
    x_internal_key: Optional[str] = Header(None, alias="X-Internal-Key"),
) -> int:
    # Server-to-server: webhook service calls with X-Internal-Key to get recommendations without user JWT
    if BACK2_INTERNAL_KEY and x_internal_key and x_internal_key.strip() == BACK2_INTERNAL_KEY:
        return -1
    secret = os.getenv("JWT_SECRET")
    if not secret:
        raise HTTPException(
            status_code=500,
            detail="JWT_SECRET not configured. Set it in backend/back2/.env (same value as auth service) for user-wise projects.",
        )
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization header")
    token = authorization[7:].strip()
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
        user_id = payload.get("id")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        return int(user_id)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# =========================
# SuperAgent (MVP) – define AFTER auth dependency
# =========================
_superagent_sessions = PersistentSuperAgentSessionStore()
_superagent = SuperAgent(session_store=_superagent_sessions)


class SuperAgentChatRequest(BaseModel):
    session_id: Optional[str] = None
    message: str
    target_domain: Optional[str] = None
    context: Dict[str, Any] = {}
    n: int = 10


class SuperAgentChatResponse(BaseModel):
    session_id: str
    status: str  # "clarify" | "ok"
    target_domain: Optional[str] = None
    used_context: Dict[str, Any] = {}
    question: Optional[Dict[str, Any]] = None
    results: Optional[List[Dict[str, Any]]] = None


@app.post("/superagent/v1/chat", response_model=SuperAgentChatResponse)
async def superagent_chat(
    req: SuperAgentChatRequest,
    background_tasks: BackgroundTasks,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    session_id = (req.session_id or "").strip() or _superagent_sessions.new_session()
    prev = _superagent_sessions.get(session_id)
    explicit_domain = req.target_domain or prev.get("target_domain")
    # Persisted constraints from earlier turns + optional JSON body from client; message overrides keys.
    base_ctx: Dict[str, Any] = {**(prev.get("context") or {}), **(req.context or {})}

    target_domain, merged_context = _superagent.parse(req.message, explicit_domain, base_ctx)
    inferred_k = infer_top_k_from_text(req.message)
    n = int(inferred_k) if inferred_k and 1 <= int(inferred_k) <= 50 else int(req.n or 10)
    clarify = _superagent.need_clarification(target_domain)
    if clarify:
        _superagent_sessions.upsert(
            session_id, {"last_user_message": req.message, "context": merged_context}
        )
        return SuperAgentChatResponse(
            session_id=session_id,
            status="clarify",
            target_domain=None,
            used_context=merged_context,
            question={"key": clarify.key, "prompt": clarify.prompt, "options": clarify.options},
            results=None,
        )

    # Persist domain; context is saved after we normalise (below) once we have a concrete project.
    _superagent_sessions.upsert(session_id, {"target_domain": target_domain})

    # If user asked "best X" but provided no constraints, ask a follow-up instead of falling back
    # to "most frequent targets" (which looks like static/first rows).
    if not merged_context:
        picked = _auto_pick_projects_for_domains(
            db=db,
            current_user_id=current_user_id,
            domains=[str(target_domain)],
        )
        pid = picked.get(str(target_domain))
        suggestions: List[str] = []
        if pid:
            try:
                inner = get_project_context_options(project_id=int(pid), current_user_id=current_user_id, db=db)
                suggestions = [
                    fc.name
                    for fc in (inner.feature_columns or [])
                    if fc and getattr(fc, "name", None) and str(fc.name) != "mean_rating"
                ][:12]
            except Exception:
                suggestions = []

        _superagent_sessions.upsert(session_id, {"target_domain": str(target_domain)})
        return SuperAgentChatResponse(
            session_id=session_id,
            status="clarify",
            target_domain=str(target_domain),
            used_context={},
            question={
                "key": "constraints",
                "prompt": (
                    f"To recommend {target_domain}, tell me what constraints matter (key=value). "
                    "Pick a constraint to start, or type something like: mode=road, region=North"
                ),
                "options": suggestions or None,
            },
            results=None,
        )

    picked_sa = _auto_pick_projects_for_domains(
        db=db,
        current_user_id=current_user_id,
        domains=[str(target_domain)],
    )
    pid_sa = picked_sa.get(str(target_domain))
    if pid_sa:
        merged_context = normalize_context_to_project_columns(
            db=db,
            current_user_id=current_user_id,
            project_id=int(pid_sa),
            context=merged_context,
        )
    _superagent_sessions.upsert(session_id, {"target_domain": str(target_domain), "context": merged_context})

    pred = await agent_single_recommend(
        req=AgentSingleRecommendRequest(
            correlation_id=f"superagent-{session_id}",
            context=merged_context,
            n=n,
            target_domain=str(target_domain),
            item_title=None,
            user_id=None,
        ),
        background_tasks=background_tasks,
        current_user_id=current_user_id,
        db=db,
    )

    results_payload = pred.get("results") if isinstance(pred, dict) else None

    if results_payload:
        first_block = results_payload[0] if isinstance(results_payload[0], dict) else {}
        first_recs = first_block.get("recommendations") or []
        preview = []
        for r in first_recs[:5]:
            if isinstance(r, dict):
                preview.append({"item_id": r.get("id"), "title": r.get("title"), "score": r.get("score")})
            else:
                preview.append({"item_id": None, "title": str(r), "score": None})

        recommendation_count = sum(
            len((block or {}).get("recommendations") or [])
            for block in results_payload
            if isinstance(block, dict)
        )

        background_tasks.add_task(emit_event_bg, {
            "event_type": "recommendation_served",
            "source_service": "fastapi-recommender",
            "api_route": "/superagent/v1/chat",
            "project_id": first_block.get("project_id"),
            "user_id": None,
            "_raw_api_key": None,
            "recommendation_count": recommendation_count,
            "recommendations_preview": preview,
            "metadata": {
                "session_id": session_id,
                "target_domain": str(target_domain),
            },
        })

    return SuperAgentChatResponse(
        session_id=session_id,
        status="ok",
        target_domain=str(target_domain),
        used_context=merged_context,
        question=None,
        results=results_payload,
    )

def get_next_project_id(db: Session) -> int:
    """Return the smallest positive integer not used as project id (reuse deleted ids)."""
    used = {row[0] for row in db.query(models.RecommenderProject.id).all()}
    candidate = 1
    while candidate in used:
        candidate += 1
    return candidate


def get_project_for_user(project_id: int, user_id: int, db: Session):
    """Return project only if it belongs to user (or legacy owner_id 0/None, or service user -1); else 404."""
    db_project = db.query(models.RecommenderProject).filter(
        models.RecommenderProject.id == project_id
    ).first()
    if not db_project:
        raise HTTPException(status_code=404, detail="Project not found.")
    if user_id == -1:
        return db_project  # internal key (webhook service)
    if db_project.owner_id is None or db_project.owner_id == 0:
        return db_project  # legacy: any authenticated user can access
    if db_project.owner_id != user_id:
        raise HTTPException(status_code=404, detail="Project not found.")
    return db_project


def _ensure_serving_control(db: Session, project_id: int) -> models.ServingControl:
    ctrl = db.query(models.ServingControl).filter(models.ServingControl.project_id == project_id).first()
    if ctrl:
        return ctrl
    ctrl = models.ServingControl(project_id=project_id)
    db.add(ctrl)
    db.commit()
    db.refresh(ctrl)
    return ctrl


def _get_champion_entry(db: Session, project_id: int) -> Optional[models.ModelRegistryEntry]:
    return (
        db.query(models.ModelRegistryEntry)
        .filter(
            models.ModelRegistryEntry.project_id == project_id,
            models.ModelRegistryEntry.role == models.ModelRegistryRole.CHAMPION.value,
            models.ModelRegistryEntry.retired_at.is_(None),
        )
        .order_by(desc(models.ModelRegistryEntry.version))
        .first()
    )


def _get_latest_challenger_entry(db: Session, project_id: int) -> Optional[models.ModelRegistryEntry]:
    return (
        db.query(models.ModelRegistryEntry)
        .filter(
            models.ModelRegistryEntry.project_id == project_id,
            models.ModelRegistryEntry.role == models.ModelRegistryRole.CHALLENGER.value,
            models.ModelRegistryEntry.retired_at.is_(None),
        )
        .order_by(desc(models.ModelRegistryEntry.version))
        .first()
    )


def _register_model_version(
    *,
    db: Session,
    db_project: models.RecommenderProject,
    model_path: str,
    metrics: Optional[Dict[str, Any]] = None,
) -> models.ModelRegistryEntry:
    last_version = (
        db.query(models.ModelRegistryEntry)
        .filter(models.ModelRegistryEntry.project_id == db_project.id)
        .order_by(desc(models.ModelRegistryEntry.version))
        .first()
    )
    next_version = int(last_version.version) + 1 if last_version else 1
    existing_champion = _get_champion_entry(db, db_project.id)
    role = models.ModelRegistryRole.CHAMPION.value if existing_champion is None else models.ModelRegistryRole.CHALLENGER.value
    now_utc = datetime.now(timezone.utc)

    row = models.ModelRegistryEntry(
        project_id=db_project.id,
        owner_id=db_project.owner_id,
        model_type=str(db_project.model_type) if db_project.model_type is not None else None,
        version=next_version,
        role=role,
        model_path=model_path,
        metrics_json=json.dumps(metrics or {}),
        promoted_at=now_utc if role == models.ModelRegistryRole.CHAMPION.value else None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _sync_live_model_path_from_entry(project_id: int, entry: models.ModelRegistryEntry) -> None:
    live_path = os.path.join(PROJECT_MODELS_DIR, f"project_{project_id}")
    if not entry or not entry.model_path:
        return
    if not os.path.isdir(entry.model_path):
        return
    if os.path.isdir(live_path):
        shutil.rmtree(live_path)
    shutil.copytree(entry.model_path, live_path)


def _run_prediction_for_model(
    *,
    model_path: str,
    model_type: Any,
    context: Dict[str, Any],
    item_title: Optional[str],
    user_id: Optional[str],
    n: int,
) -> Dict[str, Any]:
    if not os.path.isdir(model_path):
        raise HTTPException(status_code=404, detail="Model not found. Re-train the project.")

    reserved = {"user_id", "item_title", "n"}
    feature_context = {k: v for k, v in (context or {}).items() if k not in reserved and v is not None and str(v).strip()}
    model_uri = _path_to_file_uri(model_path)

    started = time.perf_counter()
    model = mlflow.pyfunc.load_model(model_uri)

    if model_type in (models.ModelType.PARAMETER_DRIVEN, models.ModelType.HYBRID):
        row: Dict[str, Any] = {**feature_context, "n": n}
        if item_title:
            row["item_title"] = item_title
        model_input = pd.DataFrame([row])
    else:
        if model_type == models.ModelType.CONTENT and not item_title:
            raise HTTPException(status_code=400, detail="item_title is required for this content-based model.")
        if model_type == models.ModelType.COLLABORATIVE and not user_id:
            raise HTTPException(status_code=400, detail="user_id is required for this collaborative model.")
        model_input = pd.DataFrame([{"user_id": user_id, "item_title": item_title, "n": n}])

    result_json = model.predict(model_input)[0]
    latency_ms = (time.perf_counter() - started) * 1000.0
    result = json.loads(result_json)
    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])

    recs = result.get("recommendations")
    if recs is None or not isinstance(recs, list):
        recs = []

    return {
        "recommendations": recs,
        "latency_ms": round(float(latency_ms), 3),
    }

# --- Helper function (Unchanged) ---
async def save_file_and_schema(
    db: Session,
    project_id: int,
    file: UploadFile,
    schema_json: str,
    file_type: models.FileType
) -> models.UploadedFile:
    
    storage_filename = f"{uuid.uuid4()}_{file.filename}"
    storage_path = os.path.join(USER_UPLOADS_DIR, storage_filename)
    
    async with aiofiles.open(storage_path, 'wb') as out_file:
        content = await file.read()
        await out_file.write(content)
        
    db_file = models.UploadedFile(
        project_id=project_id,
        original_filename=file.filename,
        storage_path=storage_path,
        file_type=file_type
    )
    db.add(db_file)
    db.commit()
    db.refresh(db_file)
    
    try:
        schema_map = json.loads(schema_json)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail=f"Invalid schema JSON for {file_type} file.")
    
    for app_key, user_col in schema_map.items():
        if isinstance(user_col, list):
            for col in user_col:
                db_schema = models.SchemaMapping(
                    app_schema_key='feature_col',
                    user_csv_column=col,
                    file_id=db_file.id,
                )
                db.add(db_schema)
        else:
            db_schema = models.SchemaMapping(
                app_schema_key=app_key,
                user_csv_column=user_col,
                file_id=db_file.id,
            )
            db.add(db_schema)

    db.commit()
    return db_file


async def _create_parameter_driven_project_from_upload(
    *,
    background_tasks: BackgroundTasks,
    current_user_id: int,
    db: Session,
    project_name: str,
    content_file: UploadFile,
    content_schema: Dict[str, Any],
) -> models.RecommenderProject:
    """Create a single-file parameter-driven project and queue training (same pipeline as /create-project/)."""
    content_schema_json = json.dumps(content_schema)
    next_id = get_next_project_id(db)
    db_project = models.RecommenderProject(
        id=next_id,
        owner_id=current_user_id,
        project_name=project_name,
        status=models.ProjectStatus.PENDING,
        model_type=models.ModelType.PARAMETER_DRIVEN,
    )
    db.add(db_project)
    db.commit()
    db.refresh(db_project)
    try:
        await save_file_and_schema(db, db_project.id, content_file, content_schema_json, models.FileType.CONTENT)
    except Exception as e:
        db_project.status = models.ProjectStatus.ERROR
        db.commit()
        raise HTTPException(status_code=500, detail=f"Error processing files: {e}")
    background_db = database.SessionLocal()
    background_tasks.add_task(process_project, db_project.id, background_db)
    db.refresh(db_project)
    return db_project


async def _create_hybrid_project_from_uploads(
    *,
    background_tasks: BackgroundTasks,
    current_user_id: int,
    db: Session,
    project_name: str,
    content_file: UploadFile,
    interaction_file: UploadFile,
    content_schema: Dict[str, Any],
    interaction_schema: Dict[str, Any],
) -> models.RecommenderProject:
    """Create a HYBRID project (content + interactions) and queue training."""
    content_schema_json = json.dumps(content_schema)
    interaction_schema_json = json.dumps(interaction_schema)
    next_id = get_next_project_id(db)
    db_project = models.RecommenderProject(
        id=next_id,
        owner_id=current_user_id,
        project_name=project_name,
        status=models.ProjectStatus.PENDING,
        model_type=models.ModelType.HYBRID,
    )
    db.add(db_project)
    db.commit()
    db.refresh(db_project)
    try:
        await save_file_and_schema(
            db, db_project.id, content_file, content_schema_json, models.FileType.CONTENT
        )
        await save_file_and_schema(
            db, db_project.id, interaction_file, interaction_schema_json, models.FileType.INTERACTION
        )
    except Exception as e:
        db_project.status = models.ProjectStatus.ERROR
        db.commit()
        raise HTTPException(status_code=500, detail=f"Error processing files: {e}")

    background_db = database.SessionLocal()
    background_tasks.add_task(process_project, db_project.id, background_db)
    db.refresh(db_project)
    return db_project


# --- Background Task for Model Training (Updated) ---

async def process_project(project_id: int, db: Session):
    """
    Background task to train models from Content.py and Collaborative.py
    and register them with MLflow.
    """
    print(f"[Task {project_id}]: Started processing...")
    db_project = None
    try:
        db_project = db.query(models.RecommenderProject).filter(models.RecommenderProject.id == project_id).first()
        if not db_project:
            raise Exception("Project not found in DB.")

        db_project.status = models.ProjectStatus.PROCESSING
        db.commit()

        # --- Load files and schemas (Unchanged) ---
        files = db_project.uploaded_files
        content_file = next((f for f in files if f.file_type == models.FileType.CONTENT), None)
        interaction_file = next((f for f in files if f.file_type == models.FileType.INTERACTION), None)

        df_content, df_interaction = None, None
        content_schema, interaction_schema = {}, {}
        all_schemas_map = {} 
        
        if content_file:
            cpath = _resolve_uploaded_file_path(content_file, db)
            if not cpath:
                raise Exception(
                    f"Content CSV not found on disk (stored {content_file.storage_path!r}). "
                    f"Copy the file to {USER_UPLOADS_DIR!r} as {os.path.basename(str(content_file.storage_path))!r} or re-upload."
                )
            df_content = pd.read_csv(cpath, low_memory=False)
            content_schema = {s.app_schema_key: s.user_csv_column for s in content_file.schema_mappings if s.app_schema_key != 'feature_col' and (s.user_csv_column or '').strip()}
            content_schema['feature_cols'] = [s.user_csv_column for s in content_file.schema_mappings if s.app_schema_key == 'feature_col' and (s.user_csv_column or '').strip()]
            if 'target_column' not in content_schema:
                content_schema['target_column'] = next((s.user_csv_column for s in content_file.schema_mappings if s.app_schema_key == 'target_column' and (s.user_csv_column or '').strip()), None)
            # If target_column set but no feature_cols (single-dataset simple flow), use all other columns
            if content_schema.get('target_column') and not content_schema.get('feature_cols'):
                content_schema['feature_cols'] = [c for c in df_content.columns if c != content_schema['target_column']]
            all_schemas_map['content'] = content_schema

        if interaction_file:
            ipath = _resolve_uploaded_file_path(interaction_file, db)
            if not ipath:
                raise Exception(
                    f"Interaction CSV not found on disk (stored {interaction_file.storage_path!r}). "
                    f"Copy the file to {USER_UPLOADS_DIR!r} as {os.path.basename(str(interaction_file.storage_path))!r} or re-upload."
                )
            df_interaction = pd.read_csv(ipath)
            schema_map = {s.app_schema_key: s.user_csv_column for s in interaction_file.schema_mappings}
            if schema_map.get('user_id'):
                df_interaction[schema_map['user_id']] = df_interaction[schema_map['user_id']].astype(str)
            if schema_map.get('item_id'):
                df_interaction[schema_map['item_id']] = df_interaction[schema_map['item_id']].astype(str)
            interaction_schema = schema_map
            all_schemas_map['interaction'] = interaction_schema
            
        # Ensure content item_ids are strings if they exist
        if df_content is not None and 'item_id' in content_schema:
            df_content[content_schema['item_id']] = df_content[content_schema['item_id']].astype(str)


        model_type = db_project.model_type
        print(f"[Task {project_id}]: Building model of type: {model_type}")

        # --- Placeholders for vector-store + feature-store materialisation ---
        _vec_items_ids: List[Any] = []
        _vec_items_mat = None
        _vec_users_ids: List[Any] = []
        _vec_users_mat = None
        _fs_item_rows: List[Dict[str, Any]] = []
        _fs_user_rows: List[Dict[str, Any]] = []

        # --- Artifacts will be saved here ---
        with tempfile.TemporaryDirectory() as tmpdir:
            artifacts = {}
            
            # --- Save model_type config (Unchanged) ---
            model_type_config_path = os.path.join(tmpdir, "model_type.json")
            with open(model_type_config_path, 'w') as f:
                json.dump({"model_type": model_type, "schemas": all_schemas_map}, f)
            artifacts["model_type_config"] = model_type_config_path
            
            # --- Train Parameter-Driven Model (single dataset, target + feature columns) ---
            if model_type == models.ModelType.PARAMETER_DRIVEN:
                if not content_schema.get("target_column"):
                    raise ValueError("Parameter-driven model requires target_column in the content schema.")
                if not content_schema.get("feature_cols"):
                    content_schema["feature_cols"] = [c for c in df_content.columns if c != content_schema["target_column"]]
                if not content_schema.get("feature_cols"):
                    raise ValueError("Dataset has no columns besides the target. Add at least one other column.")
                print(f"[Task {project_id}]: Fitting ParameterDrivenRecommender...")
                pd_recommender = ParameterDrivenRecommender()
                pd_recommender.fit(df_content, content_schema)
                artifacts["pd_transformer"] = os.path.join(tmpdir, "pd_transformer.pkl")
                if issparse(pd_recommender.feature_matrix_):
                    artifacts["pd_feature_matrix"] = os.path.join(tmpdir, "pd_feature_matrix.npz")
                    save_npz(artifacts["pd_feature_matrix"], pd_recommender.feature_matrix_)
                else:
                    artifacts["pd_feature_matrix"] = os.path.join(tmpdir, "pd_feature_matrix.npy")
                    np.save(artifacts["pd_feature_matrix"], pd_recommender.feature_matrix_)
                artifacts["pd_data"] = os.path.join(tmpdir, "pd_data.csv")
                with open(artifacts["pd_transformer"], "wb") as f:
                    pickle.dump(pd_recommender.column_transformer, f)
                pd_recommender.df.to_csv(artifacts["pd_data"], index=False)
                print(f"[Task {project_id}]: Saved Parameter-driven model artifacts.")
                # Collect for vector-store + feature-store
                _dense = to_dense_for_index(pd_recommender.feature_matrix_)
                if _dense is not None:
                    _vec_items_ids = pd_recommender.df[pd_recommender.target_col].astype(str).tolist()
                    _vec_items_mat = _dense
                for _, _row in pd_recommender.df.iterrows():
                    _feat = {c: str(_row[c]) for c in pd_recommender.feature_cols if c in _row.index and str(_row.get(c, "")) not in ("", "nan", "None")}
                    _feat["item_id"] = str(_row[pd_recommender.target_col])
                    _fs_item_rows.append(_feat)

            # --- Train Content-Based Model (content-only; hybrid uses ParameterDriven) ---
            if model_type == models.ModelType.CONTENT:
                if not content_schema.get('feature_cols'):
                    raise ValueError("Content model requires at least one feature column mapped in the content file schema.")
                if not content_schema.get('item_id') or not content_schema.get('item_title'):
                    raise ValueError("Content schema must have both item_id and item_title mapped.")
                print(f"[Task {project_id}]: Fitting ContentBasedRecommender...")
                cb_recommender = ContentBasedRecommender()
                cb_recommender.fit(df_content, content_schema)
                artifacts["cb_cosine_sim"] = os.path.join(tmpdir, "cb_cosine_sim.pkl")
                artifacts["cb_indices"] = os.path.join(tmpdir, "cb_indices.pkl")
                artifacts["cb_data"] = os.path.join(tmpdir, "cb_data.csv")
                with open(artifacts["cb_cosine_sim"], 'wb') as f: pickle.dump(cb_recommender.cosine_sim, f)
                with open(artifacts["cb_indices"], 'wb') as f: pickle.dump(cb_recommender.indices, f)
                cb_recommender.df.to_csv(artifacts["cb_data"], index=False)
                print(f"[Task {project_id}]: Saved Content model artifacts.")
                # Collect for vector-store + feature-store
                if cb_recommender.tfidf_matrix is not None:
                    _dense = to_dense_for_index(cb_recommender.tfidf_matrix)
                    if _dense is not None:
                        _vec_items_ids = cb_recommender.df[content_schema["item_id"]].astype(str).tolist()
                        _vec_items_mat = _dense
                _feat_cols = content_schema.get("feature_cols") or []
                for _, _row in cb_recommender.df.iterrows():
                    _feat = {c: str(_row[c]) for c in _feat_cols if c in _row.index and str(_row.get(c, "")) not in ("", "nan", "None")}
                    _feat["item_id"] = str(_row[content_schema["item_id"]])
                    _fs_item_rows.append(_feat)

            # --- Train Hybrid: join Dataset1 (content) + Dataset2 (ratings) on common key, then ParameterDriven ---
            # Hybrid = recommendations by selected features from dataset 1 + selected rating from dataset 2.
            if model_type == models.ModelType.HYBRID:
                if not content_schema.get("item_id") or content_schema["item_id"] not in df_content.columns:
                    raise ValueError("Hybrid content schema must have item_id (the common key to link both datasets).")
                if "item_id" not in interaction_schema or "rating" not in interaction_schema:
                    raise ValueError("Hybrid ratings file schema must have item_id and rating.")
                if interaction_schema["item_id"] not in df_interaction.columns or interaction_schema["rating"] not in df_interaction.columns:
                    raise ValueError("Ratings file must contain the item_id and rating columns.")
                # Align types for join
                content_key = content_schema["item_id"]
                ratings_key = interaction_schema["item_id"]
                rating_col = interaction_schema["rating"]
                df_content[content_key] = df_content[content_key].astype(str)
                df_interaction[ratings_key] = df_interaction[ratings_key].astype(str)
                # Aggregate ratings per item (mean)
                ratings_agg = df_interaction.groupby(ratings_key)[rating_col].mean().reset_index()
                ratings_agg = ratings_agg.rename(columns={rating_col: "mean_rating", ratings_key: content_key})
                # Join: every content row gets mean_rating (left join)
                df_joined = df_content.merge(ratings_agg, on=content_key, how="left")
                df_joined["mean_rating"] = df_joined["mean_rating"].fillna(df_joined["mean_rating"].mean() if df_joined["mean_rating"].notna().any() else 0)
                # Target: what to recommend (e.g. item title or item_id)
                target_col = content_schema.get("target_column") or content_schema.get("item_title") or content_schema.get("item_id")
                content_feature_cols = content_schema.get("feature_cols") or [c for c in df_content.columns if c != target_col and c != content_key]
                if not content_feature_cols:
                    content_feature_cols = [c for c in df_content.columns if c != target_col]
                hybrid_feature_cols = [c for c in content_feature_cols if c in df_joined.columns] + ["mean_rating"]
                if not hybrid_feature_cols:
                    raise ValueError("Hybrid needs at least one feature from content or mean_rating.")
                hybrid_schema = {
                    "target_column": target_col,
                    "feature_cols": hybrid_feature_cols,
                    "item_id": content_key,
                    "item_title": content_schema.get("item_title") or target_col,
                }
                print(f"[Task {project_id}]: Fitting Hybrid (joined data + ParameterDriven)...")
                pd_recommender = ParameterDrivenRecommender()
                pd_recommender.fit(df_joined, hybrid_schema)
                artifacts["pd_transformer"] = os.path.join(tmpdir, "pd_transformer.pkl")
                if issparse(pd_recommender.feature_matrix_):
                    artifacts["pd_feature_matrix"] = os.path.join(tmpdir, "pd_feature_matrix.npz")
                    save_npz(artifacts["pd_feature_matrix"], pd_recommender.feature_matrix_)
                else:
                    artifacts["pd_feature_matrix"] = os.path.join(tmpdir, "pd_feature_matrix.npy")
                    np.save(artifacts["pd_feature_matrix"], pd_recommender.feature_matrix_)
                artifacts["pd_data"] = os.path.join(tmpdir, "pd_data.csv")
                with open(artifacts["pd_transformer"], "wb") as f:
                    pickle.dump(pd_recommender.column_transformer, f)
                pd_recommender.df.to_csv(artifacts["pd_data"], index=False)
                artifacts["cb_data"] = os.path.join(tmpdir, "cb_data.csv")
                df_joined.to_csv(artifacts["cb_data"], index=False)
                print(f"[Task {project_id}]: Saved Hybrid (joined content+ratings, ParameterDriven) artifacts.")
                # Collect for vector-store + feature-store
                _dense = to_dense_for_index(pd_recommender.feature_matrix_)
                if _dense is not None:
                    _vec_items_ids = pd_recommender.df[pd_recommender.target_col].astype(str).tolist()
                    _vec_items_mat = _dense
                for _, _row in pd_recommender.df.iterrows():
                    _feat = {c: str(_row[c]) for c in pd_recommender.feature_cols if c in _row.index and str(_row.get(c, "")) not in ("", "nan", "None")}
                    _feat["item_id"] = str(_row[pd_recommender.target_col])
                    _fs_item_rows.append(_feat)

            # --- Train Collaborative Filtering Model ---
            if model_type == models.ModelType.COLLABORATIVE:
                print(f"[Task {project_id}]: Fitting CollaborativeFilteringRecommender...")
                cf_recommender = CollaborativeFilteringRecommender(n_components=50)
                cf_recommender.fit(df_interaction, interaction_schema)
                
                # Define and save CF artifacts
                artifacts["cf_user_features"] = os.path.join(tmpdir, "cf_user_features.npy")
                artifacts["cf_item_features"] = os.path.join(tmpdir, "cf_item_features.npy")
                artifacts["cf_user_means"] = os.path.join(tmpdir, "cf_user_means.pkl")
                artifacts["cf_item_ids"] = os.path.join(tmpdir, "cf_item_ids.pkl")
                artifacts["cf_user_ids"] = os.path.join(tmpdir, "cf_user_ids.pkl")
                artifacts["cf_pivot"] = os.path.join(tmpdir, "cf_pivot.pkl")

                np.save(artifacts["cf_user_features"], cf_recommender.user_features)
                np.save(artifacts["cf_item_features"], cf_recommender.item_features)
                with open(artifacts["cf_user_means"], 'wb') as f: pickle.dump(cf_recommender.user_means, f)
                with open(artifacts["cf_item_ids"], 'wb') as f: pickle.dump(cf_recommender.item_ids, f)
                with open(artifacts["cf_user_ids"], 'wb') as f: pickle.dump(cf_recommender.user_ids, f)
                with open(artifacts["cf_pivot"], 'wb') as f: pickle.dump(cf_recommender.original_ratings_pivot, f)
                print(f"[Task {project_id}]: Saved Collaborative model artifacts.")
                # Collect for vector-store + feature-store
                _vec_users_ids = [str(u) for u in cf_recommender.user_ids.tolist()]
                _vec_users_mat = cf_recommender.user_features.astype("float32")
                _vec_items_ids = [str(i) for i in cf_recommender.item_ids.tolist()]
                _vec_items_mat = cf_recommender.item_features.T.astype("float32")
                for _uid, _mean in cf_recommender.user_means.items():
                    _fs_user_rows.append({"user_id": str(_uid), "mean_rating": float(_mean)})

            # --- Save content data for pure collaborative model (for lookups) ---
            if model_type == models.ModelType.COLLABORATIVE and df_content is not None:
                 artifacts["cb_data"] = os.path.join(tmpdir, "cb_data.csv")
                 df_content.to_csv(artifacts["cb_data"], index=False)
                 print(f"[Task {project_id}]: Saved Content data for Collaborative title lookups.")


            model_name = f"project-{project_id}-recommender"
            # Save model to local directory (avoids MLflow artifact store / Windows path issues).
            saved_model_path = os.path.join(PROJECT_MODELS_DIR, f"project_{project_id}")
            if os.path.isdir(saved_model_path):
                shutil.rmtree(saved_model_path)
            # Use absolute code_paths so training works when PM2/uvicorn runs from a different cwd (e.g. on server).
            _code_paths = [
                os.path.join(_BACK2_DIR, "dynamic_recommender.py"),
                os.path.join(_BACK2_DIR, "Content.py"),
                os.path.join(_BACK2_DIR, "Collaborative.py"),
                os.path.join(_BACK2_DIR, "Hybrid.py"),
                os.path.join(_BACK2_DIR, "ParameterDriven.py"),
            ]
            mlflow.pyfunc.save_model(
                path=saved_model_path,
                python_model=MLflowRecommenderWrapper(),
                artifacts=artifacts,
                code_paths=_code_paths,
            )
            print(f"[Task {project_id}]: Model saved to {saved_model_path}")

            # Snapshot trained model as an immutable registry version.
            registry_project_dir = os.path.join(PROJECT_MODELS_DIR, "registry", f"project_{project_id}")
            os.makedirs(registry_project_dir, exist_ok=True)
            last_reg = (
                db.query(models.ModelRegistryEntry)
                .filter(models.ModelRegistryEntry.project_id == project_id)
                .order_by(desc(models.ModelRegistryEntry.version))
                .first()
            )
            snapshot_version = int(last_reg.version) + 1 if last_reg else 1
            snapshot_path = os.path.join(registry_project_dir, f"v{snapshot_version}")
            if os.path.isdir(snapshot_path):
                shutil.rmtree(snapshot_path)
            shutil.copytree(saved_model_path, snapshot_path)

            # --- Build Vector Store indexes ---
            try:
                evict_vector_store(project_id)
                vec_index_dir = os.path.join(saved_model_path, "vector_index")
                vstore = ProjectVectorStore(vec_index_dir)
                if _vec_items_ids and _vec_items_mat is not None:
                    ok = vstore.build_items_index(_vec_items_ids, _vec_items_mat)
                    print(f"[Task {project_id}]: Vector store items index built ({len(_vec_items_ids)} items). ok={ok}")
                if _vec_users_ids and _vec_users_mat is not None:
                    ok = vstore.build_users_index(_vec_users_ids, _vec_users_mat)
                    print(f"[Task {project_id}]: Vector store users index built ({len(_vec_users_ids)} users). ok={ok}")
            except Exception as _ve:
                print(f"[Task {project_id}]: Vector store build error (non-fatal): {_ve}")

            # --- Materialise Feature Store (delete first so bulk insert is idempotent) ---
            try:
                if _fs_item_rows or _fs_user_rows:
                    FeatureStore.delete_project_features(db, project_id)
                if _fs_item_rows:
                    _written = FeatureStore.bulk_upsert_item_features(db, project_id, _fs_item_rows)
                    print(f"[Task {project_id}]: Feature store materialised {_written} item rows.")
                if _fs_user_rows:
                    _written = FeatureStore.bulk_upsert_user_features(db, project_id, _fs_user_rows)
                    print(f"[Task {project_id}]: Feature store materialised {_written} user rows.")
            except Exception as _fe:
                print(f"[Task {project_id}]: Feature store materialisation error (non-fatal): {_fe}")

        # --- Update Project in DB ---
        db_project.mlflow_model_name = model_name
        db_project.mlflow_model_version = snapshot_version
        db_project.status = models.ProjectStatus.READY
        db.commit()

        reg_entry = _register_model_version(
            db=db,
            db_project=db_project,
            model_path=snapshot_path,
            metrics={
                "trained_at": datetime.now(timezone.utc).isoformat(),
                "project_status": str(db_project.status),
                "model_type": str(db_project.model_type),
            },
        )

        if str(reg_entry.role) == models.ModelRegistryRole.CHALLENGER.value:
            champion = _get_champion_entry(db, project_id)
            if champion and os.path.isdir(champion.model_path):
                _sync_live_model_path_from_entry(project_id, champion)
                print(f"[Task {project_id}]: New challenger v{reg_entry.version} stored; champion v{champion.version} kept live.")
        else:
            print(f"[Task {project_id}]: Model version v{reg_entry.version} set as champion.")

        _ensure_serving_control(db, project_id)
        print(f"[Task {project_id}]: Processing complete.")

        # --- Send Kafka event for training completion ---
        try:
            event_id = await emit_event({
                "event_type": "training_completed",
                "source_service": "fastapi-recommender",
                "api_route": "/agent/v1/train-preset",
                "project_id": db_project.id,
                "user_id": db_project.owner_id if db_project.owner_id != -1 else None,
                "metadata": {
                    "project_name": db_project.project_name,
                    "model_type": str(db_project.model_type),
                    "mlflow_model_name": db_project.mlflow_model_name,
                },
            })
            if event_id:
                print(f"[Task {project_id}]: Emitted Kafka event for training completion (event_id={event_id}).")
            else:
                print(f"[Task {project_id}]: Kafka event was not emitted (producer unavailable or validation failed).")
        except Exception as event_err:
            print(f"[Task {project_id}]: Failed to emit Kafka event - {event_err}")

        # --- Send webhook notification ---
        try:
            await notify_webhooks("model_ready", {
                "project_id": db_project.id,
                "project_name": db_project.project_name,
                "model_type": db_project.model_type,
                "timestamp": str(datetime.utcnow()),
            })
        except Exception as notify_err:
            print(f"[Task {project_id}]: Failed to notify webhooks - {notify_err}")

    except Exception as e:
        import traceback
        print(f"[Task {project_id}]: ERROR processing project. {e}")
        traceback.print_exc()
        if db_project:
            db_project.status = models.ProjectStatus.ERROR
            db.commit()
    finally:
        db.close()

@app.post("/create-project/", response_model=schemas.RecommenderProject)
async def create_project(
    background_tasks: BackgroundTasks,
    current_user_id: int = Depends(get_current_user_id),
    project_name: str = Form(...),
    content_file: UploadFile = File(None),
    content_schema_json: str = Form(None),
    interaction_file: UploadFile = File(None),
    interaction_schema_json: str = Form(None),
    db: Session = Depends(database.get_db)
):
    if not content_file and not interaction_file:
        raise HTTPException(status_code=400, detail="At least one file (content or interaction) must be provided.")
    if content_file and not content_schema_json:
        raise HTTPException(status_code=400, detail="Content schema is required if content file is provided.")
    if interaction_file and not interaction_schema_json:
        raise HTTPException(status_code=400, detail="Interaction schema is required if interaction file is provided.")

    model_type = None
    if content_file and interaction_file:
        model_type = models.ModelType.HYBRID
    elif interaction_file:
        model_type = models.ModelType.COLLABORATIVE
    elif content_file:
        # Single dataset: parameter-driven if schema has target_column
        try:
            content_schema = json.loads(content_schema_json)
            if content_schema.get("target_column"):
                model_type = models.ModelType.PARAMETER_DRIVEN  # feature_cols optional (default: all other columns)
            else:
                model_type = models.ModelType.CONTENT
        except (json.JSONDecodeError, TypeError):
            model_type = models.ModelType.CONTENT

    next_id = get_next_project_id(db)
    db_project = models.RecommenderProject(
        id=next_id,
        owner_id=current_user_id,
        project_name=project_name,
        status=models.ProjectStatus.PENDING,
        model_type=model_type
    )
    db.add(db_project)
    db.commit()
    db.refresh(db_project)
    
    try:
        if content_file:
            await save_file_and_schema(db, db_project.id, content_file, content_schema_json, models.FileType.CONTENT)
        if interaction_file:
            await save_file_and_schema(db, db_project.id, interaction_file, interaction_schema_json, models.FileType.INTERACTION)
    except Exception as e:
        db_project.status = models.ProjectStatus.ERROR
        db.commit()
        raise HTTPException(status_code=500, detail=f"Error processing files: {e}")

    background_db = database.SessionLocal()
    background_tasks.add_task(process_project, db_project.id, background_db)
    
    db.refresh(db_project)
    return db_project


@app.post("/project/{project_id}/retrain")
def retrain_project(
    project_id: int,
    background_tasks: BackgroundTasks,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    """Retrain the model using the project's existing dataset and schema. No need to re-upload files."""
    db_project = get_project_for_user(project_id, current_user_id, db)
    if not db_project.uploaded_files:
        raise HTTPException(status_code=400, detail="Project has no uploaded files. Cannot retrain.")
    db_project.status = models.ProjectStatus.PROCESSING
    db.commit()
    background_db = database.SessionLocal()
    background_tasks.add_task(process_project, project_id, background_db)
    return {"message": "Retrain started.", "status": "processing"}


@app.get("/projects/", response_model=List[schemas.RecommenderProject])
def get_projects(
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    if current_user_id == -1:
        raise HTTPException(status_code=401, detail="Internal key cannot list projects.")
    # Own projects + legacy (owner_id 0 or None) so re-login still sees previously created projects
    projects = db.query(models.RecommenderProject).filter(
        or_(
            models.RecommenderProject.owner_id == current_user_id,
            models.RecommenderProject.owner_id.is_(None),
            models.RecommenderProject.owner_id == 0,
        )
    ).all()
    return projects


@app.get("/kafka/status")
def kafka_status():
    return get_kafka_status()


class ServingControlsUpdateRequest(BaseModel):
    shadow_enabled: Optional[bool] = None
    shadow_percentage: Optional[int] = None
    latency_warn_ms: Optional[int] = None


@app.get("/project/{project_id}/model-registry")
def get_project_model_registry(
    project_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    get_project_for_user(project_id, current_user_id, db)
    rows = (
        db.query(models.ModelRegistryEntry)
        .filter(models.ModelRegistryEntry.project_id == project_id)
        .order_by(desc(models.ModelRegistryEntry.version))
        .all()
    )
    return {
        "project_id": project_id,
        "entries": [
            {
                "id": int(r.id),
                "version": int(r.version),
                "role": str(r.role),
                "model_type": r.model_type,
                "model_path": r.model_path,
                "metrics": json.loads(r.metrics_json or "{}"),
                "created_at": r.created_at,
                "promoted_at": r.promoted_at,
                "retired_at": r.retired_at,
            }
            for r in rows
        ],
    }


@app.post("/project/{project_id}/model-registry/{entry_id}/promote")
def promote_model_version(
    project_id: int,
    entry_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    get_project_for_user(project_id, current_user_id, db)
    target = (
        db.query(models.ModelRegistryEntry)
        .filter(models.ModelRegistryEntry.id == entry_id, models.ModelRegistryEntry.project_id == project_id)
        .first()
    )
    if not target:
        raise HTTPException(status_code=404, detail="Model version not found for project.")
    if target.retired_at is not None:
        raise HTTPException(status_code=400, detail="Cannot promote a retired version.")
    if not os.path.isdir(target.model_path):
        raise HTTPException(status_code=400, detail="Model path for this version is missing on disk.")

    current_champion = _get_champion_entry(db, project_id)
    now_utc = datetime.now(timezone.utc)
    if current_champion and current_champion.id != target.id:
        current_champion.role = models.ModelRegistryRole.RETIRED.value
        current_champion.retired_at = now_utc

    target.role = models.ModelRegistryRole.CHAMPION.value
    target.promoted_at = now_utc
    target.retired_at = None

    # Keep non-promoted active versions as challengers.
    active_others = (
        db.query(models.ModelRegistryEntry)
        .filter(
            models.ModelRegistryEntry.project_id == project_id,
            models.ModelRegistryEntry.id != target.id,
            models.ModelRegistryEntry.retired_at.is_(None),
            models.ModelRegistryEntry.role != models.ModelRegistryRole.RETIRED.value,
        )
        .all()
    )
    for row in active_others:
        row.role = models.ModelRegistryRole.CHALLENGER.value

    db.commit()
    _sync_live_model_path_from_entry(project_id, target)
    return {"project_id": project_id, "champion_version": int(target.version), "status": "promoted"}


@app.post("/project/{project_id}/model-registry/{entry_id}/retire")
def retire_model_version(
    project_id: int,
    entry_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    get_project_for_user(project_id, current_user_id, db)
    target = (
        db.query(models.ModelRegistryEntry)
        .filter(models.ModelRegistryEntry.id == entry_id, models.ModelRegistryEntry.project_id == project_id)
        .first()
    )
    if not target:
        raise HTTPException(status_code=404, detail="Model version not found for project.")
    if str(target.role) == models.ModelRegistryRole.CHAMPION.value:
        raise HTTPException(status_code=400, detail="Cannot retire champion directly. Promote another version first.")
    target.role = models.ModelRegistryRole.RETIRED.value
    target.retired_at = datetime.now(timezone.utc)
    db.commit()
    return {"project_id": project_id, "version": int(target.version), "status": "retired"}


@app.get("/project/{project_id}/serving-controls")
def get_serving_controls(
    project_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    get_project_for_user(project_id, current_user_id, db)
    ctrl = _ensure_serving_control(db, project_id)
    return {
        "project_id": project_id,
        "shadow_enabled": bool(ctrl.shadow_enabled),
        "shadow_percentage": int(ctrl.shadow_percentage or 0),
        "latency_warn_ms": int(ctrl.latency_warn_ms or 0),
    }


@app.put("/project/{project_id}/serving-controls")
def update_serving_controls(
    project_id: int,
    body: ServingControlsUpdateRequest,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    get_project_for_user(project_id, current_user_id, db)
    ctrl = _ensure_serving_control(db, project_id)
    if body.shadow_enabled is not None:
        ctrl.shadow_enabled = bool(body.shadow_enabled)
    if body.shadow_percentage is not None:
        if body.shadow_percentage < 0 or body.shadow_percentage > 100:
            raise HTTPException(status_code=400, detail="shadow_percentage must be between 0 and 100")
        ctrl.shadow_percentage = int(body.shadow_percentage)
    if body.latency_warn_ms is not None:
        if body.latency_warn_ms < 1:
            raise HTTPException(status_code=400, detail="latency_warn_ms must be >= 1")
        ctrl.latency_warn_ms = int(body.latency_warn_ms)
    db.commit()
    db.refresh(ctrl)
    return {
        "project_id": project_id,
        "shadow_enabled": bool(ctrl.shadow_enabled),
        "shadow_percentage": int(ctrl.shadow_percentage or 0),
        "latency_warn_ms": int(ctrl.latency_warn_ms or 0),
    }


@app.get("/project/{project_id}/serving-metrics")
def get_serving_metrics(
    project_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    get_project_for_user(project_id, current_user_id, db)
    ctrl = _ensure_serving_control(db, project_id)
    champion = _get_champion_entry(db, project_id)
    challenger = _get_latest_challenger_entry(db, project_id)
    return {
        "project_id": project_id,
        "champion_version": champion.version if champion else None,
        "challenger_version": challenger.version if challenger else None,
        "champion_latency_ms": ctrl.champion_latency_ms,
        "challenger_latency_ms": ctrl.challenger_latency_ms,
        "shadow_request_count": int(ctrl.shadow_request_count or 0),
        "shadow_error_count": int(ctrl.shadow_error_count or 0),
        "last_request_at": ctrl.last_request_at,
    }

@app.get("/project/{project_id}/status", response_model=schemas.RecommenderProject)
def get_project_status(
    project_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    db_project = get_project_for_user(project_id, current_user_id, db)
    return db_project


@app.delete("/project/{project_id}")
def delete_project(
    project_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    db_project = get_project_for_user(project_id, current_user_id, db)
    for f in db_project.uploaded_files:
        resolved = _resolve_uploaded_file_path(f, db=None)
        if resolved and os.path.isfile(resolved):
            try:
                os.remove(resolved)
            except OSError:
                pass
    db.delete(db_project)
    db.query(models.ModelRegistryEntry).filter(models.ModelRegistryEntry.project_id == project_id).delete()
    db.query(models.ServingControl).filter(models.ServingControl.project_id == project_id).delete()
    db.commit()
    evict_vector_store(project_id)
    try:
        registry_project_dir = os.path.join(PROJECT_MODELS_DIR, "registry", f"project_{project_id}")
        if os.path.isdir(registry_project_dir):
            shutil.rmtree(registry_project_dir)
    except Exception:
        pass
    try:
        FeatureStore.delete_project_features(db, project_id)
    except Exception:
        pass
    return {"message": "Project deleted."}


# =============================================================================
# Vector Store endpoints
# =============================================================================

@app.get("/project/{project_id}/vector-store/status")
def vector_store_status(
    project_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    """Return index statistics for a project's vector store."""
    get_project_for_user(project_id, current_user_id, db)
    vstore = get_vector_store(project_id, PROJECT_MODELS_DIR)
    return vstore.status()


@app.get("/project/{project_id}/vector-store/similar-items")
def vector_store_similar_items(
    project_id: int,
    item_id: str,
    n: int = 10,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    """
    Return the top-n items whose embeddings are most similar to *item_id*.
    Uses the FAISS index built at training time.
    """
    get_project_for_user(project_id, current_user_id, db)
    if not FAISS_AVAILABLE:
        raise HTTPException(status_code=501, detail="faiss-cpu is not installed. Run: pip install faiss-cpu")
    vstore = get_vector_store(project_id, PROJECT_MODELS_DIR)
    results = vstore.search_similar_items(item_id, k=max(1, min(n, 100)))
    return {"project_id": project_id, "item_id": item_id, "similar_items": results}


@app.get("/project/{project_id}/vector-store/similar-users")
def vector_store_similar_users(
    project_id: int,
    user_id: str,
    n: int = 10,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    """
    Return the top-n users whose embeddings are most similar to *user_id*.
    Only available for collaborative / hybrid projects.
    """
    get_project_for_user(project_id, current_user_id, db)
    if not FAISS_AVAILABLE:
        raise HTTPException(status_code=501, detail="faiss-cpu is not installed. Run: pip install faiss-cpu")
    vstore = get_vector_store(project_id, PROJECT_MODELS_DIR)
    results = vstore.search_similar_users(user_id, k=max(1, min(n, 100)))
    return {"project_id": project_id, "user_id": user_id, "similar_users": results}


# =============================================================================
# Feature Store endpoints
# =============================================================================

@app.get("/project/{project_id}/feature-store/items")
def feature_store_list_items(
    project_id: int,
    limit: int = 100,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    """List item feature rows materialised for this project (capped at *limit*)."""
    get_project_for_user(project_id, current_user_id, db)
    rows = FeatureStore.list_item_features(db, project_id, limit=max(1, min(limit, 2000)))
    return {"project_id": project_id, "count": len(rows), "items": rows}


@app.get("/project/{project_id}/feature-store/users")
def feature_store_list_users(
    project_id: int,
    limit: int = 100,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    """List user feature rows materialised for this project (capped at *limit*)."""
    get_project_for_user(project_id, current_user_id, db)
    rows = FeatureStore.list_user_features(db, project_id, limit=max(1, min(limit, 2000)))
    return {"project_id": project_id, "count": len(rows), "users": rows}


@app.get("/project/{project_id}/feature-store/item/{item_id}")
def feature_store_get_item(
    project_id: int,
    item_id: str,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    """Return the stored feature bag for a single item."""
    get_project_for_user(project_id, current_user_id, db)
    feats = FeatureStore.get_item_features(db, project_id, item_id)
    if feats is None:
        raise HTTPException(status_code=404, detail=f"No features found for item '{item_id}' in project {project_id}.")
    return {"project_id": project_id, "item_id": item_id, "features": feats}


@app.get("/project/{project_id}/feature-store/user/{user_id}")
def feature_store_get_user(
    project_id: int,
    user_id: str,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    """Return the stored feature bag for a single user."""
    get_project_for_user(project_id, current_user_id, db)
    feats = FeatureStore.get_user_features(db, project_id, user_id)
    if feats is None:
        raise HTTPException(status_code=404, detail=f"No features found for user '{user_id}' in project {project_id}.")
    return {"project_id": project_id, "user_id": user_id, "features": feats}


class UserFeaturesUpdateRequest(BaseModel):
    features: Dict[str, Any]


@app.post("/project/{project_id}/feature-store/user/{user_id}")
def feature_store_update_user(
    project_id: int,
    user_id: str,
    body: UserFeaturesUpdateRequest,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    """
    Upsert a user's feature bag.  Use this as a lightweight feedback-loop hook:
    after a click/rating event, push updated signals (e.g. avg_rating, last_category)
    so the next recommendation call can read fresh user context.
    """
    get_project_for_user(project_id, current_user_id, db)
    FeatureStore.upsert_user_features(db, project_id, user_id, body.features)
    return {"project_id": project_id, "user_id": user_id, "status": "updated"}


def get_project_data(project_id: int, user_id: int, db: Session, file_type: models.FileType):
    db_project = get_project_for_user(project_id, user_id, db)
    if db_project.status != models.ProjectStatus.READY:
        raise HTTPException(status_code=400, detail="Project is not ready.")
    
    file = next((f for f in db_project.uploaded_files if f.file_type == file_type), None)
    if not file:
        raise HTTPException(status_code=404, detail=f"{file_type} file not found for this project.")

    path = _resolve_uploaded_file_path(file, db)
    if not path:
        raise HTTPException(
            status_code=404,
            detail=(
                "Uploaded CSV file is missing from disk for this project. "
                "The database may point to another machine (shared Neon DB) or an old folder. "
                f"Stored path: {file.storage_path!r}. "
                f"Expected CSV basename: {os.path.basename(os.path.normpath(str(file.storage_path or '')))!r} "
                f"under {USER_UPLOADS_DIR!r}, or set USER_UPLOADS_DIR / USER_UPLOADS_FALLBACK_DIRS in .env. "
                "Otherwise re-upload the project or create a new project with the same CSVs."
            ),
        )

    df = pd.read_csv(path, low_memory=False)
    schema = {s.app_schema_key: s.user_csv_column for s in file.schema_mappings}
    return df, schema

# Max items/users returned for dropdowns (keeps response and UI fast)
ITEMS_USERS_LIMIT = 2000
API_CACHE_TTL_SECONDS = int(os.getenv("API_CACHE_TTL_SECONDS", "45"))
_api_cache = InProcessTTLCache(default_ttl_seconds=API_CACHE_TTL_SECONDS, max_entries=1500)


def _cache_key(namespace: str, payload: Dict[str, Any]) -> str:
    safe_payload = payload or {}
    return f"{namespace}:{json.dumps(safe_payload, sort_keys=True, default=str)}"


def _resolve_target_column_and_values(df: pd.DataFrame, content_schema: dict) -> tuple:
    """Return (target_column_name, list of distinct values) for the column the model recommends. Handles column name mismatch (case-insensitive)."""
    target_col = content_schema.get("target_column") or content_schema.get("item_title") or content_schema.get("item_id")
    if not target_col or not isinstance(target_col, str):
        return ("", [])
    target_col = target_col.strip()
    # Resolve column: exact match, then case-insensitive
    if target_col in df.columns:
        col = target_col
    else:
        lower_map = {c.strip().lower(): c for c in df.columns if isinstance(c, str)}
        col = lower_map.get(target_col.lower()) if target_col else None
    if not col or col not in df.columns:
        return (target_col, [])
    _invalid = {"", "nan", "none", "null"}
    values = df[col].dropna().astype(str).str.strip().unique().tolist()
    values = [v for v in values if v and v.lower() not in _invalid]
    values = sorted(set(values))[:ITEMS_USERS_LIMIT]
    return (target_col, values)


@app.get("/project/{project_id}/target-values", response_model=schemas.TargetValuesResponse)
def get_project_target_values(
    project_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    """Returns the list of values for the column the model recommends (for 'similar to' dropdown). Works for content, parameter_driven, and hybrid."""
    db_project = get_project_for_user(project_id, current_user_id, db)
    if db_project.status != models.ProjectStatus.READY:
        raise HTTPException(status_code=400, detail="Project is not ready.")
    if db_project.model_type not in (models.ModelType.CONTENT, models.ModelType.PARAMETER_DRIVEN, models.ModelType.HYBRID):
        raise HTTPException(status_code=400, detail="Target values are only for content, parameter_driven, or hybrid projects.")
    content_file = next((f for f in db_project.uploaded_files if f.file_type == models.FileType.CONTENT), None)
    if not content_file:
        raise HTTPException(status_code=404, detail="Content file not found.")
    content_schema = {s.app_schema_key: s.user_csv_column for s in content_file.schema_mappings}
    cpath = _resolve_uploaded_file_path(content_file, db)
    if not cpath:
        raise HTTPException(
            status_code=404,
            detail=(
                "Uploaded CSV file is missing from disk for this project. "
                f"Look for basename {os.path.basename(str(content_file.storage_path or ''))!r} under {USER_UPLOADS_DIR!r} "
                "or re-upload / retrain."
            ),
        )
    df = pd.read_csv(cpath, low_memory=False)
    target_col, target_values = _resolve_target_column_and_values(df, content_schema)
    if not target_col:
        raise HTTPException(status_code=400, detail="Schema is missing target_column or item_title.")
    return schemas.TargetValuesResponse(target_column=target_col, target_values=target_values)


@app.get("/project/{project_id}/items", response_model=List[schemas.ProjectItemResponse])
def get_project_items(
    project_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    try:
        df, schema = get_project_data(project_id, current_user_id, db, models.FileType.CONTENT)
        id_col, title_col = schema['item_id'], schema['item_title']
        df[id_col] = df[id_col].astype(str)
        items_df = df[[id_col, title_col]].drop_duplicates().head(ITEMS_USERS_LIMIT)
        items = [{"id": str(row[id_col]), "title": str(row[title_col])} for row in items_df.to_dict("records")]
        return items
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error loading items: {e}")

@app.get("/project/{project_id}/users", response_model=List[schemas.ProjectUserResponse])
def get_project_users(
    project_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    try:
        df, schema = get_project_data(project_id, current_user_id, db, models.FileType.INTERACTION)
        user_col = schema['user_id']
        users_series = df[user_col].drop_duplicates().astype(str).head(ITEMS_USERS_LIMIT)
        return [{"id": u} for u in users_series.tolist()]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error loading users: {e}")


@app.get("/project/{project_id}/context-options", response_model=schemas.ContextOptionsResponse)
def get_project_context_options(
    project_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    """For parameter_driven and hybrid projects: returns target_column and feature columns with sample values. Hybrid uses joined (content + ratings) data so Rating is included."""
    db_project = get_project_for_user(project_id, current_user_id, db)
    if db_project.status != models.ProjectStatus.READY:
        raise HTTPException(status_code=400, detail="Project is not ready.")
    if db_project.model_type not in (models.ModelType.PARAMETER_DRIVEN, models.ModelType.HYBRID):
        raise HTTPException(status_code=400, detail="Context options are only available for parameter_driven or hybrid projects.")
    cache_key = _cache_key("project_context_options", {"project_id": int(project_id), "user_id": int(current_user_id)})
    cached = _api_cache.get(cache_key)
    if isinstance(cached, dict):
        return schemas.ContextOptionsResponse(**cached)
    content_file = next((f for f in db_project.uploaded_files if f.file_type == models.FileType.CONTENT), None)
    if not content_file:
        raise HTTPException(status_code=404, detail="Content file not found.")
    content_schema = {s.app_schema_key: s.user_csv_column for s in content_file.schema_mappings}
    target_col = content_schema.get("target_column") or content_schema.get("item_title") or content_schema.get("item_id")
    content_feature_cols = [s.user_csv_column for s in content_file.schema_mappings if s.app_schema_key == "feature_col" and (s.user_csv_column or "").strip()]

    if db_project.model_type == models.ModelType.HYBRID:
        interaction_file = next((f for f in db_project.uploaded_files if f.file_type == models.FileType.INTERACTION), None)
        if not interaction_file:
            raise HTTPException(status_code=404, detail="Hybrid project requires both content and ratings files.")
        cpath = _resolve_uploaded_file_path(content_file, db)
        ipath = _resolve_uploaded_file_path(interaction_file, db)
        if not cpath:
            raise HTTPException(
                status_code=404,
                detail=f"Content CSV missing on disk (stored {content_file.storage_path!r}). Place file under {USER_UPLOADS_DIR!r} or retrain.",
            )
        if not ipath:
            raise HTTPException(
                status_code=404,
                detail=f"Interaction CSV missing on disk (stored {interaction_file.storage_path!r}). Place file under {USER_UPLOADS_DIR!r} or retrain.",
            )
        df_content = pd.read_csv(cpath, low_memory=False)
        df_interaction = pd.read_csv(ipath, low_memory=False)
        interaction_schema = {s.app_schema_key: s.user_csv_column for s in interaction_file.schema_mappings}
        if "item_id" not in interaction_schema or "rating" not in interaction_schema:
            raise HTTPException(status_code=400, detail="Ratings file must have item_id and rating mapped.")
        content_key = content_schema["item_id"]
        ratings_key = interaction_schema["item_id"]
        rating_col = interaction_schema["rating"]
        df_content[content_key] = df_content[content_key].astype(str)
        df_interaction[ratings_key] = df_interaction[ratings_key].astype(str)
        ratings_agg = df_interaction.groupby(ratings_key)[rating_col].mean().reset_index()
        ratings_agg = ratings_agg.rename(columns={rating_col: "mean_rating", ratings_key: content_key})
        df = df_content.merge(ratings_agg, on=content_key, how="left")
        df["mean_rating"] = df["mean_rating"].fillna(df["mean_rating"].mean() if df["mean_rating"].notna().any() else 0)
        if not content_feature_cols:
            content_feature_cols = [c for c in df_content.columns if c != target_col and c != content_key]
        feature_cols = [c for c in content_feature_cols if c in df.columns] + ["mean_rating"]
    else:
        cpath = _resolve_uploaded_file_path(content_file, db)
        if not cpath:
            raise HTTPException(
                status_code=404,
                detail=f"Content CSV missing on disk (stored {content_file.storage_path!r}). Place file under {USER_UPLOADS_DIR!r} or retrain.",
            )
        df = pd.read_csv(cpath, low_memory=False)
        feature_cols = content_feature_cols
        if not feature_cols:
            feature_cols = [c for c in df.columns if c != target_col]

    if not target_col:
        raise HTTPException(status_code=400, detail="Content schema is missing target_column (or item_title/item_id).")
    if not feature_cols:
        raise HTTPException(status_code=400, detail="No feature columns available.")
    feature_columns = []
    _invalid = {"", "nan", "none", "null"}
    for col in feature_cols:
        if col not in df.columns:
            continue
        series = df[col].dropna()
        if len(series) == 0:
            continue
        numeric_series = pd.to_numeric(series, errors="coerce")
        valid_numeric = numeric_series.notna()
        if valid_numeric.sum() >= 0.5 * len(series):
            min_val = float(numeric_series.min())
            max_val = float(numeric_series.max())
            if min_val == max_val:
                max_val = min_val + 1.0
            feature_columns.append(
                schemas.ContextOptionColumn(
                    name=col,
                    values=[],
                    column_type="numeric",
                    numeric_range={"min": min_val, "max": max_val},
                )
            )
        else:
            values = series.astype(str).str.strip().unique().tolist()
            values = [v for v in values if v and v.lower() not in _invalid]
            values = sorted(set(values))
            feature_columns.append(
                schemas.ContextOptionColumn(name=col, values=values, column_type="categorical")
            )
    # Distinct values of the target column (same resolution as /target-values: handles case-insensitive column match)
    _resolved_col, target_values = _resolve_target_column_and_values(df, content_schema)
    if _resolved_col:
        target_col = _resolved_col
    payload = {
        "target_column": target_col,
        "feature_columns": [fc.model_dump() for fc in feature_columns],
        "target_values": target_values,
    }
    _api_cache.set(cache_key, payload, ttl_seconds=API_CACHE_TTL_SECONDS)
    return schemas.ContextOptionsResponse(**payload)


def normalize_context_to_project_columns(
    *,
    db: Session,
    current_user_id: int,
    project_id: int,
    context: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Map client context keys onto the project's real feature column names (case-insensitive)
    and drop unknown keys so the sklearn encoder does not see stray DataFrame columns.
    """
    raw = dict(context or {})
    db_project = get_project_for_user(project_id, current_user_id, db)
    if db_project.model_type not in (models.ModelType.PARAMETER_DRIVEN, models.ModelType.HYBRID):
        return raw
    try:
        opts = get_project_context_options(project_id=project_id, current_user_id=current_user_id, db=db)
    except Exception:
        return raw
    names = [fc.name for fc in (opts.feature_columns or []) if fc and getattr(fc, "name", None)]
    if not names:
        return raw
    lower_map = {str(n).lower(): n for n in names}
    reserved = {"user_id", "item_title", "n", "target_domain"}
    out: Dict[str, Any] = {}
    for k, v in raw.items():
        kk = str(k).strip()
        if not kk or kk.lower() in reserved:
            continue
        if v is None or str(v).strip() == "":
            continue
        canon = lower_map.get(kk.lower())
        if canon is not None:
            out[canon] = v
    return out


@app.get("/project/{project_id}/recommendations", response_model=schemas.RecommendationResponse)
async def get_recommendations(
    request: Request,
    project_id: int,
    background_tasks: BackgroundTasks,
    user_id: Optional[str] = None,
    item_title: Optional[str] = None,
    n: int = 10,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    """Get recommendations. For parameter_driven projects, pass context as query params (feature column names = keys, chosen values = values). Works for any dataset."""
    db_project = get_project_for_user(project_id, current_user_id, db)
    if db_project.status != models.ProjectStatus.READY:
        raise HTTPException(status_code=400, detail=f"Project status is {db_project.status}.")
    if not db_project.mlflow_model_name:
         raise HTTPException(status_code=404, detail="Model not found in registry.")

    model_type = db_project.model_type
    context = {}
    if model_type in (models.ModelType.PARAMETER_DRIVEN, models.ModelType.HYBRID):
        reserved = {"user_id", "item_title", "n"}
        context = {k: v for k, v in request.query_params.items() if k not in reserved and v}
    if model_type == models.ModelType.CONTENT and not item_title:
        raise HTTPException(status_code=400, detail="item_title is required for this content-based model.")
    elif model_type == models.ModelType.COLLABORATIVE and not user_id:
        raise HTTPException(status_code=400, detail="user_id is required for this collaborative model.")
    # parameter_driven and hybrid: either context (filter by) or item_title (recommend similar to this item) or both

    cache_key = _cache_key(
        "project_recommendations",
        {
            "project_id": int(project_id),
            "user_scope": int(current_user_id),
            "model_type": str(model_type),
            "context": context,
            "item_title": item_title,
            "user_id": user_id,
            "n": int(n),
        },
    )
    cached_resp = _api_cache.get(cache_key)
    if isinstance(cached_resp, dict):
        return schemas.RecommendationResponse(**cached_resp)

    try:
        pred = await _predict_project(
            db=db,
            current_user_id=current_user_id,
            project_id=project_id,
            context=context,
            item_title=item_title,
            user_id=user_id,
            n=n,
        )
        recs = pred.get("recommendations") if isinstance(pred, dict) else []
        if not isinstance(recs, list):
            recs = []

        preview = []
        for r in recs[:5]:
            if isinstance(r, dict):
                preview.append({"item_id": r.get("id"), "title": r.get("title"), "score": r.get("score")})
            else:
                preview.append({"item_id": None, "title": str(r), "score": None})

        background_tasks.add_task(emit_event_bg, {
            "event_type": "recommendation_served",
            "source_service": "fastapi-recommender",
            "api_route": f"/project/{project_id}/recommendations",
            "project_id": project_id,
            "user_id": user_id,
            "_raw_api_key": None,
            "recommendation_count": len(recs),
            "recommendations_preview": preview,
            "metadata": {},
        })

        response_payload = {
            "input_item_title": item_title if model_type not in (models.ModelType.PARAMETER_DRIVEN, models.ModelType.HYBRID) else None,
            "input_user_id": user_id if model_type == models.ModelType.COLLABORATIVE else None,
            "model_type": model_type,
            "recommendations": recs,
        }
        _api_cache.set(cache_key, response_payload, ttl_seconds=API_CACHE_TTL_SECONDS)
        return schemas.RecommendationResponse(
            input_item_title=item_title if model_type not in (models.ModelType.PARAMETER_DRIVEN, models.ModelType.HYBRID) else None,
            input_user_id=user_id if model_type == models.ModelType.COLLABORATIVE else None,
            model_type=model_type,
            recommendations=recs
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"Error loading model or predicting: {e}")
        raise HTTPException(status_code=500, detail=f"Error generating recommendations: {e}")


# =========================
# Agent layer (no extra ports)
# =========================

class AgentDomainRecommendRequest(BaseModel):
    project_id: int
    context: Dict[str, Any] = {}
    item_title: Optional[str] = None
    user_id: Optional[str] = None
    n: int = 10


class AgentOrchestrateRequest(BaseModel):
    correlation_id: Optional[str] = None
    goal: Optional[str] = None
    context: Dict[str, Any] = {}
    n: int = 10
    # Explicit ordering/selection; if omitted we'll infer from `context`
    domains: List[str] = []
    # Optional: domain_slug -> backend/back2 project_id
    # If omitted, we auto-pick READY projects whose `project_name` contains the domain slug.
    project_id_map: Dict[str, int] = {}


class AgentSingleRecommendRequest(BaseModel):
    """
    User-facing recommendation endpoint:
    - User provides `context` attributes
    - Backend infers relevant domain(s) (or uses `target_domain` if provided)
    - Backend auto-picks the best READY project per domain (no project selection needed)
    """

    correlation_id: Optional[str] = None
    context: Dict[str, Any] = {}
    n: int = 10
    target_domain: Optional[str] = None
    item_title: Optional[str] = None
    user_id: Optional[str] = None


def _infer_domains_from_context(context: Dict[str, Any]) -> List[str]:
    keys = {str(k) for k in (context or {}).keys()}
    # If user provides explicit canonical IDs, trust those.
    if "material_id" in keys:
        return ["supply_chain_materials"]
    if "sku_id" in keys:
        return ["supply_chain_skus"]
    if "supplier_id" in keys or "supplier_name" in keys:
        return ["supply_chain_suppliers"]
    if "warehouse_id" in keys:
        return ["logistics_warehouses"]
    if "lane_id" in keys:
        return ["logistics_lanes"]

    # Lanes: origin/dest geography pair.
    if ("origin_region" in keys and "dest_region" in keys) or ("origin_country" in keys and "dest_country" in keys):
        return ["logistics_lanes"]

    # Warehouses: lead time + capacity variants tend to be warehouse-specific.
    if "lead_time_days_receipt" in keys or "lead_time_days_ship" in keys or "capacity_volume_cbm" in keys:
        return ["logistics_warehouses"]

    # Carriers: mode + cost/reliability features.
    carrier_signals = {
        "carrier_type",
        "capacity_type",
        "tracking_available",
        "temperature_controlled",
        "hazardous_capable",
        "avg_transit_days",
        "reliability_score",
        "on_time_pct_typical",
        "cost_per_shipment_base",
        "mode",
        "region",
        "country",
        "certifications",
    }
    if len(keys.intersection(carrier_signals)) >= 2:
        return ["logistics_carriers"]

    # Suppliers: quality/reliability + risk.
    supplier_signals = {"quality_score", "reliability_score", "risk_rating", "on_time_delivery_pct", "payment_terms"}
    if len(keys.intersection(supplier_signals)) >= 2:
        return ["supply_chain_suppliers"]

    # Materials: spec/grade + shelf life + substitute IDs.
    material_signals = {"material_type", "spec_grade", "shelf_life_days", "substitute_ids", "price_per_unit", "bom_parent_sku"}
    if len(keys.intersection(material_signals)) >= 2:
        return ["supply_chain_materials"]

    # SKUs: demand/order/fill-rate type features.
    sku_signals = {"abc_class", "demand_volatility", "reorder_point", "safety_stock", "demand_qty", "forecast_accuracy"}
    if len(keys.intersection(sku_signals)) >= 2:
        return ["supply_chain_skus"]

    return []


def _auto_pick_projects_for_domains(
    *,
    db: Session,
    current_user_id: int,
    domains: List[str],
) -> Dict[str, int]:
    """
    Pick READY projects per domain.

    Selection strategy (in order):
    1) If project_name contains the domain slug, use it.
    2) Otherwise, inspect the trained content schema mapping (`target_column`) and pick a
       READY PARAMETER_DRIVEN/HYBRID project whose `target_column` matches the domain's expected target.

    Prefers HYBRID -> PARAMETER_DRIVEN -> CONTENT -> COLLABORATIVE.
    """
    if not domains:
        return {}

    candidates = db.query(models.RecommenderProject).filter(
        models.RecommenderProject.status == models.ProjectStatus.READY,
        or_(
            models.RecommenderProject.owner_id == current_user_id,
            models.RecommenderProject.owner_id.is_(None),
            models.RecommenderProject.owner_id == 0,
        ),
    ).all()

    def _pref(mt: Any) -> int:
        if str(mt) == str(models.ModelType.HYBRID):
            return 0
        if str(mt) == str(models.ModelType.PARAMETER_DRIVEN):
            return 1
        if str(mt) == str(models.ModelType.CONTENT):
            return 2
        if str(mt) == str(models.ModelType.COLLABORATIVE):
            return 3
        return 10

    desired_target_by_domain = {
        "logistics_carriers": "carrier_name",
        "logistics_lanes": "lane_id",
        "logistics_warehouses": "warehouse_id",
        "supply_chain_suppliers": "supplier_name",
        "supply_chain_materials": "material_id",
        "supply_chain_skus": "sku_id",
    }

    # Precompute project -> target_columns (from uploaded content schema mapping)
    candidate_ids = [int(p.id) for p in candidates]
    project_target_columns: Dict[int, set[str]] = {pid: set() for pid in candidate_ids}
    if candidate_ids:
        target_rows = (
            db.query(models.UploadedFile.project_id, models.SchemaMapping.user_csv_column)
            .join(models.SchemaMapping, models.SchemaMapping.file_id == models.UploadedFile.id)
            .filter(
                models.UploadedFile.project_id.in_(candidate_ids),
                models.UploadedFile.file_type == models.FileType.CONTENT,
                models.SchemaMapping.app_schema_key == "target_column",
            )
            .all()
        )
        for pid, user_csv_column in target_rows:
            try:
                project_target_columns[int(pid)].add(str(user_csv_column))
            except Exception:
                continue

    out: Dict[str, int] = {}
    for domain_slug in domains:
        domain_slug_l = str(domain_slug).lower()

        # 1) Name match
        domain_candidates = [p for p in candidates if domain_slug_l in str(p.project_name or "").lower()]

        # 2) Target-column match
        if not domain_candidates:
            desired_target = desired_target_by_domain.get(domain_slug_l)
            if desired_target:
                domain_candidates = [
                    p
                    for p in candidates
                    if desired_target in project_target_columns.get(int(p.id), set())
                    and str(p.model_type) in (
                        str(models.ModelType.PARAMETER_DRIVEN),
                        str(models.ModelType.HYBRID),
                    )
                ]

        # 3) Last resort: any trained project of relevant model types
        if not domain_candidates:
            domain_candidates = [
                p
                for p in candidates
                if str(p.model_type) in (
                    str(models.ModelType.PARAMETER_DRIVEN),
                    str(models.ModelType.HYBRID),
                )
            ]

        if not domain_candidates:
            continue

        domain_candidates.sort(key=lambda p: (_pref(p.model_type), -int(p.id)))
        out[str(domain_slug)] = int(domain_candidates[0].id)

    return out


async def _predict_project(
    *,
    db: Session,
    current_user_id: int,
    project_id: int,
    context: Dict[str, Any],
    item_title: Optional[str],
    user_id: Optional[str],
    n: int,
) -> Dict[str, Any]:
    db_project = get_project_for_user(project_id, current_user_id, db)
    if db_project.status != models.ProjectStatus.READY:
        raise HTTPException(status_code=400, detail=f"Project status is {db_project.status}.")
    if not db_project.mlflow_model_name:
        raise HTTPException(status_code=404, detail="Model not found in registry.")

    model_type = db_project.model_type

    champion = _get_champion_entry(db, project_id)
    champion_path = champion.model_path if champion and champion.model_path else os.path.join(PROJECT_MODELS_DIR, f"project_{project_id}")

    champion_pred = _run_prediction_for_model(
        model_path=champion_path,
        model_type=model_type,
        context=context,
        item_title=item_title,
        user_id=user_id,
        n=n,
    )

    serving_ctrl = _ensure_serving_control(db, project_id)
    serving_ctrl.last_request_at = datetime.now(timezone.utc)
    serving_ctrl.champion_latency_ms = champion_pred["latency_ms"]

    challenger = _get_latest_challenger_entry(db, project_id)
    shadow_ran = False
    shadow_error = None
    shadow_latency_ms = None

    if (
        serving_ctrl.shadow_enabled
        and challenger is not None
        and challenger.model_path
        and os.path.isdir(challenger.model_path)
        and random.random() < (max(0, min(100, int(serving_ctrl.shadow_percentage))) / 100.0)
    ):
        shadow_ran = True
        serving_ctrl.shadow_request_count = int(serving_ctrl.shadow_request_count or 0) + 1
        try:
            shadow_pred = _run_prediction_for_model(
                model_path=challenger.model_path,
                model_type=model_type,
                context=context,
                item_title=item_title,
                user_id=user_id,
                n=n,
            )
            shadow_latency_ms = shadow_pred["latency_ms"]
            serving_ctrl.challenger_latency_ms = shadow_latency_ms
        except Exception as e:
            shadow_error = str(e)
            serving_ctrl.shadow_error_count = int(serving_ctrl.shadow_error_count or 0) + 1

    db.commit()

    if serving_ctrl.latency_warn_ms and champion_pred["latency_ms"] > float(serving_ctrl.latency_warn_ms):
        print(
            f"[serving] Latency warning for project {project_id}: champion={champion_pred['latency_ms']}ms "
            f"threshold={serving_ctrl.latency_warn_ms}ms"
        )

    return {
        "model_type": str(model_type),
        "recommendations": champion_pred["recommendations"],
        "input_item_title": item_title,
        "input_user_id": user_id,
        "serving": {
            "champion_version": champion.version if champion else None,
            "champion_latency_ms": champion_pred["latency_ms"],
            "shadow_enabled": bool(serving_ctrl.shadow_enabled),
            "shadow_ran": shadow_ran,
            "shadow_version": challenger.version if (shadow_ran and challenger) else None,
            "shadow_latency_ms": shadow_latency_ms,
            "shadow_error": shadow_error,
        },
    }


@app.post("/agent/v1/domain/{domain_slug}/recommend")
async def agent_domain_recommend(
    domain_slug: str,
    req: AgentDomainRecommendRequest,
    background_tasks: BackgroundTasks,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    normalized_ctx = normalize_context_to_project_columns(
        db=db,
        current_user_id=current_user_id,
        project_id=int(req.project_id),
        context=req.context,
    )
    pred = await _predict_project(
        db=db,
        current_user_id=current_user_id,
        project_id=req.project_id,
        context=normalized_ctx,
        item_title=req.item_title,
        user_id=req.user_id,
        n=req.n,
    )

    recs = pred.get("recommendations") if isinstance(pred, dict) else []
    if not isinstance(recs, list):
        recs = []

    preview = []
    for r in recs[:5]:
        if isinstance(r, dict):
            preview.append({"item_id": r.get("id"), "title": r.get("title"), "score": r.get("score")})
        else:
            preview.append({"item_id": None, "title": str(r), "score": None})

    background_tasks.add_task(emit_event_bg, {
        "event_type": "recommendation_served",
        "source_service": "fastapi-recommender",
        "api_route": f"/agent/v1/domain/{domain_slug}/recommend",
        "project_id": req.project_id,
        "user_id": req.user_id,
        "_raw_api_key": None,
        "recommendation_count": len(recs),
        "recommendations_preview": preview,
        "metadata": {"domain_slug": domain_slug},
    })

    return {
        "domain_slug": domain_slug,
        "project_id": req.project_id,
        **pred,
    }


@app.post("/agent/v1/orchestrate")
async def agent_orchestrate(
    req: AgentOrchestrateRequest,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    domains = req.domains or _infer_domains_from_context(req.context)

    # Auto-pick project_id_map if not provided (or empty).
    project_id_map: Dict[str, int] = dict(req.project_id_map or {})
    if not project_id_map:
        project_id_map = _auto_pick_projects_for_domains(
            db=db,
            current_user_id=current_user_id,
            domains=domains,
        )
    else:
        # Allow partial overrides: fill missing domains from auto-pick.
        missing = [d for d in domains if d not in project_id_map or not project_id_map.get(d)]
        if missing:
            picked = _auto_pick_projects_for_domains(
                db=db,
                current_user_id=current_user_id,
                domains=missing,
            )
            project_id_map.update(picked)

    if not project_id_map:
        raise HTTPException(
            status_code=400,
            detail="No trained READY project found for the requested domain(s). Train projects in Recommender Studio and try again.",
        )

    results: List[Dict[str, Any]] = []

    # Deterministic order: domains in request order (or inferred order)
    for domain_slug in domains:
        domain_key = str(domain_slug)
        if domain_key not in project_id_map:
            continue
        project_id = project_id_map[domain_key]

        # Forward explicit seeds if provided in context.
        # This keeps the orchestrator UI flexible: it can pass `item_title` / `user_id` either as top-level
        # fields (not in our request schema) or inside `context`.
        item_title = req.context.get("item_title") if isinstance(req.context, dict) else None
        user_id = req.context.get("user_id") if isinstance(req.context, dict) else None

        # Feature context should not include seed keys.
        feature_context = dict(req.context or {})
        feature_context.pop("item_title", None)
        feature_context.pop("user_id", None)
        feature_context = normalize_context_to_project_columns(
            db=db,
            current_user_id=current_user_id,
            project_id=int(project_id),
            context=feature_context,
        )

        pred = await _predict_project(
            db=db,
            current_user_id=current_user_id,
            project_id=project_id,
            context=feature_context,
            item_title=item_title,
            user_id=user_id,
            n=req.n,
        )

        results.append(
            {
                "domain_slug": domain_slug,
                "project_id": project_id,
                **pred,
            }
        )

    return {"correlation_id": req.correlation_id, "results": results}


@app.post("/agent/v1/recommend")
async def agent_single_recommend(
    req: AgentSingleRecommendRequest,
    background_tasks: BackgroundTasks,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    req_payload = req.model_dump()
    cache_key = _cache_key(
        "agent_single_recommend",
        {"user_scope": int(current_user_id), "request": req_payload},
    )
    cached = _api_cache.get(cache_key)
    if isinstance(cached, dict):
        return cached

    domains = [req.target_domain] if req.target_domain else _infer_domains_from_context(req.context)
    if not domains:
        raise HTTPException(
            status_code=400,
            detail="Could not infer domain from context. Provide target_domain or include domain-relevant attribute keys.",
        )

    project_id_map = _auto_pick_projects_for_domains(
        db=db,
        current_user_id=current_user_id,
        domains=[str(d) for d in domains],
    )
    if not project_id_map:
        candidates = db.query(models.RecommenderProject).filter(
            models.RecommenderProject.status == models.ProjectStatus.READY,
            or_(
                models.RecommenderProject.owner_id == current_user_id,
                models.RecommenderProject.owner_id.is_(None),
                models.RecommenderProject.owner_id == 0,
            ),
        ).all()
        sample = [{"id": int(p.id), "name": p.project_name, "model_type": p.model_type} for p in candidates[:10]]
        raise HTTPException(
            status_code=400,
            detail=(
                f"No trained READY project found for inferred domain(s): {domains}. "
                f"Ready projects in DB (sample): {sample}. "
                f"Make sure you trained parameter-driven/hybrid projects with correct `target_column` mappings "
                f"(e.g. logistics_carriers -> carrier_name, logistics_lanes -> lane_id, logistics_warehouses -> warehouse_id, "
                f"supply_chain_suppliers -> supplier_name, supply_chain_materials -> material_id, supply_chain_skus -> sku_id)."
            ),
        )

    results: List[Dict[str, Any]] = []
    for domain_slug in domains:
        domain_key = str(domain_slug)
        if domain_key not in project_id_map:
            continue
        project_id = project_id_map[domain_key]
        normalized_ctx = normalize_context_to_project_columns(
            db=db,
            current_user_id=current_user_id,
            project_id=int(project_id),
            context=req.context,
        )

        pred = await _predict_project(
            db=db,
            current_user_id=current_user_id,
            project_id=project_id,
            context=normalized_ctx,
            item_title=req.item_title,
            user_id=req.user_id,
            n=req.n,
        )
        results.append(
            {
                "domain_slug": domain_slug,
                "project_id": project_id,
                **pred,
            }
        )

    total_recs = sum(
        len((block or {}).get("recommendations") or [])
        for block in results
        if isinstance(block, dict)
    )
    first_block = results[0] if results and isinstance(results[0], dict) else {}
    first_recs = first_block.get("recommendations") or []
    preview = []
    for r in first_recs[:5]:
        if isinstance(r, dict):
            preview.append({"item_id": r.get("id"), "title": r.get("title"), "score": r.get("score")})
        else:
            preview.append({"item_id": None, "title": str(r), "score": None})

    background_tasks.add_task(emit_event_bg, {
        "event_type": "recommendation_served",
        "source_service": "fastapi-recommender",
        "api_route": "/agent/v1/recommend",
        "project_id": first_block.get("project_id"),
        "user_id": req.user_id,
        "_raw_api_key": None,
        "recommendation_count": total_recs,
        "recommendations_preview": preview,
        "metadata": {
            "target_domain": req.target_domain,
            "correlation_id": req.correlation_id,
        },
    })

    response_payload = {"correlation_id": req.correlation_id, "results": results}
    _api_cache.set(cache_key, response_payload, ttl_seconds=API_CACHE_TTL_SECONDS)
    return response_payload


@app.get("/agent/v1/presets")
def agent_list_presets():
    """List bundled agent datasets (CSV paths under backend/agent_datasets/)."""
    presets: List[Dict[str, Any]] = []
    for preset_id, cfg in AGENT_PRESETS.items():
        content_csv = cfg.get("content_csv") or cfg.get("csv")
        interaction_csv = cfg.get("interaction_csv")
        path = os.path.join(AGENT_DATASETS_DIR, content_csv) if content_csv else ""
        presets.append(
            {
                "preset": preset_id,
                "domain_slug": cfg["domain_slug"],
                "description": cfg["description"],
                "content_csv": content_csv,
                "interaction_csv": interaction_csv,
                "available": os.path.isfile(path),
            }
        )
    return {"presets": presets}


@app.get("/agent/v1/context-options", response_model=schemas.AgentContextOptionsResponse)
def agent_context_options_by_domain(
    domain_slug: str,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    """
    Context sliders / categorical values for the auto-selected READY project for this domain
    (same payload as /project/{id}/context-options, plus project_id).
    """
    cache_key = _cache_key(
        "agent_context_options",
        {"domain_slug": str(domain_slug), "user_id": int(current_user_id)},
    )
    cached = _api_cache.get(cache_key)
    if isinstance(cached, dict):
        return schemas.AgentContextOptionsResponse(**cached)

    picked = _auto_pick_projects_for_domains(
        db=db,
        current_user_id=current_user_id,
        domains=[str(domain_slug)],
    )
    pid = picked.get(str(domain_slug))
    if not pid:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No READY trained model for domain '{domain_slug}'. "
                "Train with POST /agent/v1/train-preset or upload via /agent/v1/train-upload."
            ),
        )
    inner = get_project_context_options(project_id=int(pid), current_user_id=current_user_id, db=db)
    payload = {
        "project_id": int(pid),
        "domain_slug": str(domain_slug),
        "target_column": inner.target_column,
        "feature_columns": [fc.model_dump() for fc in (inner.feature_columns or [])],
        "target_values": inner.target_values,
    }
    _api_cache.set(cache_key, payload, ttl_seconds=API_CACHE_TTL_SECONDS)
    return schemas.AgentContextOptionsResponse(
        project_id=int(pid),
        domain_slug=str(domain_slug),
        target_column=inner.target_column,
        feature_columns=inner.feature_columns,
        target_values=inner.target_values,
    )


@app.post("/agent/v1/train-preset", response_model=schemas.RecommenderProject)
async def agent_train_preset(
    background_tasks: BackgroundTasks,
    preset: str = Form(...),
    project_name: str = Form(""),
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    """Train a parameter-driven model from a bundled CSV in backend/agent_datasets/."""
    cfg = AGENT_PRESETS.get(preset)
    if not cfg:
        raise HTTPException(status_code=400, detail=f"Unknown preset: {preset}")
    content_csv = cfg.get("content_csv") or cfg.get("csv")
    if not content_csv:
        raise HTTPException(status_code=400, detail=f"Preset '{preset}' missing content_csv.")

    content_path = os.path.join(AGENT_DATASETS_DIR, content_csv)
    if not os.path.isfile(content_path):
        raise HTTPException(
            status_code=404,
            detail=f"Dataset file missing on server: {content_path}",
        )

    pn = (project_name or "").strip() or f"{preset}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"
    with open(content_path, "rb") as f:
        data = f.read()
    content_buf = io.BytesIO(data)
    content_upload = UploadFile(filename=os.path.basename(content_path), file=content_buf)

    interaction_csv = cfg.get("interaction_csv")
    if interaction_csv:
        interaction_path = os.path.join(AGENT_DATASETS_DIR, interaction_csv)
        if not os.path.isfile(interaction_path):
            raise HTTPException(
                status_code=404,
                detail=f"Interaction dataset file missing on server: {interaction_path}",
            )
        with open(interaction_path, "rb") as f:
            idata = f.read()
        interaction_buf = io.BytesIO(idata)
        interaction_upload = UploadFile(filename=os.path.basename(interaction_path), file=interaction_buf)

        return await _create_hybrid_project_from_uploads(
            background_tasks=background_tasks,
            current_user_id=current_user_id,
            db=db,
            project_name=pn,
            content_file=content_upload,
            interaction_file=interaction_upload,
            content_schema=dict(cfg["content_schema"]),
            interaction_schema=dict(cfg["interaction_schema"]),
        )

    return await _create_parameter_driven_project_from_upload(
        background_tasks=background_tasks,
        current_user_id=current_user_id,
        db=db,
        project_name=pn,
        content_file=content_upload,
        content_schema=dict(cfg["content_schema"]),
    )


@app.post("/agent/v1/train-upload", response_model=schemas.RecommenderProject)
async def agent_train_upload(
    background_tasks: BackgroundTasks,
    domain: str = Form(...),
    project_name: str = Form(""),
    content_file: UploadFile = File(...),
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    """
    Train using the same schema as a known domain (columns must match the bundled template).
    `domain` is `logistics_carriers` or `supply_chain_suppliers`.
    """
    cfg = AGENT_PRESETS.get(domain)
    if not cfg:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unknown domain: {domain}. Use one of: "
                "logistics_carriers, logistics_lanes, logistics_warehouses, "
                "supply_chain_suppliers, supply_chain_materials, supply_chain_skus."
            ),
        )
    pn = (project_name or "").strip() or f"{domain}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"
    return await _create_parameter_driven_project_from_upload(
        background_tasks=background_tasks,
        current_user_id=current_user_id,
        db=db,
        project_name=pn,
        content_file=content_file,
        content_schema=dict(cfg["content_schema"]),
    )


@app.post("/agent/v1/train-logistics-all")
async def agent_train_logistics_all(
    background_tasks: BackgroundTasks,
    project_name_prefix: str = Form("logistics"),
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    """
    Train all 3 logistics HYBRID recommenders (carriers + lanes + warehouses)
    using bundled CSVs from `backend/agent_datasets/`.
    """
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    created: List[Dict[str, Any]] = []
    for domain_slug in ["logistics_carriers", "logistics_lanes", "logistics_warehouses"]:
        cfg = AGENT_PRESETS.get(domain_slug)
        if not cfg:
            continue
        content_csv = cfg.get("content_csv") or cfg.get("csv")
        interaction_csv = cfg.get("interaction_csv")
        if not content_csv or not interaction_csv:
            raise HTTPException(status_code=400, detail=f"Preset '{domain_slug}' must include content_csv and interaction_csv.")

        content_path = os.path.join(AGENT_DATASETS_DIR, content_csv)
        interaction_path = os.path.join(AGENT_DATASETS_DIR, interaction_csv)
        if not os.path.isfile(content_path):
            raise HTTPException(status_code=404, detail=f"Missing dataset on server: {content_path}")
        if not os.path.isfile(interaction_path):
            raise HTTPException(status_code=404, detail=f"Missing interaction dataset on server: {interaction_path}")

        with open(content_path, "rb") as f:
            content_data = f.read()
        with open(interaction_path, "rb") as f:
            interaction_data = f.read()

        content_upload = UploadFile(filename=os.path.basename(content_path), file=io.BytesIO(content_data))
        interaction_upload = UploadFile(filename=os.path.basename(interaction_path), file=io.BytesIO(interaction_data))

        proj_name = f"{project_name_prefix}_{domain_slug}_{ts}"
        db_project = await _create_hybrid_project_from_uploads(
            background_tasks=background_tasks,
            current_user_id=current_user_id,
            db=db,
            project_name=proj_name,
            content_file=content_upload,
            interaction_file=interaction_upload,
            content_schema=dict(cfg["content_schema"]),
            interaction_schema=dict(cfg["interaction_schema"]),
        )
        created.append({"id": db_project.id, "domain_slug": domain_slug, "status": str(db_project.status)})

    return {"created": created, "bundle": "logistics_all"}


@app.post("/agent/v1/train-logistics-upload")
async def agent_train_logistics_upload(
    background_tasks: BackgroundTasks,
    project_name_prefix: str = Form("logistics"),
    carriers_content_file: UploadFile = File(...),
    carriers_interactions_file: UploadFile = File(...),
    lanes_content_file: UploadFile = File(...),
    lanes_interactions_file: UploadFile = File(...),
    warehouses_content_file: UploadFile = File(...),
    warehouses_interactions_file: UploadFile = File(...),
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    """
    Train all 3 logistics HYBRID recommenders from user-uploaded CSVs.
    Upload templates must match the bundled dataset column names.
    """
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    created: List[Dict[str, Any]] = []
    domain_to_files = {
        "logistics_carriers": (carriers_content_file, carriers_interactions_file),
        "logistics_lanes": (lanes_content_file, lanes_interactions_file),
        "logistics_warehouses": (warehouses_content_file, warehouses_interactions_file),
    }
    for domain_slug, (content_file, interaction_file) in domain_to_files.items():
        cfg = AGENT_PRESETS.get(domain_slug)
        if not cfg:
            continue
        proj_name = f"{project_name_prefix}_{domain_slug}_{ts}"
        db_project = await _create_hybrid_project_from_uploads(
            background_tasks=background_tasks,
            current_user_id=current_user_id,
            db=db,
            project_name=proj_name,
            content_file=content_file,
            interaction_file=interaction_file,
            content_schema=dict(cfg["content_schema"]),
            interaction_schema=dict(cfg["interaction_schema"]),
        )
        created.append({"id": db_project.id, "domain_slug": domain_slug, "status": str(db_project.status)})
    return {"created": created, "bundle": "logistics_upload"}