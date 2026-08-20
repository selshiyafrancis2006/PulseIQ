import { getServiceHealth } from "../services/serviceHealth.service.js";

export async function getServiceHealthController(req, res) {
  try {
    const data = await getServiceHealth();

    res.status(200).json(data);
  } catch (error) {
    console.error("Service Health Error:", error);

    res.status(500).json({
      message: "Failed to fetch service health.",
    });
  }
}