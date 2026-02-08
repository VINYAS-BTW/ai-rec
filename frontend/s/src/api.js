// All app data goes through the backend API only. The frontend never talks to the database (Neon or any DB) directly.
export const API_BACKEND = import.meta.env.VITE_API_BACKEND || "http://localhost:8000"; // FastAPI (ML backend) — only place that uses Neon/DB
export const API_WEBHOOK = "http://localhost:3001"; // Node.js (webhook microservice)
export const API_AUTH = import.meta.env.VITE_AUTH_API_URL || "http://localhost:8080"; // Auth service

/** Headers for authenticated requests to the ML backend (JWT from auth service). */
export function getBackendAuthHeaders() {
  const token = typeof localStorage !== "undefined" ? localStorage.getItem("token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
