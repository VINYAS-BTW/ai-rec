"""
Lightweight Postgres-backed feature store.

Two tables live in the `recommender` schema:
  - user_features : one row per (project_id, user_id)
  - item_features : one row per (project_id, item_id)

Each row stores a JSON feature bag — any key/value pairs you want to
associate with that entity for the given project.

Write paths
-----------
  1. Batch materialisation at training time (bulk_upsert_* helpers)
  2. Online update after feedback events (upsert_user_features)

Read paths
----------
  1. get_user/item_features  — single entity, low-latency
  2. list_user/item_features — paginated listing for admin/debug endpoints
"""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from models import UserFeatureRow, ItemFeatureRow


class FeatureStore:
    """Thin service wrapper around feature-store DB operations."""

    # ------------------------------------------------------------------
    # User features
    # ------------------------------------------------------------------

    @staticmethod
    def upsert_user_features(
        db: Session,
        project_id: int,
        user_id: str,
        features: Dict[str, Any],
    ) -> None:
        """Insert or update feature bag for (project_id, user_id)."""
        row = (
            db.query(UserFeatureRow)
            .filter(
                UserFeatureRow.project_id == project_id,
                UserFeatureRow.user_id == str(user_id),
            )
            .first()
        )
        fj = json.dumps(features, default=str)
        if row:
            row.features_json = fj
        else:
            db.add(
                UserFeatureRow(
                    project_id=project_id,
                    user_id=str(user_id),
                    features_json=fj,
                )
            )
        db.commit()

    @staticmethod
    def get_user_features(
        db: Session, project_id: int, user_id: str
    ) -> Optional[Dict[str, Any]]:
        row = (
            db.query(UserFeatureRow)
            .filter(
                UserFeatureRow.project_id == project_id,
                UserFeatureRow.user_id == str(user_id),
            )
            .first()
        )
        if not row or not row.features_json:
            return None
        try:
            return json.loads(row.features_json)
        except Exception:
            return None

    @staticmethod
    def bulk_upsert_user_features(
        db: Session,
        project_id: int,
        rows: List[Dict[str, Any]],
        batch_size: int = 500,
    ) -> int:
        """
        Replace user feature rows for *project_id* in batches (fast path for training).
        Each dict must contain a ``user_id`` key; all other keys become features.
        """
        if not rows:
            return 0
        written = 0
        for i in range(0, len(rows), batch_size):
            batch = rows[i : i + batch_size]
            mappings = []
            for entry in batch:
                entry = dict(entry)
                user_id = str(entry.pop("user_id", "") or "").strip()
                if not user_id:
                    continue
                mappings.append(
                    {
                        "project_id": project_id,
                        "user_id": user_id,
                        "features_json": json.dumps(entry, default=str),
                    }
                )
            if mappings:
                db.bulk_insert_mappings(UserFeatureRow, mappings)
                db.commit()
                written += len(mappings)
        return written

    @staticmethod
    def list_user_features(
        db: Session, project_id: int, limit: int = 500
    ) -> List[Dict[str, Any]]:
        rows = (
            db.query(UserFeatureRow)
            .filter(UserFeatureRow.project_id == project_id)
            .limit(limit)
            .all()
        )
        out = []
        for r in rows:
            feats = json.loads(r.features_json) if r.features_json else {}
            out.append({"user_id": r.user_id, **feats})
        return out

    # ------------------------------------------------------------------
    # Item features
    # ------------------------------------------------------------------

    @staticmethod
    def upsert_item_features(
        db: Session,
        project_id: int,
        item_id: str,
        features: Dict[str, Any],
    ) -> None:
        """Insert or update feature bag for (project_id, item_id)."""
        row = (
            db.query(ItemFeatureRow)
            .filter(
                ItemFeatureRow.project_id == project_id,
                ItemFeatureRow.item_id == str(item_id),
            )
            .first()
        )
        fj = json.dumps(features, default=str)
        if row:
            row.features_json = fj
        else:
            db.add(
                ItemFeatureRow(
                    project_id=project_id,
                    item_id=str(item_id),
                    features_json=fj,
                )
            )
        db.commit()

    @staticmethod
    def get_item_features(
        db: Session, project_id: int, item_id: str
    ) -> Optional[Dict[str, Any]]:
        row = (
            db.query(ItemFeatureRow)
            .filter(
                ItemFeatureRow.project_id == project_id,
                ItemFeatureRow.item_id == str(item_id),
            )
            .first()
        )
        if not row or not row.features_json:
            return None
        try:
            return json.loads(row.features_json)
        except Exception:
            return None

    @staticmethod
    def bulk_upsert_item_features(
        db: Session,
        project_id: int,
        rows: List[Dict[str, Any]],
        batch_size: int = 500,
    ) -> int:
        """
        Replace item feature rows for *project_id* in batches (fast path for training).
        Each dict must contain an ``item_id`` key; all other keys become features.
        """
        if not rows:
            return 0
        written = 0
        for i in range(0, len(rows), batch_size):
            batch = rows[i : i + batch_size]
            mappings = []
            for entry in batch:
                entry = dict(entry)
                item_id = str(entry.pop("item_id", "") or "").strip()
                if not item_id:
                    continue
                mappings.append(
                    {
                        "project_id": project_id,
                        "item_id": item_id,
                        "features_json": json.dumps(entry, default=str),
                    }
                )
            if mappings:
                db.bulk_insert_mappings(ItemFeatureRow, mappings)
                db.commit()
                written += len(mappings)
        return written

    @staticmethod
    def list_item_features(
        db: Session, project_id: int, limit: int = 500
    ) -> List[Dict[str, Any]]:
        rows = (
            db.query(ItemFeatureRow)
            .filter(ItemFeatureRow.project_id == project_id)
            .limit(limit)
            .all()
        )
        out = []
        for r in rows:
            feats = json.loads(r.features_json) if r.features_json else {}
            out.append({"item_id": r.item_id, **feats})
        return out

    # ------------------------------------------------------------------
    # Delete (useful on project delete / retrain)
    # ------------------------------------------------------------------

    @staticmethod
    def delete_project_features(db: Session, project_id: int) -> None:
        """Remove all feature rows for a project."""
        db.query(UserFeatureRow).filter(UserFeatureRow.project_id == project_id).delete()
        db.query(ItemFeatureRow).filter(ItemFeatureRow.project_id == project_id).delete()
        db.commit()
