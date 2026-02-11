import numpy as np
import pandas as pd
import logging

logger = logging.getLogger("Metrics")

def calculate_rmse(model, test_data):
    """
    Calculates Root Mean Squared Error for the Collaborative Model.
    Formula: sqrt(mean((predicted - actual)^2))
    """
    errors = []
    for _, row in test_data.iterrows():
        # Get actual rating
        actual = row['rating']
        
        # Predict rating
        try:
            pred = model.predict(uid=str(row['user_id']), iid=str(row['item_id']))
            errors.append((pred.est - actual) ** 2)
        except:
            continue
            
    if not errors:
        return 0.0
        
    rmse = np.sqrt(np.mean(errors))
    return rmse

def calculate_precision_recall_at_k(model, test_data, k=10, threshold=3.5):
    """
    Calculates Precision@K and Recall@K.
    
    Args:
        threshold: Ratings above this value are considered 'relevant'.
    """
    # Group test data by user
    user_est_true = {}
    
    # 1. Get predictions for all user/item pairs in the test set
    for _, row in test_data.iterrows():
        uid = str(row['user_id'])
        iid = str(row['item_id'])
        true_r = row['rating']
        
        if uid not in user_est_true:
            user_est_true[uid] = []
            
        try:
            pred = model.predict(uid=uid, iid=iid)
            user_est_true[uid].append((pred.est, true_r))
        except:
            continue
    
    precisions = dict()
    recalls = dict()
    
    # 2. Calculate metrics for each user
    for uid, user_ratings in user_est_true.items():
        # Sort user ratings by estimated value
        user_ratings.sort(key=lambda x: x[0], reverse=True)
        
        # Number of relevant items (True rating >= threshold)
        n_rel = sum((true_r >= threshold) for (_, true_r) in user_ratings)
        
        # Number of recommended items in top k (Estimated rating >= threshold)
        # Note: In a real scenario, we'd recommend the top K regardless of threshold, 
        # but here we check if our top K *contains* the relevant true items.
        n_rec_k = sum((est >= threshold) for (est, _) in user_ratings[:k])
        
        # Number of relevant and recommended items in top k
        n_rel_and_rec_k = sum(((true_r >= threshold) and (est >= threshold)) 
                              for (est, true_r) in user_ratings[:k])
        
        precisions[uid] = n_rel_and_rec_k / n_rec_k if n_rec_k != 0 else 0
        recalls[uid] = n_rel_and_rec_k / n_rel if n_rel != 0 else 0
        
    # 3. Average over all users
    avg_precision = sum(precisions.values()) / len(precisions) if precisions else 0
    avg_recall = sum(recalls.values()) / len(recalls) if recalls else 0
    
    return avg_precision, avg_recall