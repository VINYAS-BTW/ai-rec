from __future__ import annotations

import os
from typing import Any, Dict, Optional
import urllib.parse

import httpx


class RecommenderClient:
    """
    Thin HTTP client for your existing FastAPI recommender.
    Calls:
      GET /project/{project_id}/recommendations?...
    """

    def __init__(self):
        self.back2_url = os.getenv("BACK2_URL", "http://localhost:8000").rstrip("/")
        self.back2_internal_key = os.getenv("BACK2_INTERNAL_KEY", "").strip()

    async def recommend(
        self,
        project_id: int,
        context: Dict[str, Any],
        *,
        item_title: Optional[str] = None,
        user_id: Optional[str] = None,
        n: int = 10,
    ) -> Dict[str, Any]:
        params: Dict[str, str] = {"n": str(n)}

        if item_title is not None:
            params["item_title"] = str(item_title)
        if user_id is not None:
            params["user_id"] = str(user_id)

        for k, v in (context or {}).items():
            if v is None:
                continue
            # back2 uses query_params directly; keep values as strings.
            params[str(k)] = str(v)

        url = f"{self.back2_url}/project/{project_id}/recommendations"
        headers: Dict[str, str] = {}
        if self.back2_internal_key:
            headers["X-Internal-Key"] = self.back2_internal_key

        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.get(url, params=params, headers=headers)
            resp.raise_for_status()
            return resp.json()

    async def update_user_features(
        self,
        *,
        project_id: int,
        user_id: str,
        features: Dict[str, Any],
    ) -> Dict[str, Any]:
        url = f"{self.back2_url}/project/{int(project_id)}/feature-store/user/{urllib.parse.quote(str(user_id), safe='')}"
        headers: Dict[str, str] = {}
        if self.back2_internal_key:
            headers["X-Internal-Key"] = self.back2_internal_key
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, json={"features": features or {}}, headers=headers)
            resp.raise_for_status()
            return resp.json()

