"""
Experiment Service — A/B variant assignment and result aggregation.

Design:
- Deterministic hash-bucket assignment: for the same (experiment_id, bucket_key)
  we always return the same variant. No randomness drift after assignment.
- Traffic splits define weighted segments [0, 100). Bucket is computed as:
    bucket = int(sha256(f"{experiment_id}:{bucket_key}") % 100)
  then mapped to a variant based on cumulative weights.
- Results are aggregated per-variant: impressions, clicks, conversions,
  mean value, CTR, CVR, and lift vs control.
"""
from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session
from fastapi import HTTPException

import models


# ─── Deterministic assignment ─────────────────────────────────────────────────

def _bucket(experiment_id: int, bucket_key: str) -> int:
    """Return a stable integer in [0, 100) for (experiment_id, bucket_key)."""
    raw = f"{experiment_id}:{bucket_key}".encode("utf-8")
    digest = hashlib.sha256(raw).hexdigest()
    return int(digest[:8], 16) % 100


def _pick_variant(bucket: int, variants: List[Dict[str, Any]]) -> Optional[str]:
    """
    Pick a variant based on cumulative weight bands.
    variants: [{"id": "control", "weight": 50}, {"id": "variant_a", "weight": 50}]
    """
    cursor = 0
    for v in variants:
        weight = int(v.get("weight", 0))
        if cursor <= bucket < cursor + weight:
            return str(v["id"])
        cursor += weight
    return None


# ─── DB helpers ───────────────────────────────────────────────────────────────

def get_experiment(db: Session, experiment_id: int, owner_id: Optional[int] = None) -> models.ExperimentDefinition:
    exp = db.query(models.ExperimentDefinition).filter(
        models.ExperimentDefinition.id == experiment_id
    ).first()
    if not exp:
        raise HTTPException(status_code=404, detail="Experiment not found.")
    if owner_id is not None and owner_id != -1:
        if exp.owner_id is not None and exp.owner_id != owner_id:
            raise HTTPException(status_code=404, detail="Experiment not found.")
    return exp


def list_experiments(db: Session, owner_id: int) -> List[models.ExperimentDefinition]:
    from sqlalchemy import or_
    return db.query(models.ExperimentDefinition).filter(
        or_(
            models.ExperimentDefinition.owner_id == owner_id,
            models.ExperimentDefinition.owner_id.is_(None),
        )
    ).order_by(models.ExperimentDefinition.id.desc()).all()


def create_experiment(
    *,
    db: Session,
    owner_id: int,
    project_id: Optional[int],
    name: str,
    description: Optional[str],
    variants: List[Dict[str, Any]],
    traffic_split: Dict[str, int],
    goal_metric: Optional[str],
) -> models.ExperimentDefinition:
    # Validate weights sum to 100
    total_weight = sum(int(v.get("weight", 0)) for v in variants)
    if total_weight != 100:
        raise HTTPException(
            status_code=400,
            detail=f"Variant weights must sum to 100 (got {total_weight}).",
        )
    if len(variants) < 2:
        raise HTTPException(status_code=400, detail="At least 2 variants (control + treatment) required.")

    exp = models.ExperimentDefinition(
        owner_id=owner_id if owner_id != -1 else None,
        project_id=project_id,
        name=name,
        description=description,
        variants_json=json.dumps(variants),
        traffic_split_json=json.dumps(traffic_split),
        goal_metric=goal_metric,
        status=models.ExperimentStatus.DRAFT,
    )
    db.add(exp)
    db.commit()
    db.refresh(exp)
    return exp


def start_experiment(db: Session, experiment_id: int, owner_id: int) -> models.ExperimentDefinition:
    exp = get_experiment(db, experiment_id, owner_id)
    if exp.status not in (models.ExperimentStatus.DRAFT, models.ExperimentStatus.ARCHIVED):
        raise HTTPException(status_code=400, detail=f"Experiment is already {exp.status}.")
    exp.status = models.ExperimentStatus.RUNNING
    exp.started_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(exp)
    return exp


def assign_variant(
    *,
    db: Session,
    experiment_id: int,
    bucket_key: str,
    owner_id: Optional[int] = None,
) -> Tuple[str, int]:
    """
    Assign (or look up existing assignment) for bucket_key in this experiment.
    Returns (variant_id, assignment_db_id).
    """
    exp = get_experiment(db, experiment_id, owner_id)
    if exp.status != models.ExperimentStatus.RUNNING:
        raise HTTPException(status_code=400, detail=f"Experiment is not running (status={exp.status}).")

    # Check for existing assignment (idempotent)
    existing = db.query(models.ExperimentAssignment).filter(
        models.ExperimentAssignment.experiment_id == experiment_id,
        models.ExperimentAssignment.bucket_key == bucket_key,
    ).first()
    if existing:
        return existing.variant, existing.id

    variants = json.loads(exp.variants_json or "[]")
    bucket = _bucket(experiment_id, bucket_key)
    variant = _pick_variant(bucket, variants)
    if variant is None:
        # Fallback: assign to first variant (shouldn't happen if weights sum to 100)
        variant = variants[0]["id"] if variants else "control"

    assignment = models.ExperimentAssignment(
        experiment_id=experiment_id,
        bucket_key=bucket_key,
        variant=variant,
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)
    return variant, assignment.id


