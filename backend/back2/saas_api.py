import pandas as pd
import aiofiles
import os
from dotenv import load_dotenv
load_dotenv()

import uuid
import json
import asyncio
import pickle
import numpy as np
import tempfile
import jwt
from fastapi import FastAPI, File, UploadFile, Form, Depends, HTTPException, BackgroundTasks, Header
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import or_
from sqlalchemy.orm import Session
from contextlib import asynccontextmanager
from typing import List, Optional, Dict

import models
import schemas
import database
import httpx
# --- MLflow path-only URI fix: patch registry before mlflow is used so all callers get the wrapper ---
_BACK2_DIR = os.path.dirname(os.path.abspath(__file__))


def _path_to_file_uri(path: str) -> str:
    path = os.path.abspath(path)
    if os.name == "nt":
        path = path.replace("\\", "/")
        return "file:///" + path if path[0] != "/" else "file://" + path
    return "file://" + path


def _ensure_file_uri(uri: str) -> str:
    if "://" in uri or uri.startswith("runs:") or uri.startswith("models:"):
        return uri
    path = os.path.normpath(uri)
    if os.name == "nt":
        path = path.replace("\\", "/")
        return "file:///" + path if path and path[0] != "/" else "file://" + path
    return "file://" + path


import mlflow
# --- Import your classes ---
from Content import ContentBasedRecommender
from Collaborative import CollaborativeFilteringRecommender
# --- Import the MLflow wrapper ---
from dynamic_recommender import MLflowRecommenderWrapper
from datetime import datetime



async def notify_webhooks(event_type: str, payload: dict):
    """Send event payload to all registered external apps via the Node webhook service."""
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get("http://localhost:3001/api/apps")
            if res.status_code != 200:
                print("⚠️ Could not fetch registered apps from webhook service")
                return
            apps = res.json()

            for app in apps:
                try:
                    await client.post(
                        app["webhook_url"],
                        json={
                            "event": event_type,
                            "data": payload,
                            "api_key": app["api_key"],
                        },
                        timeout=10.0,
                    )
                    print(f"✅ Notified {app['app_name']} at {app['webhook_url']}")
                except Exception as e:
                    print(f"❌ Failed to send to {app['app_name']}: {e}")
    except Exception as e:
        print(f"❌ notify_webhooks failed: {e}")
# --- App Setup & Model Storage ---
USER_UPLOADS_DIR = os.path.join(_BACK2_DIR, "user_uploads")
os.makedirs(USER_UPLOADS_DIR, exist_ok=True)
# Save models to a local directory (avoids MLflow artifact store and Windows path issues).
PROJECT_MODELS_DIR = os.path.join(_BACK2_DIR, "project_models")
os.makedirs(PROJECT_MODELS_DIR, exist_ok=True)
# --- END CONFIG ---

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Server starting...")
    if not os.getenv("JWT_SECRET"):
        print("WARNING: JWT_SECRET not set in backend/back2/.env. Set it (same value as auth service) or project list will return 500 and users will see no projects.")
    database.create_db_and_tables()
    print("Database tables created.")
    yield
    print("Server shutting down.")

app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000","http://localhost:8000","http://localhost:3001","http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Auth: JWT from auth service, or X-Internal-Key for server-to-server (webhook service) ---
BACK2_INTERNAL_KEY = os.getenv("BACK2_INTERNAL_KEY", "")

def get_current_user_id(
    authorization: Optional[str] = Header(None, alias="Authorization"),
    x_internal_key: Optional[str] = Header(None, alias="X-Internal-Key"),
) -> int:
    # Server-to-server: webhook service calls with X-Internal-Key to get recommendations without user JWT
    if BACK2_INTERNAL_KEY and x_internal_key and x_internal_key.strip() == BACK2_INTERNAL_KEY:
        return -1
    secret = os.getenv("JWT_SECRET")
    if not secret:
        raise HTTPException(
            status_code=500,
            detail="JWT_SECRET not configured. Set it in backend/back2/.env (same value as auth service) for user-wise projects.",
        )
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization header")
    token = authorization[7:].strip()
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
        user_id = payload.get("id")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        return int(user_id)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

def get_next_project_id(db: Session) -> int:
    """Return the smallest positive integer not used as project id (reuse deleted ids)."""
    used = {row[0] for row in db.query(models.RecommenderProject.id).all()}
    candidate = 1
    while candidate in used:
        candidate += 1
    return candidate


