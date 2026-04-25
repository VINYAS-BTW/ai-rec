from __future__ import annotations

import asyncio
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
        tasks = []

        for domain_slug in domains:
            project_id = request.project_id_map.get(domain_slug)
            if not project_id:
                continue

            agent = self.registry.resolve_agent(domain_slug)
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

            tasks.append(agent.handle(agent_ctx))

        settled = await asyncio.gather(*tasks, return_exceptions=True) if tasks else []
        results: List[AgentResponse] = [r for r in settled if isinstance(r, AgentResponse)]
        errors = [str(r) for r in settled if isinstance(r, Exception)]

        merged = self._merge(results, strategy=(request.context or {}).get("_aggregation_policy", "score_desc"), limit=request.n)
        return MediatorResult(
            correlation_id=request.correlation_id,
            results=results,
            merged=merged,
            meta={
                "domains_selected": domains,
                "domains_responded": [r.agent for r in results],
                "errors": errors,
                "aggregation_policy": (request.context or {}).get("_aggregation_policy", "score_desc"),
            },
        )

    def _merge(self, results: List[AgentResponse], strategy: str = "score_desc", limit: int = 10) -> List[Dict[str, Any]]:
        merged: List[Dict[str, Any]] = []
        for res in results:
            for item in res.data:
                row = dict(item)
                row["_agent"] = res.agent
                row["_confidence"] = res.confidence
                merged.append(row)

        if strategy == "rrf":
            # Reciprocal rank fusion across agents.
            fused: Dict[str, Dict[str, Any]] = {}
            for res in results:
                for idx, item in enumerate(res.data):
                    key = str(item.get("id") or item.get("title") or f"{res.agent}:{idx}")
                    score = 1.0 / (60.0 + float(idx + 1))
                    row = fused.get(key)
                    if not row:
                        row = dict(item)
                        row["_agent_sources"] = [res.agent]
                        row["_fused_score"] = score
                        fused[key] = row
                    else:
                        row["_fused_score"] = float(row.get("_fused_score", 0.0)) + score
                        sources = row.get("_agent_sources") or []
                        if res.agent not in sources:
                            sources.append(res.agent)
                        row["_agent_sources"] = sources
            out = list(fused.values())
            out.sort(key=lambda x: float(x.get("_fused_score", 0.0)), reverse=True)
            return out[: max(1, int(limit or 10))]

        merged.sort(key=lambda x: float(x.get("score", 0.0)), reverse=True)
        return merged[: max(1, int(limit or 10))]
