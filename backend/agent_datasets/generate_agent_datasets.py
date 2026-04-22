import math
from pathlib import Path

import numpy as np
import pandas as pd


OUTPUT_DIR = Path(__file__).resolve().parent


def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


def _make_ids(prefix: str, n: int) -> list[str]:
    return [f"{prefix}{i:04d}" for i in range(1, n + 1)]


def _choose_weighted(rng: np.random.Generator, items: list, probs: list[float]):
    probs_arr = np.array(probs, dtype=float)
    probs_arr = probs_arr / probs_arr.sum()
    return items[int(rng.choice(len(items), p=probs_arr))]


def _generate_boolean_y_n(rng: np.random.Generator, p_true: float) -> str:
    return "Y" if rng.random() < p_true else "N"


def _ensure_sorted_transit(rng: np.random.Generator, avg: float) -> tuple[float, float, float]:
    # Keep min <= avg <= max
    spread_low = rng.uniform(0.5, 6.0)
    spread_high = rng.uniform(2.0, 12.0)
    min_v = max(0.5, avg - spread_low)
    max_v = avg + spread_high
    return min_v, avg, max_v


def generate_logistics_suppliers(rng: np.random.Generator, n_items: int) -> pd.DataFrame:
    # In docs/attributes.csv, `item_id` is described as the unique supplier identifier.
    # We treat suppliers' `item_id` as the canonical `supplier_id` for joins.
    supplier_item_id = _make_ids("SUP", n_items)
    supplier_names = [f"Supplier_{i:04d}" for i in range(1, n_items + 1)]

    regions = ["North", "South", "East", "West", "Central"]
    countries = ["US", "IN", "DE", "CN", "SG", "BR", "MX"]
    categories = [
        "electronics",
        "metals",
        "chemicals",
        "packaging",
        "plastics",
        "fasteners",
        "components",
    ]
    payment_terms = ["Net 15", "Net 30", "Net 45", "Net 60"]
    risk_choices = ["low", "medium", "high"]

    # Base scores
    quality_score = rng.integers(55, 100, size=n_items).astype(float)
    reliability_score = np.clip(
        quality_score + rng.normal(0.0, 6.5, size=n_items), 0, 100
    ).astype(float)
    lead_time_days = np.clip(rng.normal(18, 8, size=n_items), 4, 60).astype(float)

    # risk correlated with reliability
    risk_rating = []
    for rel in reliability_score:
        if rel >= 85:
            risk_rating.append("low")
        elif rel >= 70:
            risk_rating.append("medium")
        else:
            risk_rating.append("high")

    # Costs / MOQ / values
    min_order_qty = np.clip(rng.lognormal(mean=3.2, sigma=0.7, size=n_items), 5, 5000).astype(int)
    min_order_value = np.clip(rng.lognormal(mean=10.0, sigma=0.55, size=n_items), 500, 200000).astype(int)

    df = pd.DataFrame(
        {
            "item_id": supplier_item_id,
            "supplier_name": supplier_names,
            "category": rng.choice(categories, size=n_items),
            "region": rng.choice(regions, size=n_items),
            "country": rng.choice(countries, size=n_items),
            "lead_time_days": lead_time_days,
            "min_order_value": min_order_value,
            "min_order_qty": min_order_qty,
            "payment_terms": rng.choice(payment_terms, size=n_items),
            "quality_score": quality_score,
            "reliability_score": reliability_score,
            "risk_rating": risk_rating,
        }
    )

    return df


def generate_logistics_materials(
    rng: np.random.Generator, n_items: int, suppliers: pd.DataFrame, n_skus_for_bom: int
) -> tuple[pd.DataFrame, list[str]]:
    material_item_id = _make_ids("MATI", n_items)
    material_id = _make_ids("MAT", n_items)
    material_type_choices = ["steel", "aluminum", "plastic", "glass", "textile", "electronics", "chem_pack"]
    spec_grade_choices = ["Grade A", "Grade B", "Grade C", "Premium"]
    unit_choices = ["kg", "g", "pcs", "box", "meter", "liter"]
    category_choices = ["raw", "component", "consumable", "pack", "sub-assembly"]

    # Link each material to a supplier by supplier_id (from supplier dataset)
    suppliers_rows = suppliers.reset_index(drop=True)
    # suppliers' canonical join identifier is suppliers.item_id (per docs/attributes.csv)
    supplier_ids = suppliers_rows["item_id"]

    supplier_id = rng.choice(supplier_ids.tolist(), size=n_items)
    # Derive supplier lead_time_days for materials
    supplier_lead_map = dict(zip(supplier_ids.tolist(), suppliers_rows["lead_time_days"].astype(float).tolist()))
    lead_time_days = np.array([supplier_lead_map.get(sid, 18.0) for sid in supplier_id], dtype=float)
    lead_time_days = np.clip(lead_time_days + rng.normal(0.0, 4.5, size=n_items), 2, 80)

    # Shelf life: correlated with type
    type_to_shelf = {
        "steel": (700, 1200),
        "aluminum": (600, 1100),
        "plastic": (500, 900),
        "glass": (800, 1400),
        "textile": (200, 500),
        "electronics": (180, 420),
        "chem_pack": (120, 360),
    }
    chosen_types = rng.choice(material_type_choices, size=n_items)
    shelf_low = np.array([type_to_shelf[t][0] for t in chosen_types], dtype=float)
    shelf_high = np.array([type_to_shelf[t][1] for t in chosen_types], dtype=float)
    shelf_life_days = rng.uniform(shelf_low, shelf_high)

    # Price: correlated with type and grade
    chosen_grades = rng.choice(spec_grade_choices, size=n_items)
    grade_multiplier = np.array(
        [
            1.35 if g == "Premium" else 1.15 if g == "Grade A" else 0.95 if g == "Grade B" else 0.7
            for g in chosen_grades
        ],
        dtype=float,
    )
    base_price = rng.lognormal(mean=4.3, sigma=0.6, size=n_items)
    type_multiplier = np.array([1.6 if t in ("electronics", "chem_pack") else 1.2 if t in ("steel", "aluminum") else 1.0 for t in chosen_types])
    price_per_unit = (base_price * grade_multiplier * type_multiplier).round(2)

    min_order_qty = np.clip(rng.lognormal(mean=2.9, sigma=0.6, size=n_items), 1, 4000).astype(int)

    # We'll fill bom_parent_sku later once we have SKUs.
    bom_parent_sku_placeholder = ["PENDING"] * n_items

    # Substitute ids: 1-3 random other materials (string cell)
    substitute_ids = []
    for i in range(n_items):
        k = int(rng.integers(1, 4))
        # pick indices different from i
        candidates = [j for j in range(n_items) if j != i]
        pick = rng.choice(candidates, size=min(k, n_items - 1), replace=False)
        substitute_ids.append(",".join([material_id[int(j)].strip() for j in pick]))

    df = pd.DataFrame(
        {
            "item_id": material_item_id,
            "material_id": material_id,
            "material_type": chosen_types,
            "spec_grade": chosen_grades,
            "unit": rng.choice(unit_choices, size=n_items),
            "supplier_id": supplier_id,
            "category": rng.choice(category_choices, size=n_items),
            "lead_time_days": lead_time_days,
            "min_order_qty": min_order_qty,
            "price_per_unit": price_per_unit,
            "shelf_life_days": shelf_life_days,
            "substitute_ids": substitute_ids,
            "bom_parent_sku": bom_parent_sku_placeholder,
        }
    )
    return df, material_id


