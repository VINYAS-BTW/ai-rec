from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from agents.contracts import AgentContext, AgentResponse, MediatorRequest
from agents.domain_agent import DomainAgent
from services.recommender_client import RecommenderClient
from services.agent_registry import AgentRegistry
from services.mediator import Mediator
from services.registry_loader import AttributesRegistry
from services.observability import AgentObservability
from services.federated_data import FederatedDataService


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
    aggregation_policy: str = Field(default="score_desc", description="score_desc | rrf")


class OrchestrateResponse(BaseModel):
    correlation_id: Optional[str]
    results: List[DomainRecommendResponse]
    merged: List[Dict[str, Any]]
    meta: Dict[str, Any]


class FeedbackRequest(BaseModel):
    domain_slug: str
    project_id: int
    user_id: str
    item_id: Optional[str] = None
    feedback_type: str = Field(default="click", description="click | rating | skip | dwell")
    rating_value: Optional[float] = None
    dwell_time_ms: Optional[int] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class FederatedFetchDataRequest(BaseModel):
    domain_slug: str
    context: Dict[str, Any] = Field(default_factory=dict)


_client = RecommenderClient()
_registry = AttributesRegistry()
_agent_registry = AgentRegistry()
_observability = AgentObservability()
_federated = FederatedDataService()
_domain_agent = DomainAgent(client=_client, attributes_registry=_registry, observability=_observability)
for _domain_slug in _registry.all_domains():
    _agent_registry.register(_domain_slug, _domain_agent)
_mediator = Mediator(registry=_agent_registry, attributes_registry=_registry)


def _get_services() -> tuple[RecommenderClient, AttributesRegistry, AgentRegistry, Mediator]:
    return _client, _registry, _agent_registry, _mediator


@router.get("/health")
def health():
    return {
        "status": "ok",
        "registered_domains": _agent_registry.list_domains(),
        "agent_metrics": _observability.snapshot(),
    }


@router.get("/v1/contracts")
def contracts():
    return {
        "contracts": {
            "IAgent": {"can_handle": "AgentContext -> bool", "handle": "AgentContext -> AgentResponse"},
            "IMediator": {"handle": "MediatorRequest -> MediatorResult"},
        },
        "transport": {
            "orchestrate_endpoint": "/v1/orchestrate",
            "domain_recommend_endpoint": "/v1/domain/{domain_slug}/recommend",
            "feedback_endpoint": "/v1/feedback",
        },
    }


@router.post("/v1/domain/{domain_slug}/recommend", response_model=DomainRecommendResponse)
async def recommend_domain(
    domain_slug: str,
    query: DomainRecommendQuery,
):
    if query.domain_slug != domain_slug:
        raise HTTPException(status_code=400, detail="Path domain_slug must match body domain_slug.")

    _, _, _, _ = _get_services()
    agent_ctx = AgentContext(
        domain_slug=query.domain_slug,
        project_id=query.project_id,
        context=query.context,
        item_title=query.item_title,
        user_id=query.user_id,
        n=query.n,
    )
    result = await _domain_agent.handle(agent_ctx)
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
        context={**(req.context or {}), "_aggregation_policy": req.aggregation_policy},
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


@router.get("/v1/observability/agents")
def agent_observability():
    return {"agents": _observability.snapshot()}


@router.post("/v1/federated/fetchData")
async def federated_fetch_data(
    req: FederatedFetchDataRequest,
    x_internal_key: Optional[str] = Header(default=None, alias="X-Internal-Key"),
):
    if not _federated.authorize(x_internal_key):
        raise HTTPException(status_code=401, detail="Unauthorized federated hook access")
    return await _federated.fetch_data(req.domain_slug, req.context)


@router.get("/v1/federated/getUserProfile")
async def federated_get_user_profile(
    user_id: str,
    x_internal_key: Optional[str] = Header(default=None, alias="X-Internal-Key"),
):
    if not _federated.authorize(x_internal_key):
        raise HTTPException(status_code=401, detail="Unauthorized federated hook access")
    return await _federated.get_user_profile(user_id)


@router.post("/v1/feedback")
async def submit_feedback(req: FeedbackRequest):
    _, _, _, mediator = _get_services()
    # Route feedback through mediator selection path for domain validation.
    _ = await mediator.handle(MediatorRequest(
        correlation_id=None,
        goal="feedback-routing",
        context={},
        n=1,
        domains=[req.domain_slug],
        project_id_map={req.domain_slug: int(req.project_id)},
    ))

    features: Dict[str, Any] = {"last_feedback_type": req.feedback_type}
    if req.item_id is not None:
        features["last_item_id"] = str(req.item_id)
    if req.rating_value is not None:
        features["last_rating_value"] = float(req.rating_value)
    if req.dwell_time_ms is not None:
        features["last_dwell_time_ms"] = int(req.dwell_time_ms)
    if req.metadata:
        for k, v in req.metadata.items():
            features[f"meta_{k}"] = v

    updated = await _client.update_user_features(
        project_id=int(req.project_id),
        user_id=str(req.user_id),
        features=features,
    )
    return {"status": "accepted", "feedback_type": req.feedback_type, "feature_store": updated}

