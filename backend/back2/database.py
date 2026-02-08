import os
from sqlalchemy import create_engine, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

from dotenv import load_dotenv

# Load .env from this file's directory so it works no matter where you run uvicorn from
_this_dir = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_this_dir, ".env"))

DATABASE_URL = (os.getenv("DATABASE_URL") or "postgresql://localhost:5432/neondb").strip()
if not DATABASE_URL or DATABASE_URL == "postgresql://localhost:5432/neondb":
    import sys
    print("WARNING: DATABASE_URL not set or default. Put DATABASE_URL=postgresql://... in backend/back2/.env", file=sys.stderr)

# PostgreSQL/Neon only. Frontend never connects to the DB — it only calls this API.
engine = create_engine(DATABASE_URL)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """
    FastAPI dependency to get a database session.
    Yields a session and closes it after the request.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_db_and_tables():
    """
    Create all tables in the database. Called on app startup.
    Requires PostgreSQL (e.g. Neon).
    """
    with engine.connect() as conn:
        conn.execute(text("CREATE SCHEMA IF NOT EXISTS recommender"))
        conn.commit()
    Base.metadata.create_all(bind=engine)
    with engine.connect() as conn:
        conn.execute(text("""
            DO $$ BEGIN
                ALTER TABLE recommender.recommender_projects ADD COLUMN owner_id INTEGER;
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$;
        """))
        conn.commit()
