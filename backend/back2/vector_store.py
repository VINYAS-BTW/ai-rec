"""
Per-project FAISS vector store.

One ProjectVectorStore is created per recommender project.  Two separate
indexes are maintained:
  - items : row i holds the embedding for the i-th item_id
  - users : row i holds the embedding for the i-th user_id

Index files live on disk next to the MLflow model:
  project_models/project_{id}/vector_index/{items|users}.{index|meta.pkl}

FAISS is optional.  If not installed the store silently degrades: all
search methods return empty lists and callers can check FAISS_AVAILABLE.
"""
from __future__ import annotations

import os
import pickle
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

try:
    import faiss  # type: ignore
    FAISS_AVAILABLE = True
except ImportError:
    faiss = None  # type: ignore
    FAISS_AVAILABLE = False


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def to_dense_for_index(mat: Any, max_dim: int = 128) -> Optional[np.ndarray]:
    """
    Convert a sparse or dense matrix to a float32 numpy array suitable for
    FAISS indexing.  Reduces dimensionality via TruncatedSVD if the matrix
    has more than *max_dim* columns.  Returns None on any failure.
    """
    try:
        from scipy.sparse import issparse  # type: ignore
        if issparse(mat):
            mat = mat.toarray()
        mat = np.asarray(mat, dtype=np.float32)
        mat = np.nan_to_num(mat, nan=0.0, posinf=0.0, neginf=0.0)
        if mat.ndim == 1:
            mat = mat.reshape(1, -1)
        if mat.shape[0] == 0 or mat.shape[1] == 0:
            return None
        if mat.shape[1] > max_dim:
            n_comp = min(max_dim, mat.shape[0] - 1, mat.shape[1] - 1)
            if n_comp < 2:
                return mat[:, :max_dim]
            from sklearn.decomposition import TruncatedSVD  # type: ignore
            mat = TruncatedSVD(n_components=n_comp, random_state=42).fit_transform(mat).astype("float32")
        return mat
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Per-project store
# ---------------------------------------------------------------------------

