from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class AgentContext:
    domain_slug: str
    project_id: int
    context: Dict[str, Any] = field(default_factory=dict)
    item_title: Optional[str] = None
    user_id: Optional[str] = None
    n: int = 10


@dataclass
class AgentResponse:
    agent: str
    data: List[Dict[str, Any]]
    confidence: float
    meta: Dict[str, Any] = field(default_factory=dict)


class IAgent(ABC):
    @abstractmethod
    def can_handle(self, context: AgentContext) -> bool:
        raise NotImplementedError

    @abstractmethod
    async def handle(self, context: AgentContext) -> AgentResponse:
        raise NotImplementedError


@dataclass
class MediatorRequest:
    correlation_id: Optional[str] = None
    goal: Optional[str] = None
    context: Dict[str, Any] = field(default_factory=dict)
    n: int = 10
    project_id_map: Dict[str, int] = field(default_factory=dict)
    domains: List[str] = field(default_factory=list)


@dataclass
class MediatorResult:
    correlation_id: Optional[str]
    results: List[AgentResponse]
    merged: List[Dict[str, Any]]
    meta: Dict[str, Any] = field(default_factory=dict)


class IMediator(ABC):
    @abstractmethod
    async def handle(self, request: MediatorRequest) -> MediatorResult:
        raise NotImplementedError
