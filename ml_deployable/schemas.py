from pydantic import BaseModel, ConfigDict
from typing import List, Optional, Dict, Any
from datetime import datetime
from models import ProjectStatus, ModelType, FileType

# --- File Schemas ---
class UploadedFileBase(BaseModel):
    original_filename: str
    file_type: FileType
    storage_path: str
    schema_mapping: Optional[Dict[str, Any]] = None

class UploadedFile(UploadedFileBase):
    id: int
    project_id: int
    created_at: datetime
    
    # Allows Pydantic to read from SQLAlchemy objects
    model_config = ConfigDict(from_attributes=True)

# --- Project Schemas ---
class RecommenderProjectBase(BaseModel):
    project_name: str

class RecommenderProjectCreate(RecommenderProjectBase):
    pass

class RecommenderProject(RecommenderProjectBase):
    id: int
    owner_id: Optional[int]
    status: ProjectStatus
    model_type: ModelType
    
    mlflow_model_name: Optional[str] = None
    mlflow_model_version: Optional[int] = None
    
    created_at: datetime
    updated_at: datetime
    
    # Include files in the response
    uploaded_files: List[UploadedFile] = []

    model_config = ConfigDict(from_attributes=True)

# --- Inference / Prediction Schemas ---
class RecommendationItem(BaseModel):
    id: str
    title: Optional[str] = "Unknown"

class RecommendationResponse(BaseModel):
    input_item_title: Optional[str]
    input_user_id: Optional[str]
    model_type: str
    recommendations: List[Dict[str, Any]] # Allows flexible fields