def generate_logistics_skus(
    rng: np.random.Generator,
    n_items: int,
    suppliers: pd.DataFrame,
    materials: pd.DataFrame,
) -> tuple[pd.DataFrame, dict[str, list[str]]]:
    sku_item_id = _make_ids("SKUI", n_items)
    sku_id = _make_ids("SKU", n_items)

    regions = ["North", "South", "East", "West", "Central"]
    countries = ["US", "IN", "DE", "CN", "SG", "BR", "MX"]
    category_choices = ["finished", "kit", "spares", "consumable", "assembly"]
    brands = ["Astra", "Zenith", "Kite", "Orion", "Nova", "Vertex", "Cobalt"]
    subcategories = ["standard", "premium", "economy", "industrial", "retail"]
    unit_choices = ["pcs", "box", "kg", "meter"]
    abc_choices = ["A", "B", "C"]
    demand_vol_choices = ["low", "medium", "high"]

    suppliers_rows = suppliers.reset_index(drop=True)
    # suppliers' canonical join identifier is suppliers.item_id (per docs/attributes.csv)
    supplier_ids = suppliers_rows["item_id"].tolist()
    supplier_map = dict(zip(suppliers_rows["item_id"].tolist(), suppliers_rows["lead_time_days"].astype(float).tolist()))

    materials_rows = materials.reset_index(drop=True)
    material_ids = materials_rows["material_id"].tolist()
    material_supplier_map = dict(zip(materials_rows["material_id"].tolist(), materials_rows["supplier_id"].tolist()))
    material_lead_map = dict(zip(materials_rows["material_id"].tolist(), materials_rows["lead_time_days"].astype(float).tolist()))
    material_weight_map = dict(zip(materials_rows["material_id"].tolist(), (rng.uniform(0.1, 6.0, size=len(materials_rows))).astype(float)))
    material_vol_map = dict(zip(materials_rows["material_id"].tolist(), (rng.uniform(0.01, 0.8, size=len(materials_rows))).astype(float)))

    # For each SKU, choose BOM materials and derive supplier_id as the most common BOM supplier.
    sku_material_ids = []
    sku_supplier_ids = []
    material_to_skus: dict[str, list[str]] = {mid: [] for mid in material_ids}

    for i in range(n_items):
        k = int(rng.integers(3, 8))  # BOM size
        bom = rng.choice(material_ids, size=k, replace=False).tolist()
        sku_material_ids.append(",".join(bom))
        suppliers_for_bom = [material_supplier_map[m] for m in bom]
        # most common
        unique, counts = np.unique(suppliers_for_bom, return_counts=True)
        supplier_for_sku = unique[int(np.argmax(counts))]
        sku_supplier_ids.append(supplier_for_sku)
        for m in bom:
            material_to_skus[m].append(sku_id[i])

    # Derive lead_time_days as BOM lead_time avg plus supplier base
    lead_time_days = []
    weight_kg = []
    volume_cbm = []
    for i in range(n_items):
        bom_ids = sku_material_ids[i].split(",")
        bom_leads = [material_lead_map[m] for m in bom_ids if m in material_lead_map]
        avg_bom_lead = float(np.mean(bom_leads)) if bom_leads else 18.0
        supplier_base = supplier_map.get(sku_supplier_ids[i], 18.0)
        lead_time_days.append(float(np.clip((avg_bom_lead * 0.7 + supplier_base * 0.3) + rng.normal(0, 3.0), 2, 90)))

        bom_w = [material_weight_map[m] for m in bom_ids if m in material_weight_map]
        bom_v = [material_vol_map[m] for m in bom_ids if m in material_vol_map]
        weight_kg.append(float(np.clip(np.sum(bom_w) * rng.uniform(0.7, 1.1), 0.5, 250)))
        volume_cbm.append(float(np.clip(np.sum(bom_v) * rng.uniform(0.7, 1.1), 0.01, 40)))

    demand_volatility = rng.choice(demand_vol_choices, size=n_items)
    abc_class = rng.choice(abc_choices, size=n_items, p=[0.25, 0.45, 0.30])

    min_order_qty = np.clip(rng.lognormal(mean=2.2, sigma=0.7, size=n_items), 1, 10000).astype(int)
    lead_time_days = np.array(lead_time_days, dtype=float)

    # Demand shaping
    demand_scale = np.array([1.2 if v == "high" else 0.9 if v == "medium" else 0.6 for v in demand_volatility], dtype=float)
    reorder_point = np.clip((min_order_qty * 0.4 * demand_scale * rng.uniform(0.7, 1.3)).round().astype(int), 1, 200000)
    safety_stock = np.clip((min_order_qty * (0.15 + 0.10 * (demand_scale - 0.6)) * rng.uniform(0.7, 1.6)).round().astype(int), 1, 200000)

    # Price & cost: correlated with demand volatility and abc class
    base_price = rng.lognormal(mean=3.0, sigma=0.65, size=n_items)
    abc_mult = np.array([1.55 if a == "A" else 1.15 if a == "B" else 0.85 for a in abc_class], dtype=float)
    volatility_mult = demand_scale
    price = (base_price * abc_mult * volatility_mult).round(2)
    cost = (price * rng.uniform(0.45, 0.75, size=n_items)).round(2)

    df = pd.DataFrame(
        {
            "item_id": sku_item_id,
            "sku_id": sku_id,
            "category": rng.choice(category_choices, size=n_items),
            "brand": rng.choice(brands, size=n_items),
            "subcategory": rng.choice(subcategories, size=n_items),
            "unit": rng.choice(unit_choices, size=n_items),
            "lead_time_days": lead_time_days,
            "min_order_qty": min_order_qty,
            "reorder_point": reorder_point,
            "safety_stock": safety_stock,
            "weight_kg": weight_kg,
            "volume_cbm": volume_cbm,
            "supplier_id": sku_supplier_ids,
            "material_ids": sku_material_ids,
            "abc_class": abc_class,
            "demand_volatility": demand_volatility,
            "price": price,
            "cost": cost,
        }
    )
    return df, material_to_skus


