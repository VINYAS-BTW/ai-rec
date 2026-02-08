import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import linear_kernel

class ContentBasedRecommender:
    """Recommends items similar to a given item based on its content."""
    def __init__(self):
        self.cosine_sim = None
        self.indices = None
        self.df = None
        self.schema_map = {}

    def fit(self, df, schema_map):
        """
        Builds the TF-IDF and Cosine Similarity matrix from item features.

        Args:
            df (pd.DataFrame): The standardized dataframe.
            schema_map (dict): A dict with 'item_id', 'item_title', and 'feature_cols' keys.
        """
        self.df = df
        self.schema_map = schema_map
        content_feature_columns = [c for c in schema_map.get('feature_cols', []) if c and str(c).strip()]
        if not content_feature_columns:
            raise ValueError("Content model requires at least one feature column; none configured or all empty.")
        for col in content_feature_columns:
            if col not in df.columns:
                raise ValueError(f"Feature column '{col}' is not in the dataset. Columns: {list(df.columns)}")
        item_id_col = schema_map.get('item_id') or ''
        item_title_col = schema_map.get('item_title') or ''
        if not item_id_col or item_id_col not in df.columns:
            raise ValueError(f"Schema must have a valid 'item_id' column in the dataset. Got: {item_id_col!r}")
        if not item_title_col or item_title_col not in df.columns:
            raise ValueError(f"Schema must have a valid 'item_title' column in the dataset. Got: {item_title_col!r}")

        # Create a "soup" of all content features in a single string
        df['soup'] = df[content_feature_columns].fillna('').astype(str).agg(' '.join, axis=1)

        # Use TF-IDF to convert the text soup into a matrix of feature vectors
        # max_features limits vocabulary size for large corpora and speeds up training
        tfidf = TfidfVectorizer(stop_words='english', max_features=10000, sublinear_tf=True)
        tfidf_matrix = tfidf.fit_transform(df['soup'])

        # Calculate the cosine similarity between all items
        self.cosine_sim = linear_kernel(tfidf_matrix, tfidf_matrix)

        # Create a mapping from item_id to dataframe index for quick lookups
        # Create a mapping from item_title to dataframe index for quick lookups
        self.indices = pd.Series(df.index, index=df[schema_map['item_title']]).drop_duplicates()
        print("✅ Content-Based model fitted.")

    def recommend(self, item_id, n=10):
        """
        Gets the top n similar items for a given item_id.
        """
        if item_id not in self.indices:
            print(f"Item '{item_id}' not found in Content model indices.")
            return []

        # Get the index of the item that matches the ID
        idx = self.indices[item_id]

        # Get the pairwise similarity scores of all items with that item
        sim_scores = list(enumerate(self.cosine_sim[idx]))

        # Sort the items based on the similarity scores
        sim_scores = sorted(sim_scores, key=lambda x: x[1], reverse=True)

        # Get the scores of the n most similar items (excluding the item itself)
        sim_scores = sim_scores[1:n+1]

        # Get the item indices
        item_indices = [i[0] for i in sim_scores]

        # Return the top n most similar item IDs
        return self.df[self.schema_map['item_id']].iloc[item_indices].tolist()

    def recommend_with_scores(self, item_title_or_id, n=10):
        """
        Returns top n similar items with similarity scores for hybrid fusion.
        item_title_or_id: lookup key (schema uses item_title in indices).
        Returns: list of dicts [{"item_id": str, "score": float}, ...]
        """
        if item_title_or_id not in self.indices:
            return []
        idx = self.indices[item_title_or_id]
        sim_scores = list(enumerate(self.cosine_sim[idx]))
        sim_scores = sorted(sim_scores, key=lambda x: x[1], reverse=True)[1 : n + 1]
        id_col = self.schema_map['item_id']
        return [
            {"item_id": str(self.df[id_col].iloc[i]), "score": float(s)}
            for i, s in sim_scores
        ]