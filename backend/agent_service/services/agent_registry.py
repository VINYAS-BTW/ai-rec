from __future__ import annotations

from typing import Dict, List

from agents.contracts import IAgent


class AgentRegistry:
    def __init__(self):
        self._agents: Dict[str, IAgent] = {}

    def register(self, domain_slug: str, agent: IAgent) -> None:
        self._agents[str(domain_slug)] = agent

    def get(self, domain_slug: str) -> IAgent | None:
        return self._agents.get(str(domain_slug))

    def resolve_agent(self, domain_slug: str) -> IAgent | None:
        """Alias for get() to make mediator contract explicit."""
        return self.get(domain_slug)

    def list_domains(self) -> List[str]:
        return list(self._agents.keys())
