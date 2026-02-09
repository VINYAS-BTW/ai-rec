import pandas as pd
import numpy as np
import logging
import time
from sklearn.decomposition import TruncatedSVD

logger = logging.getLogger("CollaborativeModel")

class CollaborativeFilteringRecommender:
    def __init__(self, n_components=50):
        self.n_components = n_components
        self.svd = TruncatedSVD(n_components=self.n_components, random_state=42)
        self.user_means = None
        self.item_ids = None
        self.user_ids = None
        self.original_ratings_pivot = None

    def fit(self, df, schema_map):
        start_time = time.time()
        try:
            # 1. Pivot
            self.original_ratings_pivot = df.pivot_table(
                index=schema_map['user_id'],
                columns=schema_map['item_id'],
                values=schema_map['rating']
            )
            
            # Metric: Sparsity Calculation
            num_ratings = self.original_ratings_pivot.count().sum()
            total_elements = self.original_ratings_pivot.size
            sparsity = 1 - (num_ratings / total_elements)
            logger.info(f"Data Sparsity: {sparsity:.2%}")

            # 2. De-mean
            self.user_means = self.original_ratings_pivot.mean(axis=1)
            demeaned_ratings = self.original_ratings_pivot.subtract(self.user_means, axis=0)
            demeaned_ratings_filled = demeaned_ratings.fillna(0)

            # 3. Fit SVD
            # Dynamic component reduction if dataset is too small
            n_features = demeaned_ratings_filled.shape[1]
            if n_features < self.n_components:
                logger.warning(f"Reducing n_components from {self.n_components} to {n_features - 1} due to small dataset.")
                self.svd.n_components = max(1, n_features - 1)

            self.user_features = self.svd.fit_transform(demeaned_ratings_filled)
            self.item_features = self.svd.components_
            
            self.user_ids = demeaned_ratings_filled.index
            self.item_ids = demeaned_ratings_filled.columns
            
            duration = time.time() - start_time
            logger.info(f"✅ Collaborative Model fitted. Duration: {duration:.2f}s")

        except Exception as e:
            logger.error(f"❌ Error fitting Collaborative Model: {e}", exc_info=True)
            raise e

    def recommend(self, user_id, n=10):
        # Graceful handling of unknown users
        if user_id not in self.user_ids:
            logger.warning(f"Cold Start: User '{user_id}' not found.")
            return []
            
        try:
            user_index = self.user_ids.get_loc(user_id)
            user_vector = self.user_features[user_index]
            predicted_deviations = np.dot(user_vector, self.item_features)
            user_mean = self.user_means.loc[user_id]
            predicted_ratings = predicted_deviations + user_mean
            
            predicted_series = pd.Series(predicted_ratings, index=self.item_ids)
            rated_items = self.original_ratings_pivot.loc[user_id].dropna().index
            
            recommendations = predicted_series.drop(rated_items).sort_values(ascending=False)
            return recommendations.head(n).index.tolist()
        except Exception as e:
            logger.error(f"Error recommending for user {user_id}: {e}")
            return []