import { apiFetch } from '../utils/apiFetch';
import { API_BASE_URL } from '../config/api';

const API = `${API_BASE_URL}/api/alert-rules`;

async function parseResponse(res) {
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || 'Alert rule request failed');
  }

  return data;
}

export async function getAlertRules() {
  const res = await apiFetch(API);
  return parseResponse(res);
}

export async function createAlertRule(data) {
  const res = await apiFetch(API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });

  return parseResponse(res);
}

export async function updateAlertRule(id, data) {
  const res = await apiFetch(`${API}/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });

  return parseResponse(res);
}

export async function deleteAlertRule(id) {
  const res = await apiFetch(`${API}/${id}`, {
    method: 'DELETE'
  });

  return parseResponse(res);
}
