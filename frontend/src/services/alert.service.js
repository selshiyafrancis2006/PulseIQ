import { apiFetch } from '../utils/apiFetch';
import { API_BASE_URL } from '../config/api';

const API = `${API_BASE_URL}/api/alert-rules`;

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