def generate_material_bom_parents(materials: pd.DataFrame, material_to_skus: dict[str, list[str]], rng: np.random.Generator) -> pd.DataFrame:
    parent_skus = []
    for mid in materials["material_id"].tolist():
        candidates = material_to_skus.get(mid, [])
        if candidates:
            parent_skus.append(rng.choice(candidates))
        else:
            parent_skus.append("SKU-UNKNOWN")
    out = materials.copy()
    out["bom_parent_sku"] = parent_skus
    return out


def generate_logistics_carriers(rng: np.random.Generator, n_items: int) -> pd.DataFrame:
    carrier_item_id = _make_ids("CARRI", n_items)
    carrier_name = [f"Carrier_{i:04d}" for i in range(1, n_items + 1)]

    regions = ["North", "South", "East", "West", "Central"]
    countries = ["US", "IN", "DE", "CN", "SG", "BR", "MX"]
    modes = ["road", "rail", "air", "sea", "multimodal"]
    capacity_types = ["FTL", "LTL", "parcel"]
    capacity_units = ["kg", "cbm", "teu"]
    service_levels = ["express", "standard", "economy"]
    carrier_types = ["asset", "non-asset"]
    certification_pool = ["C-TPAT", "ISO", "TAPA"]
    currencies = {"US": "USD", "IN": "INR", "DE": "EUR", "CN": "CNY", "SG": "SGD", "BR": "BRL", "MX": "MXN"}

    chosen_mode = rng.choice(modes, size=n_items)
    avg_transit_days = []
    min_transit_days = []
    max_transit_days = []

    for m in chosen_mode:
        base = {"road": 4, "rail": 7, "air": 2, "sea": 18, "multimodal": 9}[m]
        avg = float(np.clip(rng.normal(base, 1.6), 0.8, 60))
        mn, av, mx = _ensure_sorted_transit(rng, avg)
        min_transit_days.append(mn)
        avg_transit_days.append(av)
        max_transit_days.append(mx)

    avg_transit_days = np.array(avg_transit_days, dtype=float)
    min_transit_days = np.array(min_transit_days, dtype=float)
    max_transit_days = np.array(max_transit_days, dtype=float)

    temp_ctrl = np.array([_generate_boolean_y_n(rng, 0.25 if m in ("road", "rail") else 0.35) for m in chosen_mode])
    haz = np.array([_generate_boolean_y_n(rng, 0.18 if m == "air" else 0.28) for m in chosen_mode])
    tracking = np.array([_generate_boolean_y_n(rng, 0.65 if m in ("road", "multimodal") else 0.55) for m in chosen_mode])

    capacity_type = rng.choice(capacity_types, size=n_items)
    capacity_unit = rng.choice(capacity_units, size=n_items)
    region = rng.choice(regions, size=n_items)
    country = rng.choice(countries, size=n_items)
    currency = [currencies[c] for c in country]

    service_level = rng.choice(service_levels, size=n_items, p=[0.35, 0.45, 0.20])
    carrier_type = rng.choice(carrier_types, size=n_items, p=[0.6, 0.4])

    certifications = []
    for _ in range(n_items):
        k = int(rng.integers(0, 3))  # maybe none
        if k == 0:
            certifications.append("")
        else:
            pick = rng.choice(certification_pool, size=k, replace=False).tolist()
            certifications.append("|".join(pick))

    # Cost: lower transit tends to higher cost; keep positive
    base_cost = rng.lognormal(mean=2.6, sigma=0.35, size=n_items)  # "cost per kg" baseline
    cost_per_kg = np.clip(base_cost * (1.8 - (avg_transit_days / 40.0)) * rng.uniform(0.8, 1.3, size=n_items), 0.05, 50)
    cost_per_shipment_base = np.clip(
        rng.lognormal(mean=9.2, sigma=0.35, size=n_items) * (0.7 + (avg_transit_days / 30.0)) * rng.uniform(0.8, 1.3, size=n_items),
        50,
        200000,
    )

    # Reliability depends on tracking + service_level
    reliab = 40 + 0.35 * avg_transit_days * (-1)  # shorter transit => higher reliability
    reliab = reliab + rng.normal(0, 10, size=n_items)
    tracking_boost = np.array([1.0 if t == "Y" else 0.0 for t in tracking], dtype=float) * 12.0
    service_boost = np.array(
        [12.0 if s == "express" else 7.0 if s == "standard" else 3.0 for s in service_level], dtype=float
    )
    reliability_score = np.clip(55 + tracking_boost + service_boost - (avg_transit_days * 0.9) + rng.normal(0, 7, size=n_items), 0, 100)
    on_time_pct_typical = np.clip(40 + reliability_score * 0.7 + rng.normal(0, 8, size=n_items), 0, 100)

    # capacity / service features for filters
    df = pd.DataFrame(
        {
            "item_id": carrier_item_id,
            "carrier_name": carrier_name,
            "mode": chosen_mode,
            "region": region,
            "country": country,
            "capacity_type": capacity_type,
            "capacity_unit": capacity_unit,
            "avg_transit_days": avg_transit_days,
            "max_transit_days": max_transit_days,
            "min_transit_days": min_transit_days,
            "service_level": service_level,
            "temperature_controlled": temp_ctrl,
            "hazardous_capable": haz,
            "tracking_available": tracking,
            "carrier_type": carrier_type,
            "certifications": certifications,
            "cost_per_kg": np.round(cost_per_kg, 4),
            "cost_per_shipment_base": np.round(cost_per_shipment_base, 2),
            "currency": currency,
            "reliability_score": np.round(reliability_score, 2),
            "on_time_pct_typical": np.round(on_time_pct_typical, 2),
        }
    )
    return df


