// Base URL of the FraudLens FastAPI backend (backend/main.py).
//
// Vite inlines import.meta.env values at build time, so a deployed frontend
// points at its backend by setting VITE_API_BASE_URL during the build (e.g.
// `https://<backend-host>`); local dev keeps the backend on :8000 with no .env
// entry and falls back here. Every place the dashboard fetches the API reads
// this one constant so an override never has to be repeated.
export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'
