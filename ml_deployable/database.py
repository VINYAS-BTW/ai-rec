import os
from sqlalchemy import create_engine, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

load_dotenv()

# 1. Get the URL
DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise ValueError("DATABASE_URL is not set. Check your .env file.")

# 2. Fix for SQLAlchemy compatibility (Neon/Heroku use 'postgres://', SQLAlchemy needs 'postgresql://')
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# 3. Create Engine
# pool_pre_ping=True helps reconnect if the database connection drops (common in cloud)
engine_kwargs = {"pool_pre_ping": True}

# Only use check_same_thread for SQLite (fallback)
if DATABASE_URL.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}
    # Remove pool_pre_ping for sqlite as it handles pooling differently usually
    engine_kwargs.pop("pool_pre_ping", None)

engine = create_engine(DATABASE_URL, **engine_kwargs)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def create_db_and_tables():
    """
    Creates the 'recommender' schema (namespacing) and all tables.
    """
    # 4. Create Schema for PostgreSQL
    if "postgresql" in DATABASE_URL:
        try:
            with engine.connect() as conn:
                conn.execute(text("CREATE SCHEMA IF NOT EXISTS recommender"))
                conn.commit()
        except Exception as e:
            print(f"Warning: Could not create schema (might already exist): {e}")

    # 5. Create Tables
    Base.metadata.create_all(bind=engine)
    
    # 6. Schema Migration: Add owner_id if missing (for updating existing DBs)
    if "postgresql" in DATABASE_URL:
        with engine.connect() as conn:
            conn.execute(text("""
                DO $$ BEGIN
                    ALTER TABLE recommender.recommender_projects ADD COLUMN owner_id INTEGER;
                EXCEPTION WHEN duplicate_column THEN NULL;
                END $$;
            """))
            conn.commit()