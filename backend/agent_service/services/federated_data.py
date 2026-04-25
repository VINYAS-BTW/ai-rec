from __future__ import annotations

import os
from typing import Any, Dict, Optional

import httpx


class FederatedDataService:
    """Shared hooks for external/federated context enrichment."""

    def __init__(self):
        self.fetch_data_url = (os.getenv("FEDERATED_FETCH_DATA_URL") or "").strip()
        self.user_profile_url = (os.getenv("FEDERATED_USER_PROFILE_URL") or "").strip()
        self.shared_key = (os.getenv("FEDERATED_SHARED_KEY") or "").strip()

    def authorize(self, supplied_key: Optional[str]) -> bool:
        if not self.shared_key:
            return True
        return bool(supplied_key and supplied_key.strip() == self.shared_key)

    async def fetch_data(self, domain_slug: str, context: Dict[str, Any]) -> Dict[str, Any]:
        if not self.fetch_data_url:
            return {"domain_slug": domain_slug, "data": {}, "source": "local-default"}

        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                self.fetch_data_url,
                json={"domain_slug": domain_slug, "context": context or {}},
                headers={"X-Internal-Key": self.shared_key} if self.shared_key else {},
            )
            r.raise_for_status()
            payload = r.json()
            return payload if isinstance(payload, dict) else {"data": payload}

    async def get_user_profile(self, user_id: str) -> Dict[str, Any]:
        if not self.user_profile_url:
            return {"user_id": str(user_id), "profile": {}, "source": "local-default"}

        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(
                self.user_profile_url,
                params={"user_id": str(user_id)},
                headers={"X-Internal-Key": self.shared_key} if self.shared_key else {},
            )
            r.raise_for_status()
            payload = r.json()
            return payload if isinstance(payload, dict) else {"profile": payload}
