// Central place for backend URLs.
//
// VITE_API_URL
//   not set  -> http://localhost:5000 (local development)
//   empty    -> same origin as the page (production behind a reverse proxy)
//   a URL    -> that backend, e.g. https://api.example.com
//
// VITE_WS_URL (optional) overrides the WebSocket URL. When omitted it is
// derived from the API URL (http -> ws, https -> wss) or, for same-origin
// setups, from the page itself.
//
// Note: VITE_* values are bundled into the public JavaScript. Never put
// secrets in them.

const envApiUrl = import.meta.env.VITE_API_URL;
const envWsUrl = import.meta.env.VITE_WS_URL;

export const API_BASE_URL = (envApiUrl ?? 'http://localhost:5000').replace(/\/+$/, '');

// Absolute URL users should give to agents (never empty, even when same-origin)
export const PUBLIC_API_URL = API_BASE_URL || window.location.origin;

function deriveWsUrl() {
  if (API_BASE_URL) {
    return API_BASE_URL.replace(/^http/, 'ws');
  }

  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.host}/ws`;
}

export const WS_URL = (envWsUrl || deriveWsUrl()).replace(/\/+$/, '');