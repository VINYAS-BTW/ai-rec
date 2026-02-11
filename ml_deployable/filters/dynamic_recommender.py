import mlflow.pyfunc
import pandas as pd
import numpy as np
import pickle
import json
import os

# Import your classes
from Content import ContentBasedRecommender
from Collaborative import CollaborativeFilteringRecommender
from Hybrid import HybridRecommender

class MLflowRecommenderWrapper(mlflow.pyfunc.PythonModel):
    
    def load_context(self, context):
        """
        Loads all artifacts from the MLflow bundle.
        """
        # 1. Load Configuration
        with open(context.artifacts["model_type_config"], 'r') as f:
            config = json.load(f)
        
        self.model_type = config["model_type"]
        self.schemas = config["schemas"]
        
        self.content_model = None
        self.collab_model = None

        # 2. Load Content Model (if applicable)
        if self.model_type in ["content", "hybrid"]:
            self.content_model = ContentBasedRecommender()
            with open(context.artifacts["cb_cosine_sim"], 'rb') as f:
                self.content_model.cosine_sim = pickle.load(f)
            with open(context.artifacts["cb_indices"], 'rb') as f:
                self.content_model.indices = pickle.load(f)
            # Load the dataframe needed for lookups
            self.content_model.df = pd.read_csv(context.artifacts["cb_data"])
            self.content_model.schema_map = self.schemas.get("content", {})

        # 3. Load Collaborative Model (if applicable)
        if self.model_type in ["collaborative", "hybrid"]:
            self.collab_model = CollaborativeFilteringRecommender()
            self.collab_model.user_features = np.load(context.artifacts["cf_user_features"])
            self.collab_model.item_features = np.load(context.artifacts["cf_item_features"])
            with open(context.artifacts["cf_user_means"], 'rb') as f:
                self.collab_model.user_means = pickle.load(f)
            with open(context.artifacts["cf_item_ids"], 'rb') as f:
                self.collab_model.item_ids = pickle.load(f)
            with open(context.artifacts["cf_user_ids"], 'rb') as f:
                self.collab_model.user_ids = pickle.load(f)
            # Need pivot for filtering watched items? (Optional, skipping for speed)
            # self.collab_model.original_ratings_pivot = ... 

        # 4. Initialize Hybrid
        if self.model_type == "hybrid":
            self.model = HybridRecommender(self.content_model, self.collab_model)
        elif self.model_type == "content":
            self.model = self.content_model
        elif self.model_type == "collaborative":
            self.model = self.collab_model

    def predict(self, context, model_input):
        """
        Accepts a DataFrame with columns: ['user_id', 'item_title', 'n']
        Returns a JSON string of recommendations.
        """
        results = []
        
        for _, row in model_input.iterrows():
            user_id = str(row.get('user_id', ''))
            item_title = str(row.get('item_title', ''))
            n = int(row.get('n', 10))
            
            recs = []
            try:
                if self.model_type == "content":
                    recs = self.model.recommend(item_title, n=n)
                elif self.model_type == "collaborative":
                    recs = self.model.recommend(user_id, n=n)
                elif self.model_type == "hybrid":
                    # Hybrid requires both usually, or at least one
                    recs = self.model.recommend(user_id, last_liked_item_title=item_title, n=n)
                
                # Format output: Map Item IDs back to Titles if possible
                formatted_recs = []
                if self.content_model is not None:
                    # If we have a content DB, we can look up titles
                    id_col = self.schemas["content"].get("item_id")
                    title_col = self.schemas["content"].get("item_title")
                    
                    for item_id in recs:
                        # Find row in content DF
                        match = self.content_model.df[self.content_model.df[id_col].astype(str) == str(item_id)]
                        if not match.empty:
                            title = match.iloc[0][title_col]
                            formatted_recs.append({"id": item_id, "title": title})
                        else:
                            formatted_recs.append({"id": item_id, "title": "Unknown"})
                else:
                    # Just return IDs
                    formatted_recs = [{"id": i} for i in recs]

                results.append(formatted_recs)

            except Exception as e:
                results.append({"error": str(e)})
        
        return json.dumps(results)