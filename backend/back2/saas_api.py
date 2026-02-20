import pandas as pd
import aiofiles
import os
from dotenv import load_dotenv
load_dotenv()

import uuid
import json
import asyncio
import pickle
import shutil
import numpy as np
import tempfile
import jwt
from fastapi import FastAPI, File, UploadFile, Form, Depends, HTTPException, BackgroundTasks, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import or_
from sqlalchemy.orm import Session
from sqlalchemy.exc import OperationalError
from contextlib import asynccontextmanager
from typing import List, Optional, Dict

import models
import schemas
import database
import httpx
# --- MLflow path-only URI fix: patch registry before mlflow is used so all callers get the wrapper ---
_BACK2_DIR = os.path.dirname(os.path.abspath(__file__))


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
from datetime import datetime



def _webhook_service_url():
    return (os.getenv("WEBHOOK_SERVICE_URL") or "http://localhost:3001").rstrip("/")


async def notify_webhooks(event_type: str, payload: dict):
    """Send event payload to all registered external apps via the Node webhook service."""
    try:
        base = _webhook_service_url()
        async with httpx.AsyncClient() as client:
            res = await client.get(f"{base}/api/apps")
            if res.status_code != 200:
                print("⚠️ Could not fetch registered apps from webhook service")
                return
            apps = res.json()

            for app in apps:
                try:
                    await client.post(
                        app["webhook_url"],
                        json={
                            "event": event_type,
                            "data": payload,
                            "api_key": app["api_key"],
                        },
                        timeout=10.0,
                    )
                    print(f"✅ Notified {app['app_name']} at {app['webhook_url']}")
                except Exception as e:
                    print(f"❌ Failed to send to {app['app_name']}: {e}")
    except Exception as e:
        print(f"❌ notify_webhooks failed: {e}")
# --- App Setup & Model Storage ---
USER_UPLOADS_DIR = os.path.join(_BACK2_DIR, "user_uploads")
os.makedirs(USER_UPLOADS_DIR, exist_ok=True)
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
    yield
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
            df_content = pd.read_csv(content_file.storage_path, low_memory=False)
            content_schema = {s.app_schema_key: s.user_csv_column for s in content_file.schema_mappings if s.app_schema_key != 'feature_col' and (s.user_csv_column or '').strip()}
            content_schema['feature_cols'] = [s.user_csv_column for s in content_file.schema_mappings if s.app_schema_key == 'feature_col' and (s.user_csv_column or '').strip()]
            if 'target_column' not in content_schema:
                content_schema['target_column'] = next((s.user_csv_column for s in content_file.schema_mappings if s.app_schema_key == 'target_column' and (s.user_csv_column or '').strip()), None)
            # If target_column set but no feature_cols (single-dataset simple flow), use all other columns
            if content_schema.get('target_column') and not content_schema.get('feature_cols'):
                content_schema['feature_cols'] = [c for c in df_content.columns if c != content_schema['target_column']]
            all_schemas_map['content'] = content_schema

        if interaction_file:
            df_interaction = pd.read_csv(interaction_file.storage_path)
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
                artifacts["pd_feature_matrix"] = os.path.join(tmpdir, "pd_feature_matrix.npy")
                artifacts["pd_data"] = os.path.join(tmpdir, "pd_data.csv")
                with open(artifacts["pd_transformer"], "wb") as f:
                    pickle.dump(pd_recommender.column_transformer, f)
                np.save(artifacts["pd_feature_matrix"], pd_recommender.feature_matrix_)
                pd_recommender.df.to_csv(artifacts["pd_data"], index=False)
                print(f"[Task {project_id}]: Saved Parameter-driven model artifacts.")

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
                artifacts["pd_feature_matrix"] = os.path.join(tmpdir, "pd_feature_matrix.npy")
                artifacts["pd_data"] = os.path.join(tmpdir, "pd_data.csv")
                with open(artifacts["pd_transformer"], "wb") as f:
                    pickle.dump(pd_recommender.column_transformer, f)
                np.save(artifacts["pd_feature_matrix"], pd_recommender.feature_matrix_)
                pd_recommender.df.to_csv(artifacts["pd_data"], index=False)
                artifacts["cb_data"] = os.path.join(tmpdir, "cb_data.csv")
                df_joined.to_csv(artifacts["cb_data"], index=False)
                print(f"[Task {project_id}]: Saved Hybrid (joined content+ratings, ParameterDriven) artifacts.")

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

        # --- Update Project in DB ---
        db_project.mlflow_model_name = model_name
        db_project.mlflow_model_version = 1  # Local model version (not from registry)
        db_project.status = models.ProjectStatus.READY
        db.commit()
        print(f"[Task {project_id}]: Processing complete.")

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
        if f.storage_path and os.path.isfile(f.storage_path):
            try:
                os.remove(f.storage_path)
            except OSError:
                pass
    db.delete(db_project)
    db.commit()
    return {"message": "Project deleted."}


def get_project_data(project_id: int, user_id: int, db: Session, file_type: models.FileType):
    db_project = get_project_for_user(project_id, user_id, db)
    if db_project.status != models.ProjectStatus.READY:
        raise HTTPException(status_code=400, detail="Project is not ready.")
    
    file = next((f for f in db_project.uploaded_files if f.file_type == file_type), None)
    if not file:
        raise HTTPException(status_code=404, detail=f"{file_type} file not found for this project.")
        
    df = pd.read_csv(file.storage_path, low_memory=False)
    schema = {s.app_schema_key: s.user_csv_column for s in file.schema_mappings}
    return df, schema

# Max items/users returned for dropdowns (keeps response and UI fast)
ITEMS_USERS_LIMIT = 2000


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
    df = pd.read_csv(content_file.storage_path, low_memory=False)
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
        df_content = pd.read_csv(content_file.storage_path, low_memory=False)
        df_interaction = pd.read_csv(interaction_file.storage_path, low_memory=False)
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
        df = pd.read_csv(content_file.storage_path, low_memory=False)
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
    return schemas.ContextOptionsResponse(target_column=target_col, feature_columns=feature_columns, target_values=target_values)


@app.get("/project/{project_id}/recommendations", response_model=schemas.RecommendationResponse)
def get_recommendations(
    request: Request,
    project_id: int,
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

    try:
        local_model_path = os.path.join(PROJECT_MODELS_DIR, f"project_{project_id}")
        if not os.path.isdir(local_model_path):
            raise HTTPException(status_code=404, detail="Model not found. Re-train the project.")
        model_uri = _path_to_file_uri(local_model_path)
        print(f"Loading model from: {local_model_path}")
        print(f"Model type: {model_type}, user_id: {user_id}, item_title: {item_title}, context: {context if model_type == models.ModelType.PARAMETER_DRIVEN else 'N/A'}")

        model = mlflow.pyfunc.load_model(model_uri)
        print("Model loaded successfully")

        if model_type in (models.ModelType.PARAMETER_DRIVEN, models.ModelType.HYBRID):
            row = {**context, "n": n}
            if item_title:
                row["item_title"] = item_title
            model_input = pd.DataFrame([row])
        else:
            model_input = pd.DataFrame([{"user_id": user_id, "item_title": item_title, "n": n}])
        print(f"Model input: {model_input.to_dict('records')}")

        result_json = model.predict(model_input)[0]
        result = json.loads(result_json)

        if result.get("error"):
            raise ValueError(result["error"])

        recs = result.get("recommendations")
        if recs is not None and not isinstance(recs, list):
            recs = []
        if recs is None:
            recs = []

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