def get_project_for_user(project_id: int, user_id: int, db: Session):
    """Return project only if it belongs to user (or legacy owner_id 0/None, or service user -1); else 404."""
    db_project = db.query(models.RecommenderProject).filter(
        models.RecommenderProject.id == project_id
    ).first()
    if not db_project:
        raise HTTPException(status_code=404, detail="Project not found.")
    if user_id == -1:
        return db_project  # internal key (webhook service)
    if db_project.owner_id is None or db_project.owner_id == 0:
        return db_project  # legacy: any authenticated user can access
    if db_project.owner_id != user_id:
        raise HTTPException(status_code=404, detail="Project not found.")
    return db_project

# --- Helper function (Unchanged) ---
async def save_file_and_schema(
    db: Session,
    project_id: int,
    file: UploadFile,
    schema_json: str,
    file_type: models.FileType
) -> models.UploadedFile:
    
    storage_filename = f"{uuid.uuid4()}_{file.filename}"
    storage_path = os.path.join(USER_UPLOADS_DIR, storage_filename)
    
    async with aiofiles.open(storage_path, 'wb') as out_file:
        content = await file.read()
        await out_file.write(content)
        
    db_file = models.UploadedFile(
        project_id=project_id,
        original_filename=file.filename,
        storage_path=storage_path,
        file_type=file_type
    )
    db.add(db_file)
    db.commit()
    db.refresh(db_file)
    
    try:
        schema_map = json.loads(schema_json)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail=f"Invalid schema JSON for {file_type} file.")
    
    for app_key, user_col in schema_map.items():
        if isinstance(user_col, list):
            for col in user_col:
                db_schema = models.SchemaMapping(
                    app_schema_key='feature_col',
                    user_csv_column=col,
                    file_id=db_file.id,
                )
                db.add(db_schema)
        else:
            db_schema = models.SchemaMapping(
                app_schema_key=app_key,
                user_csv_column=user_col,
                file_id=db_file.id,
            )
            db.add(db_schema)

    db.commit()
    return db_file

# --- Background Task for Model Training (Updated) ---

