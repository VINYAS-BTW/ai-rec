// All app data goes through the backend API only. Build-time env (VITE_*) used for production deploy.
export const API_BACKEND =
  import.meta.env.VITE_ML_API_URL || import.meta.env.VITE_API_BACKEND || "http://localhost:8000";
export const API_WEBHOOK =
  import.meta.env.VITE_WEBHOOK_API_URL || "http://localhost:3001";
export const API_AUTH =
  import.meta.env.VITE_AUTH_API_URL || "http://localhost:8080";

/** Headers for authenticated requests to the ML backend (JWT from auth service). */
export function getBackendAuthHeaders() {
  const token = typeof localStorage !== "undefined" ? localStorage.getItem("token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
