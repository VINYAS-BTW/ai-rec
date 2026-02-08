import os
import io
import json
import pickle
import shutil
import logging
import numpy as np
import pandas as pd
import boto3
import mlflow
from celery import Celery
from dotenv import load_dotenv
from sklearn.model_selection import train_test_split

# --- Custom Modules ---
from etl import ETLProcessor
from metrics import calculate_rmse, calculate_precision_recall_at_k
from filters.Content import ContentBasedRecommender
from filters.Collaborative import CollaborativeFilteringRecommender
from filters.dynamic_recommender import MLflowRecommenderWrapper

# --- Configuration ---
load_dotenv()

# Redis Configuration (for Task Queue)
CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")
CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0")

# AWS Configuration (for Data & Artifacts)
AWS_BUCKET_NAME = os.getenv("AWS_BUCKET_NAME", "my-recommender-bucket")
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")

# MLflow Configuration (for Experiment Tracking)
MLFLOW_TRACKING_URI = os.getenv("MLFLOW_TRACKING_URI", "http://localhost:5000")

# --- Setup ---
# 1. Initialize Celery
celery_app = Celery("recommender_worker", broker=CELERY_BROKER_URL, backend=CELERY_RESULT_BACKEND)

# 2. Initialize Logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - [WORKER] - %(levelname)s - %(message)s')
logger = logging.getLogger("Worker")

# 3. Initialize AWS S3 Client
s3_client = boto3.client('s3', region_name=AWS_REGION)

