import { apiFetch } from '../utils/apiFetch';

const API = 'http://localhost:5000/api/alert-rules';

export async function getAlertRules() {
  const res = await apiFetch(API);
  return await res.json();
}

export async function updateAlertRule(id, data) {
  const res = await apiFetch(`${API}/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });

  return await res.json();
}