// Centralized fetch wrapper.
// - Automatically attaches the JWT (if present) to every request.
// - On a 401 response, clears the stale token and redirects to /login.
//
// Usage is identical to the native fetch():
//   const res = await apiFetch('http://localhost:5000/api/alerts')

export async function apiFetch(url, options = {}) {
  const token = localStorage.getItem('token');

  const headers = {
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    localStorage.removeItem('token');

    // Avoid redirect loop if we're already on the login page
    if (window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  }

  return res;
}