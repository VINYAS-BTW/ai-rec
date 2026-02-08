import os
import json
import uuid
import logging
import boto3
import pandas as pd
import httpx
from typing import List, Optional, Dict
from datetime import datetime

from fastapi import FastAPI, File, UploadFile, Form, Depends, HTTPException, Header, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from contextlib import asynccontextmanager

# --- Custom Modules ---
import models
import schemas
import database
from worker import train_model_task

# --- Configuration ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - [API] - %(levelname)s - %(message)s')
logger = logging.getLogger("API")

# Environment Variables
AWS_BUCKET_NAME = os.getenv("AWS_BUCKET_NAME")
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
WEBHOOK_SERVICE_URL = os.getenv("WEBHOOK_SERVICE_URL", "http://node_service:3001/api/apps")

# Initialize S3
s3_client = boto3.client('s3', region_name=AWS_REGION)

# --- Lifecycle ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 Server starting...")
    try:
        # Create tables (if they don't exist)
        database.create_db_and_tables()
        logger.info("✅ Database tables verified.")
    except Exception as e:
        logger.error(f"❌ Database setup failed: {e}")
    yield
    logger.info("🛑 Server shutting down.")

app = FastAPI(lifespan=lifespan)

# --- Middleware ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Dependencies ---
def get_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_current_user_id(authorization: Optional[str] = Header(None)) -> int:
    # TODO: Implement actual JWT decoding here
    # if not authorization: raise HTTPException(...)
    return 1 

# --- Helper Functions ---
def upload_file_to_s3(file: UploadFile, project_id: int, file_type: str) -> str:
    try:
        file_ext = os.path.splitext(file.filename)[1]
        s3_key = f"projects/{project_id}/{file_type}/{uuid.uuid4()}{file_ext}"
        file.file.seek(0)
        s3_client.upload_fileobj(file.file, AWS_BUCKET_NAME, s3_key)
        return s3_key
    except Exception as e:
        logger.error(f"S3 Upload Error: {e}")
        raise HTTPException(status_code=500, detail="Failed to upload file.")

async def send_webhook_notification(event_type: str, payload: dict):
    """
    Background task to notify external apps via the Node.js webhook service.
    """
    logger.info(f"🔔 Sending webhook: {event_type}")
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            # 1. Get subscribers
            res = await client.get(WEBHOOK_SERVICE_URL)
            if res.status_code != 200:
                logger.warning(f"⚠️ Webhook service unreachable: {res.status_code}")
                return
            
            apps = res.json()
            # 2. Notify subscribers
            for app in apps:
                target_url = app.get("webhook_url")
                if target_url:
                    try:
                        await client.post(target_url, json={
                            "event": event_type,
                            "payload": payload,
                            "timestamp": datetime.utcnow().isoformat()
                        })
                    except Exception as e:
                        logger.error(f"❌ Failed to notify {target_url}: {e}")
        except Exception as e:
            logger.error(f"❌ Webhook Error: {e}")

# --- Endpoints ---