async def process_project(project_id: int, db: Session):
    """
    Background task to train models from Content.py and Collaborative.py
    and register them with MLflow.
    """
    print(f"[Task {project_id}]: Started processing...")
    db_project = None
    try:
        db_project = db.query(models.RecommenderProject).filter(models.RecommenderProject.id == project_id).first()
        if not db_project:
            raise Exception("Project not found in DB.")

        db_project.status = models.ProjectStatus.PROCESSING
        db.commit()

        # --- Load files and schemas (Unchanged) ---
        files = db_project.uploaded_files
        content_file = next((f for f in files if f.file_type == models.FileType.CONTENT), None)
        interaction_file = next((f for f in files if f.file_type == models.FileType.INTERACTION), None)

        df_content, df_interaction = None, None
        content_schema, interaction_schema = {}, {}
        all_schemas_map = {} 
        
        if content_file:
            df_content = pd.read_csv(content_file.storage_path)
            content_schema = {s.app_schema_key: s.user_csv_column for s in content_file.schema_mappings if s.app_schema_key != 'feature_col' and (s.user_csv_column or '').strip()}
            content_schema['feature_cols'] = [s.user_csv_column for s in content_file.schema_mappings if s.app_schema_key == 'feature_col' and (s.user_csv_column or '').strip()]
            all_schemas_map['content'] = content_schema

        if interaction_file:
            df_interaction = pd.read_csv(interaction_file.storage_path)
            # Ensure user_id and item_id are strings for consistency
            schema_map = {s.app_schema_key: s.user_csv_column for s in interaction_file.schema_mappings}
            df_interaction[schema_map['user_id']] = df_interaction[schema_map['user_id']].astype(str)
            df_interaction[schema_map['item_id']] = df_interaction[schema_map['item_id']].astype(str)
            interaction_schema = schema_map
            all_schemas_map['interaction'] = interaction_schema
            
        # Ensure content item_ids are strings if they exist
        if df_content is not None and 'item_id' in content_schema:
            df_content[content_schema['item_id']] = df_content[content_schema['item_id']].astype(str)


        model_type = db_project.model_type
        print(f"[Task {project_id}]: Building model of type: {model_type}")

        # --- Artifacts will be saved here ---
        with tempfile.TemporaryDirectory() as tmpdir:
            artifacts = {}
            
            # --- Save model_type config (Unchanged) ---
            model_type_config_path = os.path.join(tmpdir, "model_type.json")
            with open(model_type_config_path, 'w') as f:
                json.dump({"model_type": model_type, "schemas": all_schemas_map}, f)
            artifacts["model_type_config"] = model_type_config_path
            
            # --- Train Content-Based Model (Updated) ---
            if model_type in [models.ModelType.CONTENT, models.ModelType.HYBRID]:
                if not content_schema.get('feature_cols'):
                    raise ValueError("Content/Hybrid model requires at least one feature column mapped in the content file schema.")
                if not content_schema.get('item_id') or not content_schema.get('item_title'):
                    raise ValueError("Content schema must have both item_id and item_title mapped.")
                print(f"[Task {project_id}]: Fitting ContentBasedRecommender...")
                cb_recommender = ContentBasedRecommender()
                cb_recommender.fit(df_content, content_schema)
                
                # Define and save CB artifacts
                artifacts["cb_cosine_sim"] = os.path.join(tmpdir, "cb_cosine_sim.pkl")
                artifacts["cb_indices"] = os.path.join(tmpdir, "cb_indices.pkl")
                artifacts["cb_data"] = os.path.join(tmpdir, "cb_data.csv")
                
                with open(artifacts["cb_cosine_sim"], 'wb') as f: pickle.dump(cb_recommender.cosine_sim, f)
                with open(artifacts["cb_indices"], 'wb') as f: pickle.dump(cb_recommender.indices, f)
                cb_recommender.df.to_csv(artifacts["cb_data"], index=False)
                print(f"[Task {project_id}]: Saved Content model artifacts.")

            # --- Train Collaborative Filtering Model (Updated) ---
            if model_type in [models.ModelType.COLLABORATIVE, models.ModelType.HYBRID]:
                print(f"[Task {project_id}]: Fitting CollaborativeFilteringRecommender...")
                cf_recommender = CollaborativeFilteringRecommender(n_components=50)
                cf_recommender.fit(df_interaction, interaction_schema)
                
                # Define and save CF artifacts
                artifacts["cf_user_features"] = os.path.join(tmpdir, "cf_user_features.npy")
                artifacts["cf_item_features"] = os.path.join(tmpdir, "cf_item_features.npy")
                artifacts["cf_user_means"] = os.path.join(tmpdir, "cf_user_means.pkl")
                artifacts["cf_item_ids"] = os.path.join(tmpdir, "cf_item_ids.pkl")
                artifacts["cf_user_ids"] = os.path.join(tmpdir, "cf_user_ids.pkl")
                artifacts["cf_pivot"] = os.path.join(tmpdir, "cf_pivot.pkl")

                np.save(artifacts["cf_user_features"], cf_recommender.user_features)
                np.save(artifacts["cf_item_features"], cf_recommender.item_features)
                with open(artifacts["cf_user_means"], 'wb') as f: pickle.dump(cf_recommender.user_means, f)
                with open(artifacts["cf_item_ids"], 'wb') as f: pickle.dump(cf_recommender.item_ids, f)
                with open(artifacts["cf_user_ids"], 'wb') as f: pickle.dump(cf_recommender.user_ids, f)
                with open(artifacts["cf_pivot"], 'wb') as f: pickle.dump(cf_recommender.original_ratings_pivot, f)
                print(f"[Task {project_id}]: Saved Collaborative model artifacts.")

            # --- Save content data for pure collaborative model (for lookups) ---
            if model_type == models.ModelType.COLLABORATIVE and df_content is not None:
                 artifacts["cb_data"] = os.path.join(tmpdir, "cb_data.csv")
                 df_content.to_csv(artifacts["cb_data"], index=False)
                 print(f"[Task {project_id}]: Saved Content data for Collaborative title lookups.")


            model_name = f"project-{project_id}-recommender"
            # Save model to local directory (avoids MLflow artifact store / Windows path issues).
            saved_model_path = os.path.join(PROJECT_MODELS_DIR, f"project_{project_id}")
            os.makedirs(saved_model_path, exist_ok=True)
            mlflow.pyfunc.save_model(
                path=saved_model_path,
                python_model=MLflowRecommenderWrapper(),
                artifacts=artifacts,
                code_paths=["dynamic_recommender.py", "Content.py", "Collaborative.py", "Hybrid.py"],
            )
            print(f"[Task {project_id}]: Model saved to {saved_model_path}")

        # --- Update Project in DB ---
        db_project.mlflow_model_name = model_name
        db_project.mlflow_model_version = 1  # Local model version (not from registry)
        db_project.status = models.ProjectStatus.READY
        db.commit()
        print(f"[Task {project_id}]: Processing complete.")

        # --- Send webhook notification ---
        try:
            await notify_webhooks("model_ready", {
                "project_id": db_project.id,
                "project_name": db_project.project_name,
                "model_type": db_project.model_type,
                "timestamp": str(datetime.utcnow()),
            })
        except Exception as notify_err:
            print(f"[Task {project_id}]: Failed to notify webhooks - {notify_err}")

    except Exception as e:
        import traceback
        print(f"[Task {project_id}]: ERROR processing project. {e}")
        traceback.print_exc()
        if db_project:
            db_project.status = models.ProjectStatus.ERROR
            db.commit()
    finally:
        db.close()

