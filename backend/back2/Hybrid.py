"""
Hybrid recommender: same context-based system as the parameter_driven model (target + features)
fused with collaborative filtering. User provides context (criteria + values) + user_id;
recommendations are item_ids from weighted score fusion.
"""
import pandas as pd


class HybridRecommender:
    """
    Combines parameter-driven (context-based) and collaborative recommendations via
    weighted score fusion. Uses the same context → target logic as ParameterDriven,
    then fuses with collaborative scores and returns item_ids.
    """
    DEFAULT_PD_WEIGHT = 0.5
    CANDIDATE_MULTIPLIER = 3

    def __init__(self, pd_model, collab_model, content_df=None, content_schema=None, pd_weight=None):
        self.pd_model = pd_model
        self.collab_model = collab_model
        self.content_df = content_df if content_df is not None else pd.DataFrame()
        self.content_schema = content_schema or {}
        self.pd_weight = pd_weight if pd_weight is not None else self.DEFAULT_PD_WEIGHT
        print("HybridRecommender initialized (parameter_driven + collaborative, pd_weight=%.2f)." % self.pd_weight)

    def _target_value_to_item_id(self, value):
        """Map a recommended target value (e.g. item title) to item_id using content df."""
        if self.content_df.empty or not self.content_schema:
            return str(value)
        target_col = self.content_schema.get("target_column")
        id_col = self.content_schema.get("item_id")
        if not target_col or not id_col or target_col not in self.content_df.columns or id_col not in self.content_df.columns:
            return str(value)
        if target_col == id_col:
            return str(value)
        match = self.content_df[self.content_df[target_col].astype(str).str.strip() == str(value).strip()]
        if match.empty:
            return str(value)
        return str(match[id_col].iloc[0])

    def recommend(self, user_id, context, n=10):
        """
        Hybrid recommendations: context (like parameter_driven) + user_id (collaborative).
        context: dict of feature column -> value.
        Returns: list of item_id strings, ordered by combined score.
        """
        k = max(n * self.CANDIDATE_MULTIPLIER, n + 10)
        pd_recs = self.pd_model.recommend(context, n=k)
        collab_with_scores = self.collab_model.recommend_with_scores(str(user_id), k)

        pd_scores = {}
        for r in pd_recs:
            if not r or not isinstance(r, dict):
                continue
            val = r.get("value")
            sc = r.get("score", 0)
            if val is None or str(val).strip() == "":
                continue
            iid = self._target_value_to_item_id(val)
            pd_scores[iid] = max(pd_scores.get(iid, 0), float(sc))
        collab_scores = {r["item_id"]: r["score"] for r in collab_with_scores}
        candidates = set(pd_scores.keys()) | set(collab_scores.keys())
        if not candidates:
            fallback_ids = [self._target_value_to_item_id(r.get("value")) for r in pd_recs if r and isinstance(r, dict) and r.get("value")]
            fallback_ids += self.collab_model.recommend(str(user_id), k)
            seen = set()
            out = []
            for iid in fallback_ids:
                if iid and iid not in seen:
                    seen.add(iid)
                    out.append(iid)
            return out[:n]

        pd_vals = [pd_scores.get(i, 0) for i in candidates]
        collab_vals = [collab_scores.get(i, 0) for i in candidates]
        pd_min, pd_max = (min(pd_vals), max(pd_vals)) if pd_vals else (0, 1)
        pd_range = pd_max - pd_min if pd_max > pd_min else 1
        c_min, c_max = (min(collab_vals), max(collab_vals)) if collab_vals else (0, 1)
        c_range = c_max - c_min if c_max > c_min else 1

        def norm_pd(i):
            return (pd_scores.get(i, 0) - pd_min) / pd_range if pd_range else 0

        def norm_collab(i):
            return (collab_scores.get(i, 0) - c_min) / c_range if c_range else 0

        combined = [
            (i, self.pd_weight * norm_pd(i) + (1 - self.pd_weight) * norm_collab(i))
            for i in candidates
        ]
        combined.sort(key=lambda x: x[1], reverse=True)
        return [i for i, _ in combined[:n]]