def generate_logistics_lanes(rng: np.random.Generator, n_items: int) -> pd.DataFrame:
    lane_item_id = _make_ids("LANEI", n_items)
    lane_id = [f"LANE-{i:05d}" for i in range(1, n_items + 1)]

    regions = ["North", "South", "East", "West", "Central"]
    countries = ["US", "IN", "DE", "CN", "SG", "BR", "MX"]
    cities_by_region = {
        "North": ["Delhi", "Toronto", "Berlin", "Beijing"],
        "South": ["Mumbai", "Bangalore", "Munich", "Chennai"],
        "East": ["Newark", "Shenzhen", "Shanghai", "Shizuoka"],
        "West": ["Los Angeles", "Austin", "Cologne", "Phoenix"],
        "Central": ["Chicago", "Pune", "Frankfurt", "Hyderabad"],
    }

    modes = ["road", "rail", "air", "sea"]

    origin_region = rng.choice(regions, size=n_items)
    dest_region = rng.choice(regions, size=n_items)
    origin_country = rng.choice(countries, size=n_items)
    dest_country = rng.choice(countries, size=n_items)
    # make some cross-region but keep origin/dest distinct usually
    same_mask = origin_region == dest_region
    dest_region[same_mask] = rng.choice([r for r in regions if r != "Central"], size=int(same_mask.sum()))

    def pick_city(region: str) -> str:
        return rng.choice(cities_by_region[region])

    origin_city = [pick_city(r) for r in origin_region]
    dest_city = [pick_city(r) for r in dest_region]

    mode = rng.choice(modes, size=n_items)
    customs_required = np.array(
        ["Y" if origin_country[i] != dest_country[i] and rng.random() < 0.85 else "N" for i in range(n_items)]
    )

    # Distance by mode
    distance_km = []
    typical_volume_teu = []
    transit_days_typical = []
    avg_cost_per_shipment = []

    for i in range(n_items):
        m = mode[i]
        dist_base = {"road": 450, "rail": 900, "air": 750, "sea": 2400}[m]
        dist = float(np.clip(rng.normal(dist_base, dist_base * 0.25), 50, 25000))
        # Transit: distance & mode
        days_base = {"road": 2.8, "rail": 4.4, "air": 1.3, "sea": 10.0}[m]
        transit = float(np.clip(rng.normal(days_base + dist / 1200.0, 1.6), 0.6, 120))
        volume = float(np.clip(rng.normal({"road": 0.8, "rail": 1.5, "air": 0.25, "sea": 8.0}[m], 0.35), 0.05, 120))
        cost = float(np.clip(rng.lognormal(mean=np.log(1200), sigma=0.5) * (0.4 + dist / 6000.0) * ({ "road": 1.0, "rail": 0.85, "air": 2.6, "sea": 0.65}[m]), 30, 1_000_000))
        if customs_required[i] == "Y":
            cost *= rng.uniform(1.05, 1.4)

        distance_km.append(dist)
        typical_volume_teu.append(volume)
        transit_days_typical.append(transit)
        avg_cost_per_shipment.append(cost)

    # Output
    df = pd.DataFrame(
        {
            "item_id": lane_item_id,
            "lane_id": lane_id,
            "origin_region": origin_region,
            "origin_country": origin_country,
            "origin_city": origin_city,
            "dest_region": dest_region,
            "dest_country": dest_country,
            "dest_city": dest_city,
            "mode": mode,
            "distance_km": np.round(distance_km, 2),
            "typical_volume_teu": np.round(typical_volume_teu, 3),
            "transit_days_typical": np.round(transit_days_typical, 2),
            "avg_cost_per_shipment": np.round(avg_cost_per_shipment, 2),
            "customs_required": customs_required,
        }
    )
    return df


