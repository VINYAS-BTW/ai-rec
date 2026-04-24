from __future__ import annotations

import re
import time
import uuid
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple


DOMAIN_LABELS = {
    "logistics_carriers": ["carrier", "carriers", "transport", "3pl", "freight"],
    "logistics_lanes": ["lane", "lanes", "route", "routes", "origin", "destination"],
    "logistics_warehouses": ["warehouse", "warehouses", "dc", "distribution center", "fulfillment"],
    "supply_chain_suppliers": ["supplier", "suppliers", "vendor", "vendors"],
    "supply_chain_materials": ["material", "materials", "bom", "raw material"],
    "supply_chain_skus": ["sku", "skus", "product", "products", "item"],
}


def _now_ms() -> int:
    return int(time.time() * 1000)


def _normalize_ws(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())


def _extract_kv_pairs(text: str) -> Dict[str, str]:
    """
    Extract key=value style constraints from free text.
    Supports:
      - key=value and key: value (optional spaces around = or :)
      - comma / newline / semicolon separated chunks
      - multiple pairs in one line, e.g. ``mode=road region=North`` (no commas)
    """
    out: Dict[str, str] = {}
    if not text:
        return out
    t = text.strip()
    # Pass 1: split on line / comma / semicolon
    for part in re.split(r"[\n,;]+", t):
        part = part.strip()
        if not part:
            continue
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*(.+)$", part)
        if m:
            k = m.group(1).strip()
            v = m.group(2).strip().strip('"').strip("'")
            if k and v:
                out[k] = v
    # Pass 2: all ``word=value`` tokens in the full string (handles space-separated pairs)
    for m in re.finditer(
        r"(?:^|[\s,;])([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(\S+)",
        t,
    ):
        k = m.group(1).strip()
        v = m.group(2).strip().strip('"').strip("'")
        if k and v and v.lower() not in ("and", "or"):
            out[k] = v
    return out


def infer_domain_from_text(text: str) -> Optional[str]:
    t = _normalize_ws(text).lower()
    if not t:
        return None
    for domain, words in DOMAIN_LABELS.items():
        for w in words:
            if w in t:
                return domain
    return None


def infer_top_k_from_text(text: str) -> Optional[int]:
    """
    Infer desired top-k from natural language.
    Examples:
      - "top 5 carriers" -> 5
      - "give me 10 best suppliers" -> 10
      - "best 3 lanes" -> 3
    """
    t = _normalize_ws(text).lower()
    if not t:
        return None
    m = re.search(r"\btop\s+(\d{1,3})\b", t)
    if m:
        try:
            return int(m.group(1))
        except Exception:
            return None
    m = re.search(r"\bbest\s+(\d{1,3})\b", t)
    if m:
        try:
            return int(m.group(1))
        except Exception:
            return None
    m = re.search(r"\bgive\s+me\s+(\d{1,3})\b", t)
    if m:
        try:
            return int(m.group(1))
        except Exception:
            return None
    return None


@dataclass
class ClarifyQuestion:
    key: str
    prompt: str
    options: Optional[List[str]] = None


class InMemorySessionStore:
    """MVP session store (process memory)."""

    def __init__(self):
        self._sessions: Dict[str, Dict[str, Any]] = {}

    def get(self, session_id: str) -> Dict[str, Any]:
        return self._sessions.get(session_id, {})

    def upsert(self, session_id: str, data: Dict[str, Any]) -> None:
        prev = self._sessions.get(session_id, {})
        merged = {**prev, **(data or {})}
        self._sessions[session_id] = merged

    def new_session(self) -> str:
        sid = uuid.uuid4().hex
        self._sessions[sid] = {"created_at_ms": _now_ms()}
        return sid


class SuperAgent:
    """
    MVP Super Agent:
    - Parse intent: which domain user wants recommendations for
    - Parse context: key=value pairs from message
    - Ask clarifying question if domain missing
    - Call existing agent endpoints (back2 internal function should do it)
    """

    def __init__(self, *, session_store: InMemorySessionStore):
        self.sessions = session_store

    def parse(
        self,
        message: str,
        explicit_domain: Optional[str],
        context: Dict[str, Any],
    ) -> Tuple[Optional[str], Dict[str, Any]]:
        """
        ``context`` should already include any session-persisted constraints; message
        key=value pairs override keys present in ``context``.
        """
        inferred = explicit_domain or infer_domain_from_text(message)
        merged: Dict[str, Any] = {}
        merged.update(context or {})
        msg_kv = _extract_kv_pairs(message)
        merged.update(msg_kv)
        # normalize blanks
        merged = {k: v for k, v in merged.items() if v is not None and str(v).strip() != ""}
        return inferred, merged

    def need_clarification(self, domain: Optional[str]) -> Optional[ClarifyQuestion]:
        if domain:
            return None
        opts = [
            "logistics_carriers",
            "logistics_lanes",
            "logistics_warehouses",
            "supply_chain_suppliers",
            "supply_chain_materials",
            "supply_chain_skus",
        ]
        return ClarifyQuestion(
            key="target_domain",
            prompt="What do you want recommendations for?",
            options=opts,
        )

