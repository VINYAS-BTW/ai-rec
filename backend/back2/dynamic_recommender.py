import mlflow
import mlflow.pyfunc
import pandas as pd
import numpy as np
import pickle
import json
import os
from scipy.sparse import issparse, load_npz

# --- Import your recommender classes ---
from Content import ContentBasedRecommender
from Collaborative import CollaborativeFilteringRecommender
from Hybrid import HybridRecommender
from ParameterDriven import ParameterDrivenRecommender

class MLflowRecommenderWrapper(mlflow.pyfunc.PythonModel):
    """
    This is the new MLflow wrapper.
    It loads the specific artifacts for your Content, Collaborative,
    or Hybrid models and routes prediction requests.
    """
    
    def load_context(self, context):
        """
        This method is called by MLflow when loading the model.
        It loads all the artifacts saved during training.
        """
        print("Loading context for MLflowRecommenderWrapper...")
        
        # 1. Load config to see what model to build
        with open(context.artifacts["model_type_config"], 'r') as f:
            config = json.load(f)
        self.model_type = config["model_type"]
        self.schemas = config["schemas"]
        print(f"Loading model of type: {self.model_type}")

        # 2. Always load content data if it exists (for title lookups)
        self.content_df = pd.DataFrame()
        # --- UPDATED LOGIC ---
        # Get content schema if it exists in the config
        self.content_schema = self.schemas.get("content", {}) 
        
        # Check if cb_data artifact exists AND we have a schema for it
        if "cb_data" in context.artifacts and self.content_schema:
            self.content_df = pd.read_csv(context.artifacts["cb_data"])
            # Ensure the ID column is a string for matching
            if 'item_id' in self.content_schema:
                 self.content_df[self.content_schema['item_id']] = self.content_df[self.content_schema['item_id']].astype(str)
            print("Loaded content data for title lookups.")
        # --- END OF UPDATED LOGIC ---

        # 2b. Load Parameter-Driven Model (single dataset, target + features)
        if self.model_type == "parameter_driven":
            print("Loading Parameter-driven model artifacts...")
            self.model = ParameterDrivenRecommender()
            self.model.df = pd.read_csv(context.artifacts["pd_data"])
            self.model.schema_map = self.content_schema
            self.model.target_col = self.content_schema.get("target_column")
            self.model.feature_cols = [c for c in self.content_schema.get("feature_cols", []) if c and c in self.model.df.columns]
            for col in self.model.feature_cols:
                if col not in self.model.df.columns:
                    continue
                if pd.api.types.is_numeric_dtype(self.model.df[col]):
                    self.model._numeric_cols.append(col)
                else:
                    self.model._categorical_cols.append(col)
            num_df = self.model.df[self.model._numeric_cols].copy() if self.model._numeric_cols else pd.DataFrame()
            for c in self.model._numeric_cols:
                num_df[c] = pd.to_numeric(num_df[c], errors="coerce").fillna(0)
            self.model._numeric_means = num_df.mean().to_dict() if not num_df.empty else {}
            with open(context.artifacts["pd_transformer"], "rb") as f:
                self.model.column_transformer = pickle.load(f)
            _path = context.artifacts["pd_feature_matrix"]
            self.model.feature_matrix_ = load_npz(_path) if _path.endswith(".npz") else np.load(_path)
            print("✅ Model loading complete.")
            return

        # 3. Load Content-Based Model components (content-only; hybrid uses ParameterDriven)
        if self.model_type == "content":
            print("Loading Content model artifacts...")
            self.content_model = ContentBasedRecommender()
            self.content_model.df = self.content_df
            with open(context.artifacts["cb_cosine_sim"], 'rb') as f:
                self.content_model.cosine_sim = pickle.load(f)
            with open(context.artifacts["cb_indices"], 'rb') as f:
                self.content_model.indices = pickle.load(f)
            self.content_model.schema_map = self.content_schema

        # 4. Load Hybrid: ParameterDriven on joined (content + ratings) data only
        if self.model_type == "hybrid":
            print("Loading Hybrid (joined content+ratings, ParameterDriven) artifacts...")
            self.model = ParameterDrivenRecommender()
            self.model.df = pd.read_csv(context.artifacts["pd_data"])
            # Schema: content schema + feature_cols including mean_rating
            base_feature_cols = self.content_schema.get("feature_cols") or [c for c in self.model.df.columns if c != self.content_schema.get("target_column") and c != self.content_schema.get("item_id")]
            hybrid_feature_cols = [c for c in base_feature_cols if c in self.model.df.columns]
            if "mean_rating" in self.model.df.columns and "mean_rating" not in hybrid_feature_cols:
                hybrid_feature_cols.append("mean_rating")
            self.model.schema_map = {**self.content_schema, "feature_cols": hybrid_feature_cols, "target_column": self.content_schema.get("target_column") or self.content_schema.get("item_title") or self.content_schema.get("item_id")}
            self.model.target_col = self.model.schema_map["target_column"]
            self.model.feature_cols = [c for c in hybrid_feature_cols if c in self.model.df.columns]
            for col in self.model.feature_cols:
                if col not in self.model.df.columns:
                    continue
                if pd.api.types.is_numeric_dtype(self.model.df[col]):
                    self.model._numeric_cols.append(col)
                else:
                    self.model._categorical_cols.append(col)
            num_df = self.model.df[self.model._numeric_cols].copy() if self.model._numeric_cols else pd.DataFrame()
            for c in self.model._numeric_cols:
                if c in num_df.columns:
                    num_df[c] = pd.to_numeric(num_df[c], errors="coerce").fillna(0)
            self.model._numeric_means = num_df.mean().to_dict() if not num_df.empty else {}
            with open(context.artifacts["pd_transformer"], "rb") as f:
                self.model.column_transformer = pickle.load(f)
            _path = context.artifacts["pd_feature_matrix"]
            self.model.feature_matrix_ = load_npz(_path) if _path.endswith(".npz") else np.load(_path)
            print("✅ Model loading complete.")
            return

        # 5. Load Collaborative Filtering Model components (for collaborative-only)
        if self.model_type == "collaborative":
            print("Loading Collaborative model artifacts...")
            self.collab_model = CollaborativeFilteringRecommender()
            self.collab_model.user_features = np.load(context.artifacts["cf_user_features"])
            self.collab_model.item_features = np.load(context.artifacts["cf_item_features"])
            with open(context.artifacts["cf_user_means"], 'rb') as f:
                self.collab_model.user_means = pickle.load(f)
            with open(context.artifacts["cf_item_ids"], 'rb') as f:
                self.collab_model.item_ids = pickle.load(f)
            with open(context.artifacts["cf_user_ids"], 'rb') as f:
                self.collab_model.user_ids = pickle.load(f)
            with open(context.artifacts["cf_pivot"], 'rb') as f:
                self.collab_model.original_ratings_pivot = pickle.load(f)
            self.model = self.collab_model

        print("✅ Model loading complete.")

    def _format_recs(self, raw_ids: list) -> list:
        """Turn a list of item IDs into a list of dicts with normalized keys: item_id, title (for consistent API output)."""
        if not raw_ids:
            return []
        if self.content_df.empty or not self.content_schema:
            print("Warning: Content data or schema not found. Falling back to IDs.")
            return [{"item_id": str(i), "title": str(i)} for i in raw_ids]
        try:
            id_col = self.content_schema.get("item_id")
            title_col = self.content_schema.get("item_title") or id_col
            if not id_col or id_col not in self.content_df.columns:
                return [{"item_id": str(i), "title": str(i)} for i in raw_ids]
            raw_ids_str = [str(rid) for rid in raw_ids]
            results_df = self.content_df[self.content_df[id_col].astype(str).isin(raw_ids_str)]
            out = []
            seen = set()
            for iid in raw_ids_str:
                if iid in seen:
                    continue
                match = results_df[results_df[id_col].astype(str) == iid]
                if not match.empty:
                    row = match.iloc[0]
                    title_val = str(row[title_col]) if title_col in results_df.columns else iid
                    out.append({"item_id": iid, "title": title_val})
                    seen.add(iid)
                else:
                    out.append({"item_id": iid, "title": iid})
                    seen.add(iid)
            return out
        except Exception as e:
            print(f"Error formatting recommendations: {e}. Falling back to IDs.")
            return [{"item_id": str(i), "title": str(i)} for i in raw_ids]


    def predict(self, context, model_input: pd.DataFrame):
        """
        This is the main prediction entry point for MLflow.
        """
        results = []
        for _, row in model_input.iterrows():
            try:
                user_id = row.get('user_id')
                item_title = row.get('item_title')
                n = int(row.get('n', 10))
                rec_context = None

                if self.model_type == "parameter_driven":
                    rec_context = {k: v for k, v in row.items() if k not in ("n", "user_id", "item_title") and pd.notna(v) and str(v).strip()}
                    # If item_title provided: "recommend similar to this item" — use that row's features as context
                    if item_title and self.model.df is not None and not self.model.df.empty:
                        target_col = getattr(self.model, "target_col", None) or (self.model.schema_map or {}).get("target_column")
                        feature_cols = getattr(self.model, "feature_cols", []) or []
                        if target_col and target_col in self.model.df.columns and feature_cols:
                            match = self.model.df[self.model.df[target_col].astype(str).str.strip() == str(item_title).strip()]
                            if not match.empty:
                                rec_context = {}
                                for fc in feature_cols:
                                    if fc in match.columns:
                                        val = match.iloc[0][fc]
                                        if pd.notna(val) and str(val).strip():
                                            rec_context[fc] = str(val).strip()
                    raw_recs = self.model.recommend(rec_context, n=n + 10)
                    recommendations = [
                        {"value": str(r["value"]).strip(), "score": float(r["score"])}
                        for r in (raw_recs or [])
                        if r.get("value") is not None and str(r["value"]).strip() and str(r["value"]).strip().lower() not in ("nan", "none", "null")
                    ]
                    # Exclude the seed item when user asked "similar to this item"
                    if item_title:
                        seed = str(item_title).strip().lower()
                        recommendations = [r for r in recommendations if str(r.get("value", "")).strip().lower() != seed][:n]
                    if not recommendations:
                        raw_recs = self.model.recommend({}, n=n)
                        recommendations = [
                            {"value": str(r["value"]).strip(), "score": float(r["score"])}
                            for r in (raw_recs or [])
                            if r.get("value") and str(r["value"]).strip().lower() not in ("nan", "none", "null")
                        ][:n]
                    results.append({
                        "input_context": rec_context,
                        "input_user_id": None,
                        "input_item_title": str(item_title).strip() if item_title else None,
                        "model_type": self.model_type,
                        "recommendations": recommendations[:n],
                        "error": None
                    })
                    continue

                raw_ids = []
                if self.model_type == "content":
                    if not item_title: raise ValueError("item_title is required for content model.")
                    raw_ids = self.model.recommend(item_title, n)
                elif self.model_type == "collaborative":
                    if not user_id: raise ValueError("user_id is required for collaborative model.")
                    raw_ids = self.model.recommend(str(user_id), n)
                elif self.model_type == "hybrid":
                    rec_context = {k: v for k, v in row.items() if k not in ("n", "user_id", "item_title") and pd.notna(v) and str(v).strip()}
                    # If item_title provided: "recommend similar to this item" — use that row's features as context
                    if item_title and self.model.df is not None and not self.model.df.empty:
                        target_col = getattr(self.model, "target_col", None)
                        feature_cols = getattr(self.model, "feature_cols", []) or []
                        if target_col and target_col in self.model.df.columns and feature_cols:
                            match = self.model.df[self.model.df[target_col].astype(str).str.strip() == str(item_title).strip()]
                            if not match.empty:
                                rec_context = {}
                                for fc in feature_cols:
                                    if fc in match.columns:
                                        val = match.iloc[0][fc]
                                        if pd.notna(val) and str(val).strip():
                                            rec_context[fc] = str(val).strip()
                    req_n = (n + 10) if item_title else n
                    raw_recs = self.model.recommend(rec_context, n=req_n)
                    # Map target values to item_id for formatting (hybrid returns same shape as content/collab)
                    id_col = self.content_schema.get("item_id")
                    target_col = self.model.target_col
                    raw_ids = []
                    if id_col and target_col and not self.content_df.empty and id_col in self.content_df.columns and target_col in self.content_df.columns:
                        for r in (raw_recs or []):
                            val = r.get("value") if isinstance(r, dict) else r
                            if val is None: continue
                            match = self.content_df[self.content_df[target_col].astype(str).str.strip() == str(val).strip()]
                            if not match.empty:
                                raw_ids.append(str(match[id_col].iloc[0]))
                            else:
                                raw_ids.append(str(val))
                    else:
                        raw_ids = [str(r.get("value", r)) for r in (raw_recs or []) if r]
                    # Exclude seed item when user asked "similar to this item"
                    if item_title and id_col and target_col and not self.content_df.empty:
                        seed_match = self.content_df[self.content_df[target_col].astype(str).str.strip() == str(item_title).strip()]
                        if not seed_match.empty:
                            seed_id = str(seed_match[id_col].iloc[0])
                            raw_ids = [i for i in raw_ids if i != seed_id][:n]
                    else:
                        raw_ids = raw_ids[:n]

                # Format IDs into final JSON
                recommendations = self._format_recs(raw_ids)

                results.append({
                    "input_item_title": str(item_title).strip() if item_title and self.model_type in ("content", "hybrid") else (item_title if self.model_type == "content" else None),
                    "input_user_id": user_id if self.model_type == "collaborative" else None,
                    "input_context": rec_context if self.model_type == "hybrid" else None,
                    "model_type": self.model_type,
                    "recommendations": recommendations,
                    "error": None
                })
            except Exception as e:
                results.append({
                    "input_item_title": row.get('item_title'),
                    "input_user_id": row.get('user_id'),
                    "input_context": None,
                    "model_type": self.model_type,
                    "recommendations": None,
                    "error": str(e)
                })

        return pd.Series([json.dumps(r) for r in results])