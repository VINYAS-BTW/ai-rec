from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Set


REPO_ROOT = Path(__file__).resolve().parents[2]
ATTRIBUTES_PATH = REPO_ROOT / "docs" / "attributes.csv"
RELATIONS_PATH = REPO_ROOT / "docs" / "relations.csv"


@dataclass(frozen=True)
class DomainAttribute:
    name: str
    required: bool


class AttributesRegistry:
    """
    Loads docs/attributes.csv.

    We use it for:
    - validation (context keys must be known attributes per domain)
    - simple domain inference heuristics based on context keys
    """

    def __init__(self):
        self._domain_to_attributes: Dict[str, Dict[str, DomainAttribute]] = {}
        self._load()

    def _load(self) -> None:
        if not ATTRIBUTES_PATH.exists():
            # Keep service runnable even if docs are moved; downstream will use no validation.
            return

        with ATTRIBUTES_PATH.open("r", newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                domain_slug = (row.get("Domain Slug") or "").strip()
                attr_name = (row.get("Attribute Name") or "").strip()
                required_raw = (row.get("Required") or "").strip().lower()
                required = required_raw in ("yes", "true", "1", "y")
                if not domain_slug or not attr_name:
                    continue

                self._domain_to_attributes.setdefault(domain_slug, {})[attr_name] = DomainAttribute(
                    name=attr_name, required=required
                )

    def allowed_keys(self, domain_slug: str) -> Set[str]:
        attrs = self._domain_to_attributes.get(domain_slug, {})
        return set(attrs.keys())

    def infer_domains(self, context: Dict[str, object]) -> List[str]:
        """
        Simple heuristic:
        - material_id -> supply_chain_materials
        - sku_id -> supply_chain_skus
        - supplier_name/supplier_id -> supply_chain_suppliers
        - warehouse_id -> logistics_warehouses
        - lane_id/origin_region/dest_region -> logistics_lanes
        - carrier_name -> logistics_carriers
        - otherwise: return all domains
        """
        keys = {str(k) for k in (context or {}).keys()}
        if "material_id" in keys:
            return ["supply_chain_materials"]
        if "sku_id" in keys:
            return ["supply_chain_skus"]
        if "supplier_name" in keys or "supplier_id" in keys:
            return ["supply_chain_suppliers"]
        if "warehouse_id" in keys:
            return ["logistics_warehouses"]
        if "lane_id" in keys or ("origin_region" in keys and "dest_region" in keys):
            return ["logistics_lanes"]
        if "carrier_name" in keys or "carrier_type" in keys or "capacity_type" in keys:
            return ["logistics_carriers"]

        # Fallback
        return list(self._domain_to_attributes.keys())

    def all_domains(self) -> List[str]:
        return list(self._domain_to_attributes.keys())

