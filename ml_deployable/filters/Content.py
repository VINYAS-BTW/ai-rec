import pandas as pd
import logging
import time
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import linear_kernel

# Setup structured logging
logger = logging.getLogger("ContentModel")
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

class ContentBasedRecommender:
    """Recommends items similar to a given item based on its content."""
    def __init__(self):
        self.cosine_sim = None
        self.indices = None
        self.df = None
        self.schema_map = {}

    def fit(self, df, schema_map):
        start_time = time.time()
        try:
            self.df = df
            self.schema_map = schema_map
            
            # 1. Validation
            content_feature_columns = [c for c in schema_map.get('feature_cols', []) if c and str(c).strip()]
            if not content_feature_columns:
                raise ValueError("Content model requires at least one feature column.")
            
            # Check for missing columns
            missing = [c for c in content_feature_columns if c not in df.columns]
            if missing:
                raise ValueError(f"Missing columns in CSV: {missing}")

            logger.info(f"Fitting Content Model on {len(df)} items using features: {content_feature_columns}")

            # 2. Preprocessing (Handle NaNs gracefully)
            df['soup'] = df[content_feature_columns].fillna('').astype(str).agg(' '.join, axis=1)

            # 3. TF-IDF
            tfidf = TfidfVectorizer(stop_words='english', min_df=1) # min_df=1 ensures we don't crash on rare words
            tfidf_matrix = tfidf.fit_transform(df['soup'])

            # 4. Cosine Similarity
            self.cosine_sim = linear_kernel(tfidf_matrix, tfidf_matrix)

            # 5. Indexing
            item_title_col = schema_map.get('item_title')
            self.indices = pd.Series(df.index, index=df[item_title_col]).drop_duplicates()

            duration = time.time() - start_time
            logger.info(f"✅ Content-Based model fitted. Duration: {duration:.2f}s. Matrix Shape: {tfidf_matrix.shape}")

        except Exception as e:
            logger.error(f"❌ Error fitting Content Model: {str(e)}", exc_info=True)
            raise e

    def recommend(self, item_title, n=10):
        try:
            if item_title not in self.indices:
                logger.warning(f"Item '{item_title}' not found in indices.")
                return []

            idx = self.indices[item_title]
            
            # Handle case where multiple items have same title (indices returns a Series instead of int)
            if isinstance(idx, pd.Series):
                idx = idx.iloc[0]

            sim_scores = list(enumerate(self.cosine_sim[idx]))
            sim_scores = sorted(sim_scores, key=lambda x: x[1], reverse=True)
            sim_scores = sim_scores[1:n+1]
            
            item_indices = [i[0] for i in sim_scores]
            return self.df[self.schema_map['item_id']].iloc[item_indices].tolist()

        except Exception as e:
            logger.error(f"Error during recommendation for '{item_title}': {e}")
            return []