def generate_logistics_warehouses(rng: np.random.Generator, n_items: int) -> pd.DataFrame:
    warehouse_item_id = _make_ids("WARI", n_items)
    warehouse_id = [f"WH-{i:05d}" for i in range(1, n_items + 1)]

    regions = ["North", "South", "East", "West", "Central"]
    countries = ["US", "IN", "DE", "CN", "SG", "BR", "MX"]
    cities = ["Aurora", "Pune", "Mumbai", "Austin", "Chicago", "Frankfurt", "Chennai", "Bangalore", "Berlin"]

    temp_zone = rng.choice(["ambient", "chilled", "frozen"], size=n_items, p=[0.55, 0.30, 0.15])
    capabilities_pool = ["pick/pack", "cross-dock", "returns", "kitting", "VAS"]

    automation_level = rng.choice(["manual", "semi-auto", "full-auto"], size=n_items, p=[0.30, 0.45, 0.25])

    region = rng.choice(regions, size=n_items)
    country = rng.choice(countries, size=n_items)
    city = rng.choice(cities, size=n_items)

    capacity_sqft = np.clip(rng.lognormal(mean=8.0, sigma=0.35, size=n_items), 50_000, 4_000_000).astype(float)
    capacity_pallets = np.clip((capacity_sqft / rng.uniform(25, 45, size=n_items)).astype(float), 1_000, 200_000)
    capacity_volume_cbm = np.clip((capacity_sqft / rng.uniform(3.0, 5.0, size=n_items)).astype(float), 1_000, 220_000)

    hazmat_capable = np.array([_generate_boolean_y_n(rng, 0.10 if tz == "ambient" else 0.22) for tz in temp_zone])

    last_mile_radius_km = np.round(np.clip(rng.normal(35, 12, size=n_items), 5, 120), 2)

    capabilities = []
    for _ in range(n_items):
        k = int(rng.integers(1, 4))
        pick = rng.choice(capabilities_pool, size=k, replace=False).tolist()
        capabilities.append("|".join(pick))

    lead_time_base = np.clip(rng.normal(6.5, 2.8, size=n_items), 1.0, 25.0)
    receipt_boost = np.array([0.8 if a == "full-auto" else 1.1 if a == "semi-auto" else 1.35 for a in automation_level])
    ship_boost = np.array([0.9 if a == "full-auto" else 1.1 if a == "semi-auto" else 1.25 for a in automation_level])
    lead_time_days_receipt = np.round(lead_time_base * receipt_boost + rng.normal(0.0, 0.9, size=n_items), 2)
    lead_time_days_ship = np.round(lead_time_base * ship_boost + rng.normal(0.0, 1.1, size=n_items), 2)

    df = pd.DataFrame(
        {
            "item_id": warehouse_item_id,
            "warehouse_id": warehouse_id,
            "location": [f"{rng.choice(['Main St', 'Industrial Rd', 'Harbor Way', 'Market Blvd'])} {i}" for i in range(1, n_items + 1)],
            "country": country,
            "region": region,
            "city": city,
            "capacity_sqft": np.round(capacity_sqft, 2),
            "capacity_pallets": np.round(capacity_pallets, 0).astype(int),
            "capacity_volume_cbm": np.round(capacity_volume_cbm, 2),
            "capabilities": capabilities,
            "temperature_zone": temp_zone,
            "hazmat_capable": hazmat_capable,
            "lead_time_days_receipt": lead_time_days_receipt,
            "lead_time_days_ship": lead_time_days_ship,
            "last_mile_radius_km": last_mile_radius_km,
            "automation_level": automation_level,
        }
    )
    return df


def _generate_interactions_from_score(
    rng: np.random.Generator,
    content: pd.DataFrame,
    item_id_col: str,
    user_count: int,
    interactions_per_user: int,
    score_func,
    extra_columns: dict[str, callable],
    rating_scale=(1, 5),
) -> pd.DataFrame:
    users = _make_ids("U", user_count)
    interactions = []
    for uid in users:
        for _ in range(interactions_per_user):
            item_row = content.iloc[int(rng.integers(0, len(content)))]
            iid = item_row[item_id_col]
            base_score = float(score_func(uid, item_row))
            # normalize-ish with sigmoid around typical range
            # base_score is already roughly in a comparable range; use scaling for stable rating.
            s = _sigmoid(base_score / 10.0)
            rating = rating_scale[0] + (rating_scale[1] - rating_scale[0]) * s
            rating = int(_clamp(int(round(rating)), rating_scale[0], rating_scale[1]))

            row = {"user_id": uid, "item_id": iid, "rating": float(rating)}
            for col_name, fn in extra_columns.items():
                row[col_name] = fn(uid, item_row, rating)
            interactions.append(row)
    return pd.DataFrame(interactions)