@app.post("/create-project/", response_model=schemas.RecommenderProject)
async def create_project(
    background_tasks: BackgroundTasks,
    project_name: str = Form(...),
    content_file: UploadFile = File(None),
    content_schema_json: str = Form(None),
    interaction_file: UploadFile = File(None),
    interaction_schema_json: str = Form(None),
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db)
):
    # 1. Validation
    if not content_file and not interaction_file:
        raise HTTPException(status_code=400, detail="At least one file is required.")

    model_type = models.ModelType.HYBRID if (content_file and interaction_file) else \
                 models.ModelType.CONTENT if content_file else \
                 models.ModelType.COLLABORATIVE

    # 2. DB Entry
    db_project = models.RecommenderProject(
        owner_id=current_user_id,
        project_name=project_name,
        status=models.ProjectStatus.PENDING,
        model_type=model_type
    )
    db.add(db_project)
    db.commit()
    db.refresh(db_project)

    # 3. Uploads & Configuration
    files_config = {}
    schemas_config = {}

    try:
        # Process Content File
        if content_file:
            if not content_schema_json:
                raise HTTPException(status_code=400, detail="Content schema missing.")
            
            s3_key = upload_file_to_s3(content_file, db_project.id, "content")
            files_config["content"] = s3_key
            schemas_config["content"] = json.loads(content_schema_json)
            
            db.add(models.UploadedFile(
                project_id=db_project.id,
                original_filename=content_file.filename,
                storage_path=s3_key,
                file_type=models.FileType.CONTENT,
                schema_mapping=schemas_config["content"]
            ))

        # Process Interaction File
        if interaction_file:
            if not interaction_schema_json:
                raise HTTPException(status_code=400, detail="Interaction schema missing.")
            
            s3_key = upload_file_to_s3(interaction_file, db_project.id, "interaction")
            files_config["interaction"] = s3_key
            schemas_config["interaction"] = json.loads(interaction_schema_json)
            
            db.add(models.UploadedFile(
                project_id=db_project.id,
                original_filename=interaction_file.filename,
                storage_path=s3_key,
                file_type=models.FileType.INTERACTION,
                schema_mapping=schemas_config["interaction"]
            ))

        db.commit()

        # 4. Dispatch Celery Task
        project_config = {
            "model_type": model_type,
            "files": files_config,
            "schemas": schemas_config
        }
        train_model_task.delay(db_project.id, project_config)
        
        # 5. Trigger Webhook (Background)
        background_tasks.add_task(
            send_webhook_notification, 
            "PROJECT_CREATED", 
            {"project_id": db_project.id, "name": project_name}
        )
        
        # Update status
        db_project.status = models.ProjectStatus.PROCESSING
        db.commit()

    except Exception as e:
        logger.error(f"Creation failed: {e}")
        db.delete(db_project)
        db.commit()
        raise HTTPException(status_code=500, detail=str(e))

    return db_project

@app.get("/projects/", response_model=List[schemas.RecommenderProject])
def get_projects(
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return db.query(models.RecommenderProject).filter(
        models.RecommenderProject.owner_id == current_user_id
    ).all()

@app.get("/project/{project_id}", response_model=schemas.RecommenderProject)
def get_project(
    project_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    proj = db.query(models.RecommenderProject).filter(
        models.RecommenderProject.id == project_id,
        models.RecommenderProject.owner_id == current_user_id
    ).first()
    if not proj:
        raise HTTPException(404, "Project not found")
    return proj

# --- Inference ---
import mlflow.pyfunc

@app.get("/project/{project_id}/recommendations", response_model=schemas.RecommendationResponse)
def get_recommendations(
    project_id: int,
    user_id: Optional[str] = None,
    item_title: Optional[str] = None,
    n: int = 10,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    # 1. Check Project Status
    project = db.query(models.RecommenderProject).filter(
        models.RecommenderProject.id == project_id,
        models.RecommenderProject.owner_id == current_user_id
    ).first()
    
    if not project or not project.mlflow_model_name:
        raise HTTPException(404, "Project or Model not found/ready")

    try:
        # 2. Load Model from MLflow
        # (In production, consider caching 'loaded_model' to avoid reloading per request)
        model_uri = f"models:/{project.mlflow_model_name}/Latest"
        loaded_model = mlflow.pyfunc.load_model(model_uri)
        
        # 3. Predict
        input_data = pd.DataFrame([{
            "user_id": user_id, 
            "item_title": item_title, 
            "n": n
        }])
        
        result_json = loaded_model.predict(input_data)[0]
        result = json.loads(result_json)
        
        if result.get("error"):
             raise HTTPException(400, result["error"])

        return schemas.RecommendationResponse(
            input_item_title=item_title,
            input_user_id=user_id,
            model_type=project.model_type,
            recommendations=result["recommendations"]
        )

    except Exception as e:
        logger.error(f"Inference error: {e}")
        raise HTTPException(500, f"Inference failed: {str(e)}")