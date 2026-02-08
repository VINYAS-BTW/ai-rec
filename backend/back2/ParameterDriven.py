"""
Parameter-driven recommender: dataset-agnostic backend-as-a-service.

Works with any tabular dataset (CSV). The user specifies:
  - target_column: which column to recommend (e.g. category, brand, product_id)
  - feature_cols: which columns to use for similarity (any mix of numeric/categorical)

At inference, the client sends a context (key-value pairs for some or all features)
and receives top recommended values for the target column. No domain assumptions.
"""
import pandas as pd
import numpy as np
from sklearn.preprocessing import StandardScaler, OneHotEncoder
from sklearn.compose import ColumnTransformer
from sklearn.metrics.pairwise import cosine_similarity
from scipy.sparse import issparse


class ParameterDrivenRecommender:
    """
    Recommends values of a target column based on similarity over user-chosen
    feature columns. Domain-agnostic: works with any uploaded tabular dataset.
    """

    # Placeholder for categorical columns not in user context → encoder gives zeros (neutral)
    _UNSPECIFIED = "\u0000__UNSPECIFIED__"

    def __init__(self):
        self.df = None
        self.schema_map = None
        self.target_col = None
        self.feature_cols = None
        self.column_transformer = None
        self.feature_matrix_ = None
        self._numeric_cols = []
        self._categorical_cols = []
        self._numeric_means = {}  # neutral value for unspecified numeric columns

    def fit(self, df: pd.DataFrame, schema_map: dict):
        """
        Builds the feature encoding and similarity model.

        Args:
            df: Any tabular dataset (user-uploaded CSV).
            schema_map: Must have 'target_column' (what to recommend) and
                        'feature_cols' (list of columns for similarity).
        """
        self.df = df.copy()
        self.schema_map = schema_map
        self.target_col = schema_map.get("target_column")
        if not self.target_col or self.target_col not in df.columns:
            raise ValueError(
                f"Schema must have 'target_column' present in the dataset. "
                f"Got: {self.target_col!r}, columns: {list(df.columns)}"
            )
        self.feature_cols = [
            c
            for c in schema_map.get("feature_cols", [])
            if c and str(c).strip() and c in df.columns
        ]
        # If no features specified, use all columns except target (works for any dataset)
        if not self.feature_cols:
            self.feature_cols = [c for c in df.columns if c != self.target_col]
        if not self.feature_cols:
            raise ValueError(
                "At least one feature column is needed (target column is the only column in the dataset)."
            )

        # Normalize: coerce non-numeric columns to string (handles mixed types, dates, etc.)
        for col in self.feature_cols:
            if col not in self.df.columns:
                continue
            if not pd.api.types.is_numeric_dtype(self.df[col]):
                self.df[col] = self.df[col].astype(str).fillna("")

        # Identify numeric vs categorical (after normalization)
        for col in self.feature_cols:
            if col not in self.df.columns:
                continue
            if pd.api.types.is_numeric_dtype(self.df[col]):
                self._numeric_cols.append(col)
            else:
                self._categorical_cols.append(col)

        # Build transformer: scale numeric, one-hot encode categorical
        transformers = []
        if self._numeric_cols:
            transformers.append(
                ("num", StandardScaler(), self._numeric_cols)
            )
        if self._categorical_cols:
            transformers.append(
                (
                    "cat",
                    OneHotEncoder(handle_unknown="ignore", sparse_output=True),
                    self._categorical_cols,
                )
            )
        if not transformers:
            raise ValueError("No valid feature columns to encode.")

        self.column_transformer = ColumnTransformer(
            transformers,
            remainder="drop",
            verbose=0,
        )
        # Fill NaN for numeric cols so StandardScaler doesn't fail; categorical already filled
        fit_df = self.df[self.feature_cols].copy()
        for col in self._numeric_cols:
            if col in fit_df.columns:
                fit_df[col] = pd.to_numeric(fit_df[col], errors="coerce").fillna(0)
        for col in self._categorical_cols:
            if col in fit_df.columns:
                fit_df[col] = fit_df[col].astype(str).fillna("")
        self.feature_matrix_ = self.column_transformer.fit_transform(fit_df)
        if issparse(self.feature_matrix_):
            self.feature_matrix_ = np.asarray(self.feature_matrix_.astype(np.float64).toarray())
        else:
            self.feature_matrix_ = np.asarray(self.feature_matrix_, dtype=np.float64)
        # NaN from StandardScaler (constant columns) -> 0
        self.feature_matrix_ = np.nan_to_num(self.feature_matrix_, nan=0.0, posinf=0.0, neginf=0.0)
        # Store column means so we can use them as neutral values when user doesn't specify a column
        for col in self._numeric_cols:
            if col in fit_df.columns:
                self._numeric_means[col] = float(fit_df[col].mean())
        print("Parameter-driven recommender fitted.")

    def _most_frequent_targets(self, n: int):
        """Return top-n most frequent valid target values. Used as fallback when similarity path fails or returns empty."""
        def _valid(v):
            if v is None or (isinstance(v, float) and pd.isna(v)):
                return False
            s = str(v).strip().lower()
            return len(s) > 0 and s not in ("nan", "none", "null")
        if self.df is None or self.target_col not in self.df.columns:
            return []
        targets = (
            self.df[self.target_col]
            .dropna()
            .astype(str)
            .str.strip()
        )
        targets = targets[targets != ""]
        targets = targets[~targets.str.lower().isin(("nan", "none", "null"))]
        if targets.empty:
            return []
        counts = targets.value_counts().head(max(1, n))
        max_count = float(counts.max()) if len(counts) else 1.0
        out = []
        for k, v in counts.items():
            if _valid(k):
                out.append({"value": str(k), "score": round(float(v / max_count), 4)})
        return out

    def recommend(self, context: dict, n: int = 10, exclude_seen: bool = False):
        """
        Get top-n recommended values for the target column given a context.
        exclude_seen=False: rank by similarity (recommend targets that match the criteria).
        Always returns at least something: falls back to most-frequent targets if similarity path fails or is empty.
        """
        if self.feature_matrix_ is None or self.df is None:
            return self._most_frequent_targets(n)

        def _valid_value(v):
            if v is None or (isinstance(v, float) and pd.isna(v)):
                return False
            s = str(v).strip().lower()
            return len(s) > 0 and s not in ("nan", "none", "null")

        # Normalize context keys to match feature_cols (case-insensitive, strip)
        context_clean = {}
        for k, v in (context or {}).items():
            if v is None or (isinstance(v, str) and not v.strip()):
                continue
            k_clean = str(k).strip()
            for fc in self.feature_cols:
                if fc.strip().lower() == k_clean.lower():
                    context_clean[fc] = v
                    break

        use_cols = [c for c in self.feature_cols if c in context_clean]
        if not use_cols:
            return self._most_frequent_targets(n)

        # Neutral values for unspecified columns (so only selected criteria drive similarity)
        if not self._numeric_means and self.df is not None and self._numeric_cols:
            fit_df = self.df[self._numeric_cols].copy()
            for c in self._numeric_cols:
                fit_df[c] = pd.to_numeric(fit_df[c], errors="coerce").fillna(0)
            self._numeric_means = fit_df.mean().to_dict()

        # Build query row: only user-specified columns get their values; rest are NEUTRAL
        query_df = pd.DataFrame(index=[0], columns=self.feature_cols)
        for col in self.feature_cols:
            if col in context_clean:
                query_df.loc[0, col] = context_clean[col]
            elif col in self._numeric_cols:
                query_df.loc[0, col] = self._numeric_means.get(col, 0)
            else:
                query_df.loc[0, col] = self._UNSPECIFIED
        for col in self._numeric_cols:
            if col in query_df.columns:
                query_df[col] = pd.to_numeric(query_df[col], errors="coerce").fillna(self._numeric_means.get(col, 0))
        for col in self._categorical_cols:
            if col in query_df.columns:
                query_df[col] = query_df[col].astype(str).fillna(self._UNSPECIFIED)

        try:
            query_vec = self.column_transformer.transform(query_df)
        except Exception:
            return self._most_frequent_targets(n)
        if issparse(query_vec):
            query_vec = np.asarray(query_vec.astype(np.float64).toarray())
        else:
            query_vec = np.asarray(query_vec, dtype=np.float64)
        query_vec = np.nan_to_num(query_vec, nan=0.0, posinf=0.0, neginf=0.0)

        if query_vec.size == 0 or self.feature_matrix_.size == 0:
            return self._most_frequent_targets(n)

        sim = cosine_similarity(query_vec, self.feature_matrix_).ravel()

        work = self.df.copy()
        work["_sim"] = sim
        # Normalize target to string once
        work["_target"] = work[self.target_col].astype(str).str.strip()

        work = work[work["_target"].str.len() > 0]
        work = work[~work["_target"].str.lower().isin(("nan", "none", "null"))]

        if work.empty:
            return self._most_frequent_targets(n)

        agg = work.groupby("_target", as_index=False)["_sim"].mean()
        agg = agg.sort_values("_sim", ascending=False)

        if exclude_seen and use_cols:
            exact = work.copy()
            for col in use_cols:
                val = str(context_clean.get(col, "")).strip()
                exact = exact[exact[col].astype(str).str.strip() == val]
            if not exact.empty:
                exact_targets = set(exact["_target"].unique())
                agg = agg[~agg["_target"].isin(exact_targets)]

        result = []
        for _, row in agg.head(n).iterrows():
            val = row["_target"]
            if _valid_value(val):
                sc = float(row["_sim"])
                sc = max(0.0, min(1.0, sc))  # clamp to [0,1] for display
                result.append({"value": str(val), "score": round(sc, 4)})

        if not result:
            return self._most_frequent_targets(n)
        return result