def generate_carriers_interactions(rng: np.random.Generator, carriers: pd.DataFrame, user_count: int, interactions_per_user: int) -> pd.DataFrame:
    def score(uid, row):
        reliability = float(row["reliability_score"])
        on_time = float(row["on_time_pct_typical"])
        avg_transit = float(row["avg_transit_days"])
        cost = float(row["cost_per_shipment_base"])
        # lower cost better; combine
        cost_norm = cost / 50000.0
        tracking = 1.0 if row["tracking_available"] == "Y" else 0.0
        temp = 1.0 if row["temperature_controlled"] == "Y" else 0.0
        return (0.45 * reliability + 0.35 * on_time) - (0.35 * avg_transit) - (0.20 * cost_norm * 100) + 8.0 * tracking + 4.0 * temp

    def shipment_count(uid, row, rating):
        base = rng.uniform(5, 30) * (0.7 + 0.15 * rating)
        return int(np.clip(rng.poisson(base), 1, 2500))

    def total_spend(uid, row, rating):
        sc = shipment_count(uid, row, rating)
        base_cost = float(row["cost_per_shipment_base"])
        return float(np.round(sc * base_cost * rng.uniform(0.75, 1.25), 2))

    def transit_days_actual(uid, row, rating):
        mn = float(row["min_transit_days"])
        mx = float(row["max_transit_days"])
        avg = float(row["avg_transit_days"])
        # Higher rating => closer to avg; add noise
        noise = rng.normal(0.0, 1.2 + (6 - rating) * 0.25)
        val = avg + noise
        return float(np.round(np.clip(val, mn, mx), 2))

    extra = {
        "shipment_count": shipment_count,
        "total_spend": total_spend,
        "transit_days_actual": transit_days_actual,
    }
    return _generate_interactions_from_score(
        rng,
        carriers,
        "item_id",
        user_count,
        interactions_per_user,
        score,
        extra_columns=extra,
    )


def generate_lanes_interactions(rng: np.random.Generator, lanes: pd.DataFrame, user_count: int, interactions_per_user: int) -> pd.DataFrame:
    def score(uid, row):
        transit = float(row["transit_days_typical"])
        cost = float(row["avg_cost_per_shipment"])
        volume = float(row["typical_volume_teu"])
        customs = 1.0 if row["customs_required"] == "Y" else 0.0
        # lower transit and cost preferred, customs slight penalty
        cost_norm = cost / 200000.0
        return (80.0 - transit * 6.0) + (volume * 3.0) - (cost_norm * 30.0) - (customs * 5.0) + rng.normal(0, 3.5)

    def volume_shipped(uid, row, rating):
        base = float(row["typical_volume_teu"])
        return float(np.round(np.clip(base * rng.uniform(0.6, 1.8) * (0.85 + 0.10 * rating), 0.05, 5000), 3))

    def frequency(uid, row, rating):
        base = 4 + rating * 1.2
        # customs lanes might be used less
        penalty = 0.8 if row["customs_required"] == "Y" else 1.0
        return float(np.round(np.clip(rng.poisson(base * penalty) + 1, 1, 2000), 0))

    def total_spend(uid, row, rating):
        vol = volume_shipped(uid, row, rating)
        cost = float(row["avg_cost_per_shipment"])
        freq = int(frequency(uid, row, rating))
        return float(np.round(freq * cost * rng.uniform(0.65, 1.2) * (0.35 + 0.65 * (vol / max(float(row["typical_volume_teu"]), 0.05))), 2))

    extra = {
        "volume_shipped": volume_shipped,
        "frequency": frequency,
        "total_spend": total_spend,
    }
    return _generate_interactions_from_score(
        rng,
        lanes,
        "item_id",
        user_count,
        interactions_per_user,
        score,
        extra_columns=extra,
    )


def generate_warehouses_interactions(rng: np.random.Generator, warehouses: pd.DataFrame, user_count: int, interactions_per_user: int) -> pd.DataFrame:
    def score(uid, row):
        receipt = float(row["lead_time_days_receipt"])
        ship = float(row["lead_time_days_ship"])
        last_mile = float(row["last_mile_radius_km"])
        cap = float(row["capacity_volume_cbm"])
        automation = row["automation_level"]
        auto_boost = 6.0 if automation == "full-auto" else 3.0 if automation == "semi-auto" else 0.0
        haz = 1.0 if row["hazmat_capable"] == "Y" else 0.0
        # lower lead times better; larger capacity and radius helps
        return (120.0 - (receipt + ship) * 6.0) + (last_mile * 0.25) + (cap / 500.0) + auto_boost + haz * 2.0 + rng.normal(0, 3.0)

    def orders_fulfilled(uid, row, rating):
        base = float(row["capacity_volume_cbm"]) / 800.0
        return int(np.clip(rng.poisson(base * (0.8 + 0.20 * rating)) + 1, 1, 200000))

    def storage_units(uid, row, rating):
        base = float(row["capacity_sqft"]) / 20_000.0
        return int(np.clip(rng.poisson(base * (0.7 + 0.25 * rating)) + 1, 10, 500000))

    def throughput_units(uid, row, rating):
        base = float(row["capacity_pallets"]) / 800.0
        mult = 1.1 if row["automation_level"] == "full-auto" else 1.0 if row["automation_level"] == "semi-auto" else 0.85
        return int(np.clip(rng.poisson(base * mult * (0.7 + 0.25 * rating)) + 1, 10, 500000))

    extra = {
        "orders_fulfilled": orders_fulfilled,
        "storage_units": storage_units,
        "throughput_units": throughput_units,
    }
    return _generate_interactions_from_score(
        rng,
        warehouses,
        "item_id",
        user_count,
        interactions_per_user,
        score,
        extra_columns=extra,
    )


