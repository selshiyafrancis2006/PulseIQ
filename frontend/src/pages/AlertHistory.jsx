import { useEffect, useState } from "react";
import { apiFetch } from "../utils/apiFetch";
import { API_BASE_URL } from "../config/api";
import AlertList from "../components/alerts/AlertList";
import AlertSummary from "../components/alerts/AlertSummary";
import AlertFilters from "../components/alerts/AlertFilters";

export default function AlertHistory() {

  const [alerts, setAlerts] = useState([]);
  const [filter, setFilter] = useState("all");


  useEffect(() => {

    const fetchAlerts = async () => {

      try {

        const res = await apiFetch(
          `${API_BASE_URL}/api/alerts`
        );

        const data = await res.json();

        setAlerts(data);

      } catch (error) {

        console.error("Failed to fetch alerts", error);

      }

    };


    fetchAlerts();

    const interval = setInterval(fetchAlerts, 10000);

    return () => clearInterval(interval);


  }, []);



  const filteredAlerts =
    filter === "all"
      ? alerts
      : alerts.filter(
          alert =>
            alert.severity.toLowerCase() === filter
        );



  return (

    <div className="text-white">


      <h1 className="text-3xl font-bold mb-1">
        Alert History
      </h1>


      <p className="text-gray-400 mb-6">
        Monitor system anomalies and triggered alerts
      </p>

      <AlertSummary alerts={alerts}/>

     <AlertFilters
  filter={filter}
  setFilter={setFilter}
/>

      <AlertList alerts={filteredAlerts}/>


    </div>

  );

}