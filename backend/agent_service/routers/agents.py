from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services.recommender_client import RecommenderClient
from services.registry_loader import AttributesRegistry
from agents.orchestrator_agent import OrchestratorAgent
from agents.domain_agent import DomainAgent


router = APIRouter()


class DomainRecommendQuery(BaseModel):
    domain_slug: str
    project_id: int = Field(..., description="Recommender project id in backend/back2.")
    context: Dict[str, Any] = Field(default_factory=dict, description="Context key-value pairs (feature filters).")
    item_title: Optional[str] = Field(None, description="Optional seed title/value for content/parameter-driven.")
    user_id: Optional[str] = Field(None, description="Optional seed user for collaborative/hybrid.")
    n: int = 10


class DomainRecommendResponse(BaseModel):
    domain_slug: str
    project_id: int
    recommendations: List[Dict[str, Any]]
    used_context: Dict[str, Any]


class OrchestrateRequest(BaseModel):
    correlation_id: Optional[str] = None
    goal: Optional[str] = None
    context: Dict[str, Any] = Field(default_factory=dict)
    n: int = 10
    # Optional: if you already know which projects belong to each domain.
    project_id_map: Dict[str, int] = Field(default_factory=dict)
    # Optional: explicit domains list; if absent we try to infer from context.
    domains: List[str] = Field(default_factory=list)


class OrchestrateResponse(BaseModel):
    correlation_id: Optional[str]
    results: List[DomainRecommendResponse]


def _get_services() -> tuple[RecommenderClient, AttributesRegistry, OrchestratorAgent]:
    client = RecommenderClient()
    registry = AttributesRegistry()
    orchestrator = OrchestratorAgent(client=client, attributes_registry=registry)
    return client, registry, orchestrator


@router.get("/health")
def health():
    return {"status": "ok"}


@router.post("/v1/domain/{domain_slug}/recommend", response_model=DomainRecommendResponse)
async def recommend_domain(
    domain_slug: str,
    query: DomainRecommendQuery,
):
    if query.domain_slug != domain_slug:
        raise HTTPException(status_code=400, detail="Path domain_slug must match body domain_slug.")

    client, registry, _ = _get_services()
    domain_agent = DomainAgent(client=client, attributes_registry=registry)
    result = await domain_agent.recommend(
        domain_slug=query.domain_slug,
        project_id=query.project_id,
        context=query.context,
        item_title=query.item_title,
        user_id=query.user_id,
        n=query.n,
    )
    return DomainRecommendResponse(**result)


@router.post("/v1/orchestrate", response_model=OrchestrateResponse)
async def orchestrate(req: OrchestrateRequest):
    _, _, orchestrator = _get_services()
    if not req.project_id_map:
        raise HTTPException(
            status_code=400,
            detail="project_id_map is required (domain_slug -> backend/back2 project_id).",
        )

    results = await orchestrator.run(
        correlation_id=req.correlation_id,
        goal=req.goal,
        context=req.context,
        n=req.n,
        domains=req.domains,
        project_id_map=req.project_id_map,
    )

    return OrchestrateResponse(correlation_id=req.correlation_id, results=results)