def generate_suppliers_interactions(rng: np.random.Generator, suppliers: pd.DataFrame, user_count: int, interactions_per_user: int) -> pd.DataFrame:
    def score(uid, row):
        lead = float(row["lead_time_days"])
        rel = float(row["reliability_score"])
        qual = float(row["quality_score"])
        risk = row["risk_rating"]
        risk_pen = 0.0 if risk == "low" else 8.0 if risk == "medium" else 20.0
        return (0.45 * rel + 0.25 * qual) - (lead * 0.8) - risk_pen + rng.normal(0, 4.0)

    def orders_placed(uid, row, rating):
        base = float(row["min_order_qty"]) / 6.0
        return int(np.clip(rng.poisson(base * (0.8 + 0.22 * rating)) + 1, 1, 200000))

    def total_spend(uid, row, rating):
        orders = orders_placed(uid, row, rating)
        base_val = float(row["min_order_value"])
        return float(np.round(orders * (base_val / max(float(row["min_order_qty"]), 1.0)) * rng.uniform(0.7, 1.2) * 0.02, 2))

    def defect_rate(uid, row, rating):
        rel = float(row["reliability_score"])
        risk = row["risk_rating"]
        base_def = 0.04 if risk == "low" else 0.08 if risk == "medium" else 0.14
        # rating reduces defect rate
        return float(np.round(np.clip(base_def + rng.normal(0, 0.015) - (rating - 1) * 0.006 + (90 - rel) * 0.0004, 0.0, 0.35), 4))

    def on_time_delivery_pct(uid, row, rating):
        rel = float(row["reliability_score"])
        base = 45 + rel * 0.55
        # rating slightly higher => closer to base
        return float(np.round(np.clip(base + rng.normal(0, 6.0) + (rating - 3) * 3.0, 0, 100), 2))

    extra = {
        "orders_placed": orders_placed,
        "total_spend": total_spend,
        "defect_rate": defect_rate,
        "on_time_delivery_pct": on_time_delivery_pct,
    }
    return _generate_interactions_from_score(
        rng,
        suppliers,
        "item_id",
        user_count,
        interactions_per_user,
        score,
        extra_columns=extra,
    )


def generate_materials_interactions(rng: np.random.Generator, materials: pd.DataFrame, user_count: int, interactions_per_user: int) -> pd.DataFrame:
    def score(uid, row):
        lead = float(row["lead_time_days"])
        shelf = float(row["shelf_life_days"])
        price = float(row["price_per_unit"])
        spec = row["spec_grade"]
        spec_boost = 10.0 if spec == "Premium" else 5.0 if spec == "Grade A" else 0.0 if spec == "Grade B" else -6.0
        return (shelf / 20.0) - (lead * 0.7) - (price / 20.0) + spec_boost + rng.normal(0, 3.5)

    def consumption_qty(uid, row, rating):
        base = float(row["min_order_qty"]) * 0.6
        return int(np.clip(rng.poisson(base * (0.7 + 0.25 * rating)) + 1, 1, 500000))

    def orders_placed(uid, row, rating):
        base = float(row["min_order_qty"]) / 4.0
        return int(np.clip(rng.poisson(base * (0.8 + 0.2 * rating)) + 1, 1, 200000))

    def stockouts(uid, row, rating):
        lead = float(row["lead_time_days"])
        # lower lead => fewer stockouts; rating reduces
        base = 6 + lead * 0.05
        return int(np.clip(rng.poisson(base * (0.8 - 0.12 * (rating - 1))) + rng.integers(0, 2), 0, 2000))

    def wastage_rate(uid, row, rating):
        shelf = float(row["shelf_life_days"])
        spec = row["spec_grade"]
        spec_waste = 0.06 if spec == "Premium" else 0.10 if spec == "Grade A" else 0.13 if spec == "Grade B" else 0.18
        lead = float(row["lead_time_days"])
        base = spec_waste + (lead / 200.0) - (shelf / 5000.0)
        # rating reduces wastage
        base = base - (rating - 1) * 0.01
        return float(np.round(np.clip(base + rng.normal(0, 0.008), 0.0, 0.45), 4))

    extra = {
        "consumption_qty": consumption_qty,
        "orders_placed": orders_placed,
        "stockouts": stockouts,
        "wastage_rate": wastage_rate,
    }
    return _generate_interactions_from_score(
        rng,
        materials,
        "item_id",
        user_count,
        interactions_per_user,
        score,
        extra_columns=extra,
    )


