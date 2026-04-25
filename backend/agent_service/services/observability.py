from __future__ import annotations

import threading
import time
from collections import defaultdict
from typing import Any, Dict


class AgentObservability:
    def __init__(self):
        self._lock = threading.RLock()
        self._stats: Dict[str, Dict[str, Any]] = defaultdict(
            lambda: {
                "requests_total": 0,
                "errors_total": 0,
                "total_latency_ms": 0.0,
                "last_latency_ms": None,
                "last_error": None,
                "last_seen_epoch_ms": None,
            }
        )

    def record_success(self, agent: str, latency_ms: float) -> None:
        with self._lock:
            s = self._stats[str(agent)]
            s["requests_total"] += 1
            s["total_latency_ms"] += float(latency_ms)
            s["last_latency_ms"] = float(latency_ms)
            s["last_seen_epoch_ms"] = int(time.time() * 1000)
            s["last_error"] = None

    def record_error(self, agent: str, latency_ms: float, error: str) -> None:
        with self._lock:
            s = self._stats[str(agent)]
            s["requests_total"] += 1
            s["errors_total"] += 1
            s["total_latency_ms"] += float(latency_ms)
            s["last_latency_ms"] = float(latency_ms)
            s["last_seen_epoch_ms"] = int(time.time() * 1000)
            s["last_error"] = str(error)

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            out: Dict[str, Any] = {}
            for agent, s in self._stats.items():
                requests_total = int(s["requests_total"])
                avg_latency = (float(s["total_latency_ms"]) / requests_total) if requests_total > 0 else None
                out[agent] = {
                    "requests_total": requests_total,
                    "errors_total": int(s["errors_total"]),
                    "avg_latency_ms": avg_latency,
                    "last_latency_ms": s["last_latency_ms"],
                    "last_seen_epoch_ms": s["last_seen_epoch_ms"],
                    "last_error": s["last_error"],
                }
            return out
