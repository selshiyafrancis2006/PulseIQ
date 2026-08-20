export default function AlertSummary({ alerts }) {


  const activeAlerts =
    alerts.filter(
      alert =>
        alert.current_value > alert.threshold_value
    ).length;


  const warnings =
    alerts.filter(
      alert =>
        (alert.severity || "").toLowerCase() === "warning"
    ).length;


  const critical =
    alerts.filter(
      alert =>
        (alert.severity || "").toLowerCase() === "critical"
    ).length;



  return (

    <div className="grid grid-cols-4 gap-4 mb-6">


      <div className="bg-[#0f0f0f] border border-[#2a2a2a] rounded-xl p-4">

        <p className="text-gray-500 text-sm">
          Total Alerts
        </p>

        <h2 className="text-2xl font-bold">
          {alerts.length}
        </h2>

      </div>



      <div className="bg-[#0f0f0f] border border-[#2a2a2a] rounded-xl p-4">

        <p className="text-gray-500 text-sm">
          Active Alerts
        </p>

        <h2 className="text-2xl font-bold">
          {activeAlerts}
        </h2>

      </div>



      <div className="bg-[#0f0f0f] border border-[#2a2a2a] rounded-xl p-4">

        <p className="text-gray-500 text-sm">
          Warnings
        </p>

        <h2 className="text-2xl font-bold">
          {warnings}
        </h2>

      </div>



      <div className="bg-[#0f0f0f] border border-[#2a2a2a] rounded-xl p-4">

        <p className="text-gray-500 text-sm">
          Critical
        </p>

        <h2 className="text-2xl font-bold">
          {critical}
        </h2>

      </div>


    </div>

  );

}