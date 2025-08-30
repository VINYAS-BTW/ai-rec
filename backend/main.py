from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import joblib
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity
from sentence_transformers import SentenceTransformer

# Load saved data
data = joblib.load("music_recommender.pkl")
tracks = data["tracks"]
track_embeddings = data["track_embeddings"]

# Load embedding model
model = SentenceTransformer('all-MiniLM-L6-v2')

# FastAPI app
app = FastAPI()

# Enable CORS so frontend (Vite) can call it
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # or restrict to ["http://localhost:5173"] for vite
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request schema
class QueryRequest(BaseModel):
    text: str
    k: int = 5

@app.post("/recommend")
def recommend(req: QueryRequest):
    # Embed query
    query_emb = model.encode([req.text], normalize_embeddings=True)
    sims = cosine_similarity(query_emb, track_embeddings)[0]
    idxs = np.argsort(-sims)[:req.k]

    # Prepare results
    results = tracks.iloc[idxs][["track_name"]].to_dict(orient="records")
    return {"query": req.text, "recommendations": results}
