from pydantic import BaseModel, ConfigDict
from typing import List, Dict, Optional
from models import ProjectStatus, ModelType, FileType

# --- SchemaMapping Schemas ---
class SchemaMappingBase(BaseModel):
    app_schema_key: str
    user_csv_column: str

class SchemaMapping(SchemaMappingBase):
    id: int
    file_id: int
    model_config = ConfigDict(from_attributes=True)

# --- UploadedFile Schemas ---
class UploadedFileBase(BaseModel):
    original_filename: str
    storage_path: str
    file_type: FileType

class UploadedFile(UploadedFileBase):
    id: int
    project_id: int
    schema_mappings: List[SchemaMapping] = []
    model_config = ConfigDict(from_attributes=True)

# --- RecommenderProject Schemas ---
class RecommenderProjectBase(BaseModel):
    project_name: str

class RecommenderProject(RecommenderProjectBase):
    id: int
    owner_id: Optional[int] = None
    status: ProjectStatus
    model_type: Optional[ModelType]
    mlflow_model_name: Optional[str]
    mlflow_model_version: Optional[int]
    uploaded_files: List[UploadedFile] = []
    model_config = ConfigDict(from_attributes=True)

# --- API Response Schemas ---
class RecommendationResponse(BaseModel):
    input_item_title: Optional[str]
    input_user_id: Optional[str]
    model_type: ModelType
    recommendations: List[Dict]

class ProjectItemResponse(BaseModel):
    id: str
    title: str

class ProjectUserResponse(BaseModel):
    id: str


class ContextOptionColumn(BaseModel):
    name: str
    values: List[str] = []
    column_type: Optional[str] = None  # "numeric" | "categorical"
    numeric_range: Optional[Dict[str, float]] = None  # {"min": float, "max": float} for numeric columns


class ContextOptionsResponse(BaseModel):
    target_column: str
    feature_columns: List[ContextOptionColumn]
    target_values: Optional[List[str]] = None  # distinct values of target (e.g. movie/car titles) for "recommend based on this item"


class TargetValuesResponse(BaseModel):
    """Values of the column the model recommends — for 'similar to' dropdown (content, parameter_driven, hybrid)."""
    target_column: str
    target_values: List[str]