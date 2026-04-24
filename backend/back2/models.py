from sqlalchemy import Column, Integer, String, ForeignKey, Enum, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base
import enum

class ProjectStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    READY = "ready"
    ERROR = "error"

class ModelType(str, enum.Enum):
    CONTENT = "content"
    COLLABORATIVE = "collaborative"
    HYBRID = "hybrid"
    PARAMETER_DRIVEN = "parameter_driven"

class FileType(str, enum.Enum):
    CONTENT = "content"
    INTERACTION = "interaction"

# --- Main Project Table (schema: recommender for PostgreSQL/Neon) ---
class RecommenderProject(Base):
    __tablename__ = "recommender_projects"
    __table_args__ = {"schema": "recommender"}

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, index=True, nullable=True)  # auth.users.id; NULL = legacy pre-migration
    project_name = Column(String, index=True)
    status = Column(String, default=ProjectStatus.PENDING)
    
    # Type of model to be built
    model_type = Column(String, nullable=True) 

    # MLflow tracking
    mlflow_model_name = Column(String, nullable=True)
    mlflow_model_version = Column(Integer, nullable=True)

    # A project can have multiple files (e.g., one content, one interaction)
    uploaded_files = relationship("UploadedFile", back_populates="project", cascade="all, delete-orphan")

# --- Uploaded Files Table ---
class UploadedFile(Base):
    __tablename__ = "uploaded_files"
    __table_args__ = {"schema": "recommender"}

    id = Column(Integer, primary_key=True, index=True)
    original_filename = Column(String)
    storage_path = Column(String, unique=True)
    file_type = Column(String)  # 'content' or 'interaction'

    project_id = Column(Integer, ForeignKey("recommender.recommender_projects.id"))
    project = relationship("RecommenderProject", back_populates="uploaded_files")
    
    # A file has its own set of schema mappings
    schema_mappings = relationship("SchemaMapping", back_populates="file", cascade="all, delete-orphan")

# --- Schema Mappings Table ---
class SchemaMapping(Base):
    __tablename__ = "schema_mappings"
    __table_args__ = {"schema": "recommender"}

    id = Column(Integer, primary_key=True, index=True)

    # e.g., 'item_id', 'item_title', 'user_id', 'rating'
    app_schema_key = Column(String, index=True)

    # The column name from the user's CSV
    user_csv_column = Column(String)

    file_id = Column(Integer, ForeignKey("recommender.uploaded_files.id"))
    file = relationship("UploadedFile", back_populates="schema_mappings")


# --- Feature Store Tables ---

class UserFeatureRow(Base):
    """Per-(project_id, user_id) feature bag for the feature store."""
    __tablename__ = "user_features"
    __table_args__ = {"schema": "recommender"}

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, index=True, nullable=False)
    user_id = Column(String, index=True, nullable=False)
    features_json = Column(String, nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ItemFeatureRow(Base):
    """Per-(project_id, item_id) feature bag for the feature store."""
    __tablename__ = "item_features"
    __table_args__ = {"schema": "recommender"}

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, index=True, nullable=False)
    item_id = Column(String, index=True, nullable=False)
    features_json = Column(String, nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())