def generate_skus_interactions(rng: np.random.Generator, skus: pd.DataFrame, user_count: int, interactions_per_user: int) -> pd.DataFrame:
    def score(uid, row):
        # fill_rate / forecast_accuracy are interaction-derived; score based on safety/reorder + demand volatility
        vol = row["demand_volatility"]
        demand_pen = 2.0 if vol == "high" else 1.0 if vol == "medium" else 0.5
        fill_proxy = (row["safety_stock"] / (row["min_order_qty"] + 1.0)) * 60.0
        reorder_proxy = (row["reorder_point"] / (row["min_order_qty"] + 1.0)) * 40.0
        return (fill_proxy + reorder_proxy) - demand_pen * 20.0 + rng.normal(0, 5.0)

    def demand_qty(uid, row, rating):
        base = float(row["reorder_point"]) * (0.3 + 0.18 * rating) / max(float(row["lead_time_days"]), 1.0) * 10.0
        mult = 1.3 if row["demand_volatility"] == "high" else 1.0 if row["demand_volatility"] == "medium" else 0.75
        return int(np.clip(rng.poisson(base * mult) + 1, 1, 2_000_000))

    def orders_placed(uid, row, rating):
        base = float(row["min_order_qty"]) / 3.0
        mult = 1.0 + 0.07 * rating
        return int(np.clip(rng.poisson(base * mult) + 1, 1, 200000))

    def stockouts(uid, row, rating):
        base = 10 + (row["demand_volatility"] == "high") * 25 + (row["lead_time_days"] / 3.0)
        return int(np.clip(rng.poisson(base * (0.85 - 0.12 * (rating - 1))) , 0, 5000))

    def fill_rate(uid, row, rating):
        # Higher rating => higher fill rate; safety stock increases fill rate.
        safety = float(row["safety_stock"])
        min_qty = float(row["min_order_qty"])
        safety_proxy = safety / (min_qty + 1.0)
        base = 0.75 + 0.08 * safety_proxy + 0.02 * (rating - 3)
        base = base - (row["demand_volatility"] == "high") * 0.05
        # rating reduces stockout impact
        return float(np.round(_clamp(base + rng.normal(0, 0.03), 0.4, 0.99), 4))

    def forecast_accuracy(uid, row, rating):
        # Forecast accuracy depends on demand volatility (lower volatility => higher accuracy)
        vol = row["demand_volatility"]
        base = 0.78 if vol == "low" else 0.72 if vol == "medium" else 0.62
        base = base + (rating - 3) * 0.03 + rng.normal(0, 0.04)
        return float(np.round(_clamp(base, 0.35, 0.99), 4))

    extra = {
        "demand_qty": demand_qty,
        "orders_placed": orders_placed,
        "stockouts": stockouts,
        "fill_rate": fill_rate,
        "forecast_accuracy": forecast_accuracy,
    }
    return _generate_interactions_from_score(
        rng,
        skus,
        "item_id",
        user_count,
        interactions_per_user,
        score,
        extra_columns=extra,
    )


def main():
    # Tune these if you want bigger files.
    seed = 42
    rng = np.random.default_rng(seed)

    n_content_items = 1200  # >= 1000 values per content dataset
    user_count = 320
    interactions_per_user = 10  # interactions rows = user_count * interactions_per_user >= 1000

    # ---- Suppliers ----
    suppliers = generate_logistics_suppliers(rng, n_content_items)
    suppliers.to_csv(OUTPUT_DIR / "supply_chain_suppliers_content.csv", index=False)
    suppliers_interactions = generate_suppliers_interactions(rng, suppliers, user_count, interactions_per_user)
    suppliers_interactions.to_csv(OUTPUT_DIR / "supply_chain_suppliers_interactions.csv", index=False)

    # ---- Materials + SKUs (BOM linking) ----
    materials, material_ids = generate_logistics_materials(rng, n_content_items, suppliers, n_skus_for_bom=n_content_items)
    # generate SKUs now
    skus, material_to_skus = generate_logistics_skus(rng, n_content_items, suppliers, materials)
    # fill material bom_parent_sku based on actual BOM links to SKUs
    materials = generate_material_bom_parents(materials, material_to_skus, rng)

    materials.to_csv(OUTPUT_DIR / "supply_chain_materials_content.csv", index=False)
    skus.to_csv(OUTPUT_DIR / "supply_chain_skus_content.csv", index=False)

    materials_interactions = generate_materials_interactions(rng, materials, user_count, interactions_per_user)
    materials_interactions.to_csv(OUTPUT_DIR / "supply_chain_materials_interactions.csv", index=False)

    skus_interactions = generate_skus_interactions(rng, skus, user_count, interactions_per_user)
    skus_interactions.to_csv(OUTPUT_DIR / "supply_chain_skus_interactions.csv", index=False)

    # ---- Carriers ----
    carriers = generate_logistics_carriers(rng, n_content_items)
    carriers.to_csv(OUTPUT_DIR / "logistics_carriers_content.csv", index=False)
    carriers_interactions = generate_carriers_interactions(rng, carriers, user_count, interactions_per_user)
    carriers_interactions.to_csv(OUTPUT_DIR / "logistics_carriers_interactions.csv", index=False)

    # ---- Lanes ----
    lanes = generate_logistics_lanes(rng, n_content_items)
    lanes.to_csv(OUTPUT_DIR / "logistics_lanes_content.csv", index=False)
    lanes_interactions = generate_lanes_interactions(rng, lanes, user_count, interactions_per_user)
    lanes_interactions.to_csv(OUTPUT_DIR / "logistics_lanes_interactions.csv", index=False)

    # ---- Warehouses ----
    warehouses = generate_logistics_warehouses(rng, n_content_items)
    warehouses.to_csv(OUTPUT_DIR / "logistics_warehouses_content.csv", index=False)
    warehouses_interactions = generate_warehouses_interactions(rng, warehouses, user_count, interactions_per_user)
    warehouses_interactions.to_csv(OUTPUT_DIR / "logistics_warehouses_interactions.csv", index=False)

    print("Agent datasets generated in:", str(OUTPUT_DIR))


if __name__ == "__main__":
    main()

