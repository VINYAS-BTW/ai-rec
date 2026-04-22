from __future__ import annotations

from typing import Any, Dict, List, Optional

from services.recommender_client import RecommenderClient
from services.registry_loader import AttributesRegistry


class DomainAgent:
    """
    Domain agent wrapper:
    - Validates context keys against the domain's known attributes (optional)
    - Calls your recommender backend (back2) for the project's recommendations
    """

    def __init__(self, *, client: RecommenderClient, attributes_registry: AttributesRegistry):
        self.client = client
        self.attributes_registry = attributes_registry

    async def recommend(
        self,
        *,
        domain_slug: str,
        project_id: int,
        context: Dict[str, Any],
        item_title: Optional[str],
        user_id: Optional[str],
        n: int,
    ) -> Dict[str, Any]:
        allowed = self.attributes_registry.allowed_keys(domain_slug)
        if allowed:
            used_context = {k: v for k, v in (context or {}).items() if str(k) in allowed}
        else:
            used_context = dict(context or {})

        model_result = await self.client.recommend(
            project_id=project_id,
            context=used_context,
            item_title=item_title,
            user_id=user_id,
            n=n,
        )

        return {
            "domain_slug": domain_slug,
            "project_id": project_id,
            "recommendations": model_result.get("recommendations") or [],
            "used_context": used_context,
        }