# --- The Main Task ---
@celery_app.task(bind=True, name="train_model_task", max_retries=3)
def train_model_task(self, project_id: int, project_config: dict):
    """
    Orchestrates the End-to-End ML Pipeline:
    1. Download Data (S3)
    2. ETL & Cleaning
    3. Model Training & Validation (Metrics)
    4. Serialization
    5. Logging to MLflow
    """
    logger.info(f"🚀 [Project {project_id}] Starting Pipeline for type: {project_config['model_type']}")
    
    # Create a temporary workspace for this job
    work_dir = f"/tmp/project_{project_id}"
    os.makedirs(work_dir, exist_ok=True)
    
    try:
        # ==============================================================================
        # PHASE 1: DATA INGESTION (Download from S3)
        # ==============================================================================
        raw_content_path = None
        raw_inter_path = None

        if "content" in project_config["files"]:
            logger.info("Downloading Content CSV...")
            raw_content_path = os.path.join(work_dir, "raw_content.csv")
            s3_client.download_file(AWS_BUCKET_NAME, project_config["files"]["content"], raw_content_path)

        if "interaction" in project_config["files"]:
            logger.info("Downloading Interaction CSV...")
            raw_inter_path = os.path.join(work_dir, "raw_interaction.csv")
            s3_client.download_file(AWS_BUCKET_NAME, project_config["files"]["interaction"], raw_inter_path)

        # ==============================================================================
        # PHASE 2: ETL & TRANSFORMATION
        # ==============================================================================
        df_content_clean = None
        df_inter_clean = None
        
        # --- Process Content Data ---
        if raw_content_path:
            raw_df = pd.read_csv(raw_content_path)
            schema = project_config["schemas"]["content"]
            # ETLProcessor handles validation, renaming, and soup creation
            df_content_clean = ETLProcessor.transform_content_data(raw_df, schema)
            
            # Save clean version for debugging/artifacts
            df_content_clean.to_csv(os.path.join(work_dir, "clean_content.csv"), index=False)

        # --- Process Interaction Data ---
        if raw_inter_path:
            raw_df = pd.read_csv(raw_inter_path)
            schema = project_config["schemas"]["interaction"]
            # ETLProcessor handles validation, renaming, and type casting
            df_inter_clean = ETLProcessor.transform_interaction_data(raw_df, schema)
            
            # Save clean version
            df_inter_clean.to_csv(os.path.join(work_dir, "clean_interaction.csv"), index=False)

        # ==============================================================================
        # PHASE 3: MODEL TRAINING & EVALUATION
        # ==============================================================================
        artifacts = {}
        metrics = {}
        model_type = project_config["model_type"]
        
        # Save the config so the wrapper knows how to load the model later
        config_path = os.path.join(work_dir, "model_type.json")
        with open(config_path, 'w') as f:
            json.dump({"model_type": model_type, "schemas": project_config["schemas"]}, f)
        artifacts["model_type_config"] = config_path

        # --- Train Content Model ---
        if model_type in ["content", "hybrid"] and df_content_clean is not None:
            logger.info("Training Content-Based Model...")
            cb = ContentBasedRecommender()
            # The ETL standardized columns to: item_id, item_title, soup
            internal_schema = {'item_id': 'item_id', 'item_title': 'item_title', 'feature_cols': ['soup']}
            cb.fit(df_content_clean, internal_schema)
            
            # Serialize artifacts
            with open(os.path.join(work_dir, "cb_cosine_sim.pkl"), 'wb') as f: pickle.dump(cb.cosine_sim, f)
            with open(os.path.join(work_dir, "cb_indices.pkl"), 'wb') as f: pickle.dump(cb.indices, f)
            df_content_clean.to_csv(os.path.join(work_dir, "cb_data.csv"), index=False)
            
            artifacts["cb_cosine_sim"] = os.path.join(work_dir, "cb_cosine_sim.pkl")
            artifacts["cb_indices"] = os.path.join(work_dir, "cb_indices.pkl")
            artifacts["cb_data"] = os.path.join(work_dir, "cb_data.csv")
            
            metrics["content_items"] = len(df_content_clean)

        # --- Train Collaborative Model ---
        if model_type in ["collaborative", "hybrid"] and df_inter_clean is not None:
            logger.info("Training Collaborative Model...")
            internal_schema = {'user_id': 'user_id', 'item_id': 'item_id', 'rating': 'rating'}
            
            # A. VALIDATION SPLIT (80/20)
            train_df, test_df = train_test_split(df_inter_clean, test_size=0.2, random_state=42)
            
            # B. Train on Train Set & Evaluate
            cf_eval = CollaborativeFilteringRecommender(n_components=50)
            cf_eval.fit(train_df, internal_schema)
            
            rmse = calculate_rmse(cf_eval, test_df)
            precision, recall = calculate_precision_recall_at_k(cf_eval, test_df, k=10)
            
            metrics["rmse"] = rmse
            metrics["precision_at_10"] = precision
            metrics["recall_at_10"] = recall
            metrics["interaction_count"] = len(df_inter_clean)
            logger.info(f"📊 Metrics: RMSE={rmse:.4f}, Precision={precision:.4f}, Recall={recall:.4f}")

            # C. Production Training (Retrain on Full Dataset)
            logger.info("Retraining on full dataset for production...")
            cf_prod = CollaborativeFilteringRecommender(n_components=50)
            cf_prod.fit(df_inter_clean, internal_schema)
            
            # Serialize artifacts
            np.save(os.path.join(work_dir, "cf_user_features.npy"), cf_prod.user_features)
            np.save(os.path.join(work_dir, "cf_item_features.npy"), cf_prod.item_features)
            with open(os.path.join(work_dir, "cf_user_means.pkl"), 'wb') as f: pickle.dump(cf_prod.user_means, f)
            with open(os.path.join(work_dir, "cf_item_ids.pkl"), 'wb') as f: pickle.dump(cf_prod.item_ids, f)
            with open(os.path.join(work_dir, "cf_user_ids.pkl"), 'wb') as f: pickle.dump(cf_prod.user_ids, f)
            
            artifacts["cf_user_features"] = os.path.join(work_dir, "cf_user_features.npy")
            artifacts["cf_item_features"] = os.path.join(work_dir, "cf_item_features.npy")
            artifacts["cf_user_means"] = os.path.join(work_dir, "cf_user_means.pkl")
            artifacts["cf_item_ids"] = os.path.join(work_dir, "cf_item_ids.pkl")
            artifacts["cf_user_ids"] = os.path.join(work_dir, "cf_user_ids.pkl")
            # We don't save the full pivot table to save space/time, unless needed for specific logic

        # ==============================================================================
        # PHASE 4: MLFLOW LOGGING & REGISTRATION
        # ==============================================================================
        mlflow.set_tracking_uri(MLFLOW_TRACKING_URI)
        mlflow.set_experiment("recommender_projects")
        
        with mlflow.start_run() as run:
            # 1. Log Parameters
            mlflow.log_param("project_id", project_id)
            mlflow.log_param("model_type", model_type)
            mlflow.log_param("etl_version", "1.0")

            # 2. Log Metrics
            for key, val in metrics.items():
                mlflow.log_metric(key, val)

            # 3. Log Model (Code + Artifacts + Wrapper)
            # We include all source files so the model is self-contained
            code_paths = ["Content.py", "Collaborative.py", "Hybrid.py", "etl.py", "metrics.py"]
            
            model_info = mlflow.pyfunc.log_model(
                artifact_path="recommender_model",
                python_model=MLflowRecommenderWrapper(),
                artifacts=artifacts,
                code_paths=[f for f in code_paths if os.path.exists(f)]
            )
            
            # 4. Register Model
            model_name = f"project-{project_id}-recommender"
            mlflow.register_model(model_info.model_uri, model_name)
            
            logger.info(f"✅ Model successfully registered as '{model_name}'")

        # ==============================================================================
        # PHASE 5: CLEANUP
        # ==============================================================================
        shutil.rmtree(work_dir)
        return {
            "status": "SUCCESS", 
            "model_name": model_name, 
            "run_id": run.info.run_id,
            "metrics": metrics
        }

    except Exception as e:
        logger.error(f"❌ Pipeline Failed: {str(e)}", exc_info=True)
        # Clean up workspace even on failure
        if os.path.exists(work_dir):
            shutil.rmtree(work_dir)
        return {"status": "FAILED", "error": str(e)}