import pandas as pd
import numpy as np
from sklearn.decomposition import TruncatedSVD

class CollaborativeFilteringRecommender:
    """
    Recommends items using TruncatedSVD after mean-centering the data
    to provide personalized recommendations.
    """
    def __init__(self, n_components=50):
        self.n_components = n_components
        self.svd = TruncatedSVD(n_components=self.n_components, random_state=42)
        
        self.user_features = None
        self.item_features = None
        
        self.user_means = None
        self.item_ids = None
        self.user_ids = None
        
        self.original_ratings_pivot = None

    def fit(self, df, schema_map):
        """
        Pivots the data, de-means it, and fits the SVD model.
        
        Args:
            df (pd.DataFrame): Standardized dataframe.
            schema_map (dict): Dict with 'user_id', 'item_id', 'rating' keys.
        """
        # 1. Create the user-item matrix *with NaNs*
        self.original_ratings_pivot = df.pivot_table(
            index=schema_map['user_id'],
            columns=schema_map['item_id'],
            values=schema_map['rating']
        )
        n_users, n_items = self.original_ratings_pivot.shape
        # Use adaptive n_components to avoid overfitting on small matrices
        effective_components = min(
            self.n_components,
            n_users - 1,
            n_items - 1,
            max(2, n_users // 2, n_items // 2)
        )
        effective_components = max(2, effective_components)
        if effective_components != self.n_components:
            self.n_components = effective_components
            self.svd = TruncatedSVD(n_components=self.n_components, random_state=42)
        
        # 2. Calculate the mean rating for each user
        self.user_means = self.original_ratings_pivot.mean(axis=1)

        # 3. De-mean the data
        demeaned_ratings = self.original_ratings_pivot.subtract(self.user_means, axis=0)
        
        # 4. NOW, fill the NaNs with 0
        demeaned_ratings_filled = demeaned_ratings.fillna(0)

        # 5. Fit SVD on the de-meaned data
        self.user_features = self.svd.fit_transform(demeaned_ratings_filled)
        self.item_features = self.svd.components_  # (n_components, n_items)
        
        # Store the user and item IDs in order
        self.user_ids = demeaned_ratings_filled.index
        self.item_ids = demeaned_ratings_filled.columns
        
        print("✅ Collaborative Filtering (SVD) model fitted on de-meaned data.")

    def recommend(self, user_id, n=10):
        """
        Gets the top n item recommendations for a given user_id.
        """
        if user_id not in self.user_ids:
            print(f"User '{user_id}' not found in Collaborative model.")
            return []
            
        # 1. Get the user's row index
        user_index = self.user_ids.get_loc(user_id)
        
        # 2. Get the user's latent feature vector
        user_vector = self.user_features[user_index]

        # 3. Predict the *deviations*
        predicted_deviations = np.dot(user_vector, self.item_features)
        
        # 4. Add the user's mean back
        user_mean = self.user_means.loc[user_id]
        predicted_ratings = predicted_deviations + user_mean
        
        # 5. Convert to a Series
        predicted_series = pd.Series(predicted_ratings, index=self.item_ids)
        
        # 6. Get items the user has already rated
        rated_items = self.original_ratings_pivot.loc[user_id].dropna().index

        # 7. Filter out already-rated items and sort
        recommendations = predicted_series.drop(rated_items, errors="ignore").sort_values(ascending=False)

        return recommendations.head(n).index.tolist()

    def recommend_with_scores(self, user_id, n=10):
        """
        Returns top n recommended items with predicted rating scores for hybrid fusion.
        Returns: list of dicts [{"item_id": str, "score": float}, ...]
        """
        if user_id not in self.user_ids:
            return []
        user_index = self.user_ids.get_loc(user_id)
        user_vector = self.user_features[user_index]
        predicted_deviations = np.dot(user_vector, self.item_features)
        user_mean = self.user_means.loc[user_id]
        predicted_ratings = predicted_deviations + user_mean
        predicted_series = pd.Series(predicted_ratings, index=self.item_ids)
        rated_items = self.original_ratings_pivot.loc[user_id].dropna().index
        recommendations = predicted_series.drop(rated_items, errors="ignore").sort_values(ascending=False)
        top = recommendations.head(n)
        return [{"item_id": str(i), "score": float(s)} for i, s in top.items()]