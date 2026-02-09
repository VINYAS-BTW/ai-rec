import enum
from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, JSON
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base

# --- Enums ---
class ProjectStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    READY = "ready"
    ERROR = "error"

class ModelType(str, enum.Enum):
    CONTENT = "content"
    COLLABORATIVE = "collaborative"
    HYBRID = "hybrid"

class FileType(str, enum.Enum):
    CONTENT = "content"
    INTERACTION = "interaction"

# --- Main Project Table ---
class RecommenderProject(Base):
    __tablename__ = "recommender_projects"
    # Namespacing the table (Best practice for Postgres)
    __table_args__ = {"schema": "recommender"}

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, index=True, nullable=True)  # Placeholder for your User ID
    project_name = Column(String, index=True)
    status = Column(String, default=ProjectStatus.PENDING)
    
    # The type of model to build (e.g., 'hybrid')
    model_type = Column(String, default=ModelType.HYBRID)

    # MLflow Metadata (Links DB to Model Registry)
    mlflow_model_name = Column(String, nullable=True)
    mlflow_model_version = Column(Integer, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    uploaded_files = relationship("UploadedFile", back_populates="project", cascade="all, delete-orphan")

# --- Uploaded Files Table ---
class UploadedFile(Base):
    __tablename__ = "uploaded_files"
    __table_args__ = {"schema": "recommender"}

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("recommender.recommender_projects.id"))
    
    original_filename = Column(String)
    storage_path = Column(String)  # The S3 Key (e.g., "projects/1/content/data.csv")
    file_type = Column(String)     # 'content' or 'interaction'
    
    # Stores the user's mapping, e.g., {"user_id": "email", "item_id": "sku"}
    schema_mapping = Column(JSON, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)

    project = relationship("RecommenderProject", back_populates="uploaded_files")