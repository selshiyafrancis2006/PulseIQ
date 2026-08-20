import axios from "axios";

const API_URL = "http://localhost:5000/api/service-health";

export async function getServiceHealth() {
  const { data } = await axios.get(API_URL);
  return data;
}

export async function getServiceHealthSummary() {
  const { data } = await axios.get(`${API_URL}/summary`);
  return data;
}

export async function getServiceHealthById(id) {
  const { data } = await axios.get(`${API_URL}/${id}`);
  return data;
}

export async function getServiceHealthHistory(id) {
  const { data } = await axios.get(`${API_URL}/${id}/history`);
  return data;
}