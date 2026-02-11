import logging

logger = logging.getLogger("HybridModel")

class HybridRecommender:
    """
    Combines Collaborative Filtering (User behavior) with Content-Based Filtering (Item similarity).
    Strategy: Weighted Fallback.
    """
    def __init__(self, content_model, collab_model):
        self.content_model = content_model
        self.collab_model = collab_model
        
    def recommend(self, user_id, last_liked_item_title=None, n=10):
        """
        Args:
            user_id: The ID of the user.
            last_liked_item_title: (Optional) The title of an item the user likes (for cold start).
        """
        final_recs = []
        
        # Strategy 1: Try Collaborative Filtering First (Weight: 0.7)
        # We ask for more than N (e.g., N*2) to allow for filtering/mixing
        collab_recs = self.collab_model.recommend(user_id, n=n*2)
        
        if collab_recs:
            logger.info(f"Hybrid: Found {len(collab_recs)} from Collaborative model.")
            final_recs.extend(collab_recs)
        else:
            logger.warning("Hybrid: Collaborative model returned nothing (New User?).")

        # Strategy 2: Fill gaps with Content-Based (Weight: 0.3 or Fallback)
        # If we don't have enough recs OR if we explicitly want content diversity
        if len(final_recs) < n and last_liked_item_title:
            logger.info(f"Hybrid: Boosting with Content model based on '{last_liked_item_title}'")
            content_recs = self.content_model.recommend(last_liked_item_title, n=n)
            
            # Add content recs to the list if they aren't already there
            for item in content_recs:
                if item not in final_recs:
                    final_recs.append(item)
                    
        # Return top N
        return final_recs[:n]