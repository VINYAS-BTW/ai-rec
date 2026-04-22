from __future__ import annotations

from typing import Any, Dict, List, Optional

from agents.domain_agent import DomainAgent
from services.recommender_client import RecommenderClient
from services.registry_loader import AttributesRegistry


class OrchestratorAgent:
    """
    Minimal deterministic orchestrator:
    - Infers which domain agents to call from context keys (unless `domains` explicitly provided)
    - Uses `project_id_map` to call the recommender for each domain
    - Merges results by returning per-domain ranked lists
    """

    def __init__(self, *, client: RecommenderClient, attributes_registry: AttributesRegistry):
        self.client = client
        self.registry = attributes_registry
        self.domain_agent = DomainAgent(client=client, attributes_registry=attributes_registry)

    async def run(
        self,
        *,
        correlation_id: Optional[str],
        goal: Optional[str],
        context: Dict[str, Any],
        n: int,
        domains: List[str],
        project_id_map: Dict[str, int],
    ) -> List[Dict[str, Any]]:
        inferred_domains = domains or self.registry.infer_domains(context)

        results: List[Dict[str, Any]] = []
        for domain_slug in inferred_domains:
            if domain_slug not in project_id_map:
                continue
            project_id = project_id_map[domain_slug]

            # Simple rule: if user provides explicit seed keys, forward them.
            # back2 expects them as query params: item_title for content/parameter-driven, user_id for collaborative/hybrid.
            item_title = context.get("item_title")
            user_id = context.get("user_id")
            # Remove these generic keys from the feature context to avoid polluting filters.
            feature_context = dict(context)
            feature_context.pop("item_title", None)
            feature_context.pop("user_id", None)

            res = await self.domain_agent.recommend(
                domain_slug=domain_slug,
                project_id=project_id,
                context=feature_context,
                item_title=item_title,
                user_id=user_id,
                n=n,
            )
            results.append(res)

        return results

