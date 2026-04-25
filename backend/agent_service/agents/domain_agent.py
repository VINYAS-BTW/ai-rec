from __future__ import annotations

from typing import Any, Dict, List, Optional
import time

from agents.contracts import AgentContext, AgentResponse, IAgent
from services.recommender_client import RecommenderClient
from services.registry_loader import AttributesRegistry
from services.observability import AgentObservability


class DomainAgent(IAgent):
    """
    Domain agent wrapper:
    - Validates context keys against the domain's known attributes (optional)
    - Calls your recommender backend (back2) for the project's recommendations
    """

    def __init__(self, *, client: RecommenderClient, attributes_registry: AttributesRegistry, observability: Optional[AgentObservability] = None):
        self.client = client
        self.attributes_registry = attributes_registry
        self.observability = observability

    def can_handle(self, context: AgentContext) -> bool:
        return bool(context.domain_slug and context.project_id > 0)

    async def handle(self, context: AgentContext) -> AgentResponse:
        started = time.perf_counter()
        try:
            result = await self.recommend(
                domain_slug=context.domain_slug,
                project_id=context.project_id,
                context=context.context,
                item_title=context.item_title,
                user_id=context.user_id,
                n=context.n,
            )
            latency_ms = (time.perf_counter() - started) * 1000.0
            if self.observability:
                self.observability.record_success(context.domain_slug, latency_ms)
            return AgentResponse(
                agent=result["domain_slug"],
                data=result.get("recommendations") or [],
                confidence=0.87,
                meta={
                    "project_id": result["project_id"],
                    "used_context": result.get("used_context") or {},
                    "latency_ms": latency_ms,
                },
            )
        except Exception as exc:
            latency_ms = (time.perf_counter() - started) * 1000.0
            if self.observability:
                self.observability.record_error(context.domain_slug, latency_ms, str(exc))
            raise

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

