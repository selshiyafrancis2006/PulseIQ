// Central place for the backend URL.
// Change VITE_API_URL / VITE_WS_URL in frontend/.env to point somewhere else
// (e.g. a deployed backend) instead of editing URLs across the codebase.

export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
export const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:5000';