@app.post("/create-project/", response_model=schemas.RecommenderProject)
async def create_project(
    background_tasks: BackgroundTasks,
    current_user_id: int = Depends(get_current_user_id),
    project_name: str = Form(...),
    content_file: UploadFile = File(None),
    content_schema_json: str = Form(None),
    interaction_file: UploadFile = File(None),
    interaction_schema_json: str = Form(None),
    db: Session = Depends(database.get_db)
):
    if not content_file and not interaction_file:
        raise HTTPException(status_code=400, detail="At least one file (content or interaction) must be provided.")
    if content_file and not content_schema_json:
        raise HTTPException(status_code=400, detail="Content schema is required if content file is provided.")
    if interaction_file and not interaction_schema_json:
        raise HTTPException(status_code=400, detail="Interaction schema is required if interaction file is provided.")

    model_type = None
    if content_file and interaction_file:
        model_type = models.ModelType.HYBRID
    elif content_file:
        model_type = models.ModelType.CONTENT
    elif interaction_file:
        model_type = models.ModelType.COLLABORATIVE

    next_id = get_next_project_id(db)
    db_project = models.RecommenderProject(
        id=next_id,
        owner_id=current_user_id,
        project_name=project_name,
        status=models.ProjectStatus.PENDING,
        model_type=model_type
    )
    db.add(db_project)
    db.commit()
    db.refresh(db_project)
    
    try:
        if content_file:
            await save_file_and_schema(db, db_project.id, content_file, content_schema_json, models.FileType.CONTENT)
        if interaction_file:
            await save_file_and_schema(db, db_project.id, interaction_file, interaction_schema_json, models.FileType.INTERACTION)
    except Exception as e:
        db_project.status = models.ProjectStatus.ERROR
        db.commit()
        raise HTTPException(status_code=500, detail=f"Error processing files: {e}")

    background_db = database.SessionLocal()
    background_tasks.add_task(process_project, db_project.id, background_db)
    
    db.refresh(db_project)
    return db_project