class ProjectVectorStore:
    """
    Manages two FAISS indexes (items + users) for a single project.

    Usage
    -----
    vstore = ProjectVectorStore("/path/to/project_N/vector_index")
    vstore.build_items_index(ids, vectors)          # call once after training
    results = vstore.search_similar_items("item_42", k=10)
    """

    def __init__(self, index_dir: str) -> None:
        self.index_dir = index_dir
        os.makedirs(index_dir, exist_ok=True)
        self._items_index: Any = None
        self._items_ids: List[str] = []
        self._users_index: Any = None
        self._users_ids: List[str] = []

    # ------------------------------------------------------------------
    # Build
    # ------------------------------------------------------------------

    def build_items_index(self, ids: List[Any], vectors: np.ndarray) -> bool:
        """
        Build an inner-product (cosine) FAISS index from *vectors* and persist
        it to disk.  Vectors are L2-normalised before insertion so that
        inner-product search is equivalent to cosine similarity.
        Returns True if successful, False if FAISS unavailable or on error.
        """
        return self._build("items", ids, vectors)

    def build_users_index(self, ids: List[Any], vectors: np.ndarray) -> bool:
        """Same as build_items_index but for user embeddings."""
        return self._build("users", ids, vectors)

    def _build(self, kind: str, ids: List[Any], vectors: np.ndarray) -> bool:
        if not FAISS_AVAILABLE:
            return False
        try:
            vectors = np.asarray(vectors, dtype="float32")
            if vectors.ndim == 1:
                vectors = vectors.reshape(1, -1)
            if vectors.shape[0] == 0:
                return False
            faiss.normalize_L2(vectors)
            dim = vectors.shape[1]
            index = faiss.IndexFlatIP(dim)
            index.add(vectors)
            id_list = [str(i) for i in ids]
            faiss.write_index(index, self._index_path(kind))
            with open(self._meta_path(kind), "wb") as fh:
                pickle.dump(id_list, fh)
            if kind == "items":
                self._items_index = index
                self._items_ids = id_list
            else:
                self._users_index = index
                self._users_ids = id_list
            return True
        except Exception as exc:
            print(f"[VectorStore] build_{kind}: {exc}")
            return False

    # ------------------------------------------------------------------
    # Search by id
    # ------------------------------------------------------------------

    def search_similar_items(
        self,
        item_id: str,
        k: int = 10,
        exclude_self: bool = True,
    ) -> List[Dict[str, Any]]:
        """
        Return up to *k* items most similar to *item_id*.
        Each result: {"item_id": str, "score": float}
        """
        vec = self.get_item_vector(item_id)
        if vec is None:
            return []
        exclude = {str(item_id)} if exclude_self else set()
        return self._search("items", vec, k, exclude_ids=exclude)

    def search_similar_users(
        self,
        user_id: str,
        k: int = 10,
        exclude_self: bool = True,
    ) -> List[Dict[str, Any]]:
        """
        Return up to *k* users most similar to *user_id*.
        Each result: {"user_id": str, "score": float}
        """
        vec = self.get_user_vector(user_id)
        if vec is None:
            return []
        exclude = {str(user_id)} if exclude_self else set()
        return self._search("users", vec, k, exclude_ids=exclude)

    def _search(
        self,
        kind: str,
        vector: np.ndarray,
        k: int,
        exclude_ids: Optional[set] = None,
    ) -> List[Dict[str, Any]]:
        index, ids = self._load_and_get(kind)
        if index is None or not ids:
            return []
        try:
            q = np.asarray(vector, dtype="float32").reshape(1, -1)
            faiss.normalize_L2(q)
            fetch_k = k + len(exclude_ids or set()) + 1
            scores, indices = index.search(q, min(fetch_k, index.ntotal))
            key_name = "item_id" if kind == "items" else "user_id"
            results: List[Dict[str, Any]] = []
            for score, idx in zip(scores[0], indices[0]):
                if idx < 0 or idx >= len(ids):
                    continue
                eid = ids[idx]
                if (exclude_ids or set()) and eid in exclude_ids:
                    continue
                results.append({key_name: eid, "score": float(score)})
                if len(results) >= k:
                    break
            return results
        except Exception as exc:
            print(f"[VectorStore] search_{kind}: {exc}")
            return []

    # ------------------------------------------------------------------
    # Get single vector
    # ------------------------------------------------------------------

    def get_item_vector(self, item_id: str) -> Optional[np.ndarray]:
        return self._get_vector("items", str(item_id))

    def get_user_vector(self, user_id: str) -> Optional[np.ndarray]:
        return self._get_vector("users", str(user_id))

    def _get_vector(self, kind: str, eid: str) -> Optional[np.ndarray]:
        if not FAISS_AVAILABLE:
            return None
        index, ids = self._load_and_get(kind)
        if index is None or not ids:
            return None
        try:
            idx = ids.index(eid)
            vec = np.zeros(index.d, dtype="float32")
            index.reconstruct(idx, vec)
            return vec
        except (ValueError, Exception):
            return None

    # ------------------------------------------------------------------
    # Status
    # ------------------------------------------------------------------

    @property
    def items_count(self) -> int:
        index, _ = self._load_and_get("items")
        return index.ntotal if index is not None else 0

    @property
    def users_count(self) -> int:
        index, _ = self._load_and_get("users")
        return index.ntotal if index is not None else 0

    def status(self) -> Dict[str, Any]:
        return {
            "faiss_available": FAISS_AVAILABLE,
            "index_dir": self.index_dir,
            "items_indexed": self.items_count,
            "users_indexed": self.users_count,
            "items_index_on_disk": os.path.isfile(self._index_path("items")),
            "users_index_on_disk": os.path.isfile(self._index_path("users")),
        }

    # ------------------------------------------------------------------
    # Persistence helpers
    # ------------------------------------------------------------------

    def _index_path(self, kind: str) -> str:
        return os.path.join(self.index_dir, f"{kind}.index")

    def _meta_path(self, kind: str) -> str:
        return os.path.join(self.index_dir, f"{kind}.meta.pkl")

    def _load_and_get(self, kind: str) -> Tuple[Any, List[str]]:
        """Return (index, ids), loading from disk if needed."""
        if kind == "items":
            if self._items_index is None:
                self._load(kind)
            return self._items_index, self._items_ids
        else:
            if self._users_index is None:
                self._load(kind)
            return self._users_index, self._users_ids

    def _load(self, kind: str) -> None:
        if not FAISS_AVAILABLE:
            return
        ipath = self._index_path(kind)
        mpath = self._meta_path(kind)
        if not os.path.isfile(ipath) or not os.path.isfile(mpath):
            return
        try:
            index = faiss.read_index(ipath)
            with open(mpath, "rb") as fh:
                ids = pickle.load(fh)
            if kind == "items":
                self._items_index = index
                self._items_ids = ids
            else:
                self._users_index = index
                self._users_ids = ids
        except Exception as exc:
            print(f"[VectorStore] load_{kind}: {exc}")


# ---------------------------------------------------------------------------
# Registry: keep one store instance per project in-process
# ---------------------------------------------------------------------------

_registry: Dict[int, ProjectVectorStore] = {}


def get_vector_store(project_id: int, models_dir: str) -> ProjectVectorStore:
    """Return (or create) the singleton ProjectVectorStore for a project."""
    if project_id not in _registry:
        vec_dir = os.path.join(models_dir, f"project_{project_id}", "vector_index")
        _registry[project_id] = ProjectVectorStore(vec_dir)
    return _registry[project_id]


def evict_vector_store(project_id: int) -> None:
    """Remove a project from the in-process cache (call on project delete/retrain)."""
    _registry.pop(project_id, None)
