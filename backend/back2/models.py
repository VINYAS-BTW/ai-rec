from sqlalchemy import Column, Integer, String, ForeignKey, Enum, DateTime, Boolean, Float, Text
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


# --- Model Registry & Serving Controls ---

class ModelRegistryRole(str, enum.Enum):
    CHAMPION = "champion"
    CHALLENGER = "challenger"
    RETIRED = "retired"


class ModelRegistryEntry(Base):
    __tablename__ = "model_registry_entries"
    __table_args__ = {"schema": "recommender"}

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, index=True, nullable=False)
    owner_id = Column(Integer, index=True, nullable=True)
    model_type = Column(String, nullable=True)
    version = Column(Integer, nullable=False)
    role = Column(String, nullable=False, default=ModelRegistryRole.CHALLENGER)
    model_path = Column(String, nullable=False)
    metrics_json = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    promoted_at = Column(DateTime(timezone=True), nullable=True)
    retired_at = Column(DateTime(timezone=True), nullable=True)


class ServingControl(Base):
    __tablename__ = "serving_controls"
    __table_args__ = {"schema": "recommender"}

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, index=True, nullable=False, unique=True)
    shadow_enabled = Column(Boolean, nullable=False, default=False)
    shadow_percentage = Column(Integer, nullable=False, default=10)
    latency_warn_ms = Column(Integer, nullable=False, default=500)
    champion_latency_ms = Column(Float, nullable=True)
    challenger_latency_ms = Column(Float, nullable=True)
    shadow_request_count = Column(Integer, nullable=False, default=0)
    shadow_error_count = Column(Integer, nullable=False, default=0)
    last_request_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class SuperAgentSession(Base):
    __tablename__ = "superagent_sessions"
    __table_args__ = {"schema": "recommender"}

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String, index=True, nullable=False, unique=True)
    payload_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


# ─────────────────────────────────────────────────────────────────────────────
# Experimentation Service Tables
# ─────────────────────────────────────────────────────────────────────────────

class ExperimentStatus(str, enum.Enum):
    DRAFT = "draft"
    RUNNING = "running"
    CONCLUDED = "concluded"
    ARCHIVED = "archived"


class ExperimentDefinition(Base):
    """An A/B experiment definition (variants, traffic splits, goal metric)."""
    __tablename__ = "experiment_definitions"
    __table_args__ = {"schema": "recommender"}

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, index=True, nullable=True)           # auth user
    project_id = Column(Integer, index=True, nullable=True)          # optional project scope
    name = Column(String, nullable=False, index=True)
    description = Column(Text, nullable=True)
    # JSON: [{"id": "control", "label": "Control", "weight": 50}, ...]
    variants_json = Column(Text, nullable=False, default="[]")       
    # JSON: {"control": 50, "variant_a": 50}  (% of total traffic)
    traffic_split_json = Column(Text, nullable=False, default="{}")  
    goal_metric = Column(String, nullable=True)                       # e.g. "click_rate"
    status = Column(String, nullable=False, default=ExperimentStatus.DRAFT)
    winner_variant = Column(String, nullable=True)                    # set on conclude
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    started_at = Column(DateTime(timezone=True), nullable=True)
    concluded_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    assignments = relationship("ExperimentAssignment", back_populates="experiment", cascade="all, delete-orphan")


class ExperimentAssignment(Base):
    """Records which variant a user/session was assigned to."""
    __tablename__ = "experiment_assignments"
    __table_args__ = {"schema": "recommender"}

    id = Column(Integer, primary_key=True, index=True)
    experiment_id = Column(Integer, ForeignKey("recommender.experiment_definitions.id"), index=True, nullable=False)
    bucket_key = Column(String, index=True, nullable=False)          # user_id or session_id
    variant = Column(String, nullable=False)
    assigned_at = Column(DateTime(timezone=True), server_default=func.now())

    experiment = relationship("ExperimentDefinition", back_populates="assignments")
    events = relationship("ExperimentEvent", back_populates="assignment", cascade="all, delete-orphan")


class ExperimentEvent(Base):
    """An outcome event (impression / click / conversion) tied to an assignment."""
    __tablename__ = "experiment_events"
    __table_args__ = {"schema": "recommender"}

    id = Column(Integer, primary_key=True, index=True)
    assignment_id = Column(Integer, ForeignKey("recommender.experiment_assignments.id"), index=True, nullable=False)
    # impression | click | conversion | custom
    event_type = Column(String, nullable=False, index=True)
    value = Column(Float, nullable=True)                             # optional numeric payload
    meta_json = Column(Text, nullable=True)
    occurred_at = Column(DateTime(timezone=True), server_default=func.now())

    assignment = relationship("ExperimentAssignment", back_populates="events")