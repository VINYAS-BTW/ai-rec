from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from agents.contracts import AgentContext, AgentResponse, MediatorRequest
from agents.domain_agent import DomainAgent
from services.recommender_client import RecommenderClient
from services.agent_registry import AgentRegistry
from services.mediator import Mediator
from services.registry_loader import AttributesRegistry


router = APIRouter()


class DomainRecommendQuery(BaseModel):
    domain_slug: str
    project_id: int = Field(..., description="Recommender project id in backend/back2.")
    context: Dict[str, Any] = Field(default_factory=dict, description="Context key-value pairs (feature filters).")
    item_title: Optional[str] = Field(None, description="Optional seed title/value for content/parameter-driven.")
    user_id: Optional[str] = Field(None, description="Optional seed user for collaborative/hybrid.")
    n: int = 10


class DomainRecommendResponse(BaseModel):
    agent: str
    data: List[Dict[str, Any]]
    confidence: float
    meta: Dict[str, Any]


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
    merged: List[Dict[str, Any]]
    meta: Dict[str, Any]


def _get_services() -> tuple[RecommenderClient, AttributesRegistry, AgentRegistry, Mediator]:
    client = RecommenderClient()
    registry = AttributesRegistry()
    agent_registry = AgentRegistry()
    domain_agent = DomainAgent(client=client, attributes_registry=registry)
    for domain_slug in registry.all_domains():
        agent_registry.register(domain_slug, domain_agent)
    mediator = Mediator(registry=agent_registry, attributes_registry=registry)
    return client, registry, agent_registry, mediator


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

    client, registry, _, _ = _get_services()
    domain_agent = DomainAgent(client=client, attributes_registry=registry)
    agent_ctx = AgentContext(
        domain_slug=query.domain_slug,
        project_id=query.project_id,
        context=query.context,
        item_title=query.item_title,
        user_id=query.user_id,
        n=query.n,
    )
    result = await domain_agent.handle(agent_ctx)
    return DomainRecommendResponse(**result.__dict__)


@router.post("/v1/orchestrate", response_model=OrchestrateResponse)
async def orchestrate(req: OrchestrateRequest):
    _, _, _, mediator = _get_services()
    if not req.project_id_map:
        raise HTTPException(
            status_code=400,
            detail="project_id_map is required (domain_slug -> backend/back2 project_id).",
        )

    result = await mediator.handle(MediatorRequest(
        correlation_id=req.correlation_id,
        goal=req.goal,
        context=req.context,
        n=req.n,
        domains=req.domains,
        project_id_map=req.project_id_map,
    ))

    return OrchestrateResponse(
        correlation_id=result.correlation_id,
        results=[DomainRecommendResponse(**r.__dict__) for r in result.results],
        merged=result.merged,
        meta=result.meta,
    )

