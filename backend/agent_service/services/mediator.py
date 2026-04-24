from __future__ import annotations

from typing import Any, Dict, List

from agents.contracts import AgentContext, AgentResponse, IMediator, MediatorRequest, MediatorResult
from services.agent_registry import AgentRegistry
from services.registry_loader import AttributesRegistry


class Mediator(IMediator):
    def __init__(self, *, registry: AgentRegistry, attributes_registry: AttributesRegistry):
        self.registry = registry
        self.attributes_registry = attributes_registry

    async def handle(self, request: MediatorRequest) -> MediatorResult:
        domains = request.domains or self.attributes_registry.infer_domains(request.context)
        results: List[AgentResponse] = []

        for domain_slug in domains:
            project_id = request.project_id_map.get(domain_slug)
            if not project_id:
                continue

            agent = self.registry.get(domain_slug)
            if not agent:
                continue

            item_title = request.context.get("item_title")
            user_id = request.context.get("user_id")
            feature_context = dict(request.context or {})
            feature_context.pop("item_title", None)
            feature_context.pop("user_id", None)

            agent_ctx = AgentContext(
                domain_slug=domain_slug,
                project_id=int(project_id),
                context=feature_context,
                item_title=str(item_title) if item_title is not None else None,
                user_id=str(user_id) if user_id is not None else None,
                n=request.n,
            )
            if not agent.can_handle(agent_ctx):
                continue

            results.append(await agent.handle(agent_ctx))

        merged = self._merge(results)
        return MediatorResult(
            correlation_id=request.correlation_id,
            results=results,
            merged=merged,
            meta={"domains_selected": domains, "domains_responded": [r.agent for r in results]},
        )

    def _merge(self, results: List[AgentResponse]) -> List[Dict[str, Any]]:
        merged: List[Dict[str, Any]] = []
        for res in results:
            for item in res.data:
                row = dict(item)
                row["_agent"] = res.agent
                row["_confidence"] = res.confidence
                merged.append(row)

        merged.sort(key=lambda x: float(x.get("score", 0.0)), reverse=True)
        return merged