def record_event(
    *,
    db: Session,
    assignment_id: int,
    event_type: str,
    value: Optional[float] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> models.ExperimentEvent:
    assignment = db.query(models.ExperimentAssignment).filter(
        models.ExperimentAssignment.id == assignment_id
    ).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found.")

    ev = models.ExperimentEvent(
        assignment_id=assignment_id,
        event_type=event_type,
        value=value,
        meta_json=json.dumps(meta or {}),
    )
    db.add(ev)
    db.commit()
    db.refresh(ev)
    return ev


def get_experiment_results(db: Session, experiment_id: int, owner_id: Optional[int] = None) -> Dict[str, Any]:
    """
    Aggregate per-variant stats. Returns:
    {
      "experiment_id": ...,
      "status": ...,
      "variants": [
        {
          "variant": "control",
          "assignments": 120,
          "impressions": 115,
          "clicks": 23,
          "conversions": 10,
          "ctr": 0.2,
          "cvr": 0.087,
          "mean_value": 0.45,
          "lift_vs_control": null,  # null for control itself
        },
        ...
      ]
    }
    """
    exp = get_experiment(db, experiment_id, owner_id)
    variants_def = json.loads(exp.variants_json or "[]")
    variant_ids = [v["id"] for v in variants_def]

    # Collect all assignments
    all_assignments = db.query(models.ExperimentAssignment).filter(
        models.ExperimentAssignment.experiment_id == experiment_id
    ).all()
    assignment_id_to_variant = {a.id: a.variant for a in all_assignments}

    # Group events by variant
    variant_stats: Dict[str, Dict[str, Any]] = {
        vid: {"assignments": 0, "impressions": 0, "clicks": 0, "conversions": 0, "values": []}
        for vid in variant_ids
    }
    for a in all_assignments:
        vid = a.variant
        if vid not in variant_stats:
            variant_stats[vid] = {"assignments": 0, "impressions": 0, "clicks": 0, "conversions": 0, "values": []}
        variant_stats[vid]["assignments"] += 1
        for ev in a.events:
            et = ev.event_type
            if et == "impression":
                variant_stats[vid]["impressions"] += 1
            elif et == "click":
                variant_stats[vid]["clicks"] += 1
            elif et == "conversion":
                variant_stats[vid]["conversions"] += 1
            if ev.value is not None:
                variant_stats[vid]["values"].append(float(ev.value))

    # Build output rows
    control_cvr: Optional[float] = None
    rows = []
    for vid in list(variant_stats.keys()):
        s = variant_stats[vid]
        n = s["assignments"]
        impressions = s["impressions"]
        clicks = s["clicks"]
        conversions = s["conversions"]
        values = s["values"]
        ctr = clicks / impressions if impressions > 0 else 0.0
        cvr = conversions / n if n > 0 else 0.0
        mean_value = sum(values) / len(values) if values else None
        if vid == "control":
            control_cvr = cvr
        rows.append({
            "variant": vid,
            "assignments": n,
            "impressions": impressions,
            "clicks": clicks,
            "conversions": conversions,
            "ctr": round(ctr, 4),
            "cvr": round(cvr, 4),
            "mean_value": round(mean_value, 4) if mean_value is not None else None,
            "lift_vs_control": None,
        })

    # Compute lift vs control now that we have control_cvr
    for row in rows:
        if row["variant"] != "control" and control_cvr is not None and control_cvr > 0:
            row["lift_vs_control"] = round((row["cvr"] - control_cvr) / control_cvr, 4)

    return {
        "experiment_id": experiment_id,
        "name": exp.name,
        "status": exp.status,
        "goal_metric": exp.goal_metric,
        "winner_variant": exp.winner_variant,
        "variants": rows,
    }


def conclude_experiment(
    *,
    db: Session,
    experiment_id: int,
    owner_id: int,
    winner_variant: Optional[str] = None,
) -> models.ExperimentDefinition:
    exp = get_experiment(db, experiment_id, owner_id)
    if exp.status == models.ExperimentStatus.CONCLUDED:
        raise HTTPException(status_code=400, detail="Experiment is already concluded.")
    exp.status = models.ExperimentStatus.CONCLUDED
    exp.concluded_at = datetime.now(timezone.utc)
    exp.winner_variant = winner_variant
    db.commit()
    db.refresh(exp)
    return exp