@app.get("/projects/", response_model=List[schemas.RecommenderProject])
def get_projects(
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    if current_user_id == -1:
        raise HTTPException(status_code=401, detail="Internal key cannot list projects.")
    # Own projects + legacy (owner_id 0 or None) so re-login still sees previously created projects
    projects = db.query(models.RecommenderProject).filter(
        or_(
            models.RecommenderProject.owner_id == current_user_id,
            models.RecommenderProject.owner_id.is_(None),
            models.RecommenderProject.owner_id == 0,
        )
    ).all()
    return projects

@app.get("/project/{project_id}/status", response_model=schemas.RecommenderProject)
def get_project_status(
    project_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    db_project = get_project_for_user(project_id, current_user_id, db)
    return db_project


@app.delete("/project/{project_id}")
def delete_project(
    project_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    db_project = get_project_for_user(project_id, current_user_id, db)
    for f in db_project.uploaded_files:
        if f.storage_path and os.path.isfile(f.storage_path):
            try:
                os.remove(f.storage_path)
            except OSError:
                pass
    db.delete(db_project)
    db.commit()
    return {"message": "Project deleted."}


def get_project_data(project_id: int, user_id: int, db: Session, file_type: models.FileType):
    db_project = get_project_for_user(project_id, user_id, db)
    if db_project.status != models.ProjectStatus.READY:
        raise HTTPException(status_code=400, detail="Project is not ready.")
    
    file = next((f for f in db_project.uploaded_files if f.file_type == file_type), None)
    if not file:
        raise HTTPException(status_code=404, detail=f"{file_type} file not found for this project.")
        
    df = pd.read_csv(file.storage_path)
    schema = {s.app_schema_key: s.user_csv_column for s in file.schema_mappings}
    return df, schema

# Max items/users returned for dropdowns (keeps response and UI fast)
ITEMS_USERS_LIMIT = 2000

@app.get("/project/{project_id}/items", response_model=List[schemas.ProjectItemResponse])
def get_project_items(
    project_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    try:
        df, schema = get_project_data(project_id, current_user_id, db, models.FileType.CONTENT)
        id_col, title_col = schema['item_id'], schema['item_title']
        df[id_col] = df[id_col].astype(str)
        items_df = df[[id_col, title_col]].drop_duplicates().head(ITEMS_USERS_LIMIT)
        items = [{"id": str(row[id_col]), "title": str(row[title_col])} for row in items_df.to_dict("records")]
        return items
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error loading items: {e}")

@app.get("/project/{project_id}/users", response_model=List[schemas.ProjectUserResponse])
def get_project_users(
    project_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    try:
        df, schema = get_project_data(project_id, current_user_id, db, models.FileType.INTERACTION)
        user_col = schema['user_id']
        users_series = df[user_col].drop_duplicates().astype(str).head(ITEMS_USERS_LIMIT)
        return [{"id": u} for u in users_series.tolist()]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error loading users: {e}")


@app.get("/project/{project_id}/recommendations", response_model=schemas.RecommendationResponse)
def get_recommendations(
    project_id: int,
    user_id: Optional[str] = None,
    item_title: Optional[str] = None,
    n: int = 10,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(database.get_db),
):
    db_project = get_project_for_user(project_id, current_user_id, db)
    if db_project.status != models.ProjectStatus.READY:
        raise HTTPException(status_code=400, detail=f"Project status is {db_project.status}.")
    if not db_project.mlflow_model_name:
         raise HTTPException(status_code=404, detail="Model not found in registry.")

    model_type = db_project.model_type
    if model_type == models.ModelType.CONTENT and not item_title:
        raise HTTPException(status_code=400, detail="item_title is required for this content-based model.")
    if model_type == models.ModelType.COLLABORATIVE and not user_id:
        raise HTTPException(status_code=400, detail="user_id is required for this collaborative model.")
    if model_type == models.ModelType.HYBRID and (not user_id or not item_title):
        raise HTTPException(status_code=400, detail="user_id and item_title are required for this hybrid model.")

    try:
        # Load from local project_models directory (file URI for Windows compatibility).
        local_model_path = os.path.join(PROJECT_MODELS_DIR, f"project_{project_id}")
        if not os.path.isdir(local_model_path):
            raise HTTPException(status_code=404, detail="Model not found. Re-train the project.")
        model_uri = _path_to_file_uri(local_model_path)
        print(f"Loading model from: {local_model_path}")
        print(f"Project details: {db_project.project_name} (ID: {db_project.id})")
        print(f"Model type: {model_type}, User ID: {user_id}, Item title: {item_title}")

        model = mlflow.pyfunc.load_model(model_uri)
        print("Model loaded successfully")
        
        model_input = pd.DataFrame([{"user_id": user_id, "item_title": item_title, "n": n}])
        print(f"Model input: {model_input.to_dict('records')}")
        
        result_json = model.predict(model_input)[0]
        print(f"Raw prediction result: {result_json}")
        
        result = json.loads(result_json)
        print(f"Parsed result: {result}")
        
        if result.get("error"):
            raise ValueError(result["error"])
            
        return schemas.RecommendationResponse(
            input_item_title=item_title,
            input_user_id=user_id,
            model_type=model_type,
            recommendations=result["recommendations"]
        )
        
    except ValueError as e: 
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        print(f"Error loading model or predicting: {e}")
        raise HTTPException(status_code=500, detail=f"Error generating recommendations: {e}")