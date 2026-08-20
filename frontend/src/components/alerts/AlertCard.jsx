import { severityConfig } from "../../config/alertSeverity";


export default function AlertCard({ alert }) {


  const severity =
    severityConfig[
      (alert.severity || "info").toLowerCase()
    ] || severityConfig.info;



  return (

    <div
      className="
      border border-[#2a2a2a]
      bg-[#0f0f0f]
      rounded-xl
      p-5
      hover:border-[#444]
      transition
      "
    >


      <div className="flex justify-between">


        <div className="flex gap-3 items-center">


          <span
            className={`
            px-3 py-1
            rounded-full
            text-xs
            font-semibold
            ${severity.badge}
            `}
          >
            {severity.label}
          </span>



          <h3 className="font-semibold text-lg">

            {alert.metric_name
              ?.replace("_"," ")
              .toUpperCase()
            }

          </h3>


        </div>



        <span className="text-gray-500 text-xs">

          {new Date(alert.timestamp)
            .toLocaleString()
          }

        </span>


      </div>




      <div className="mt-4 grid grid-cols-3 gap-4">


        <div className="bg-[#151515] p-3 rounded-lg">

          <p className="text-gray-500 text-xs">
            Current Value
          </p>

          <p className="text-xl font-bold">
            {alert.current_value}
          </p>

        </div>



        <div className="bg-[#151515] p-3 rounded-lg">

          <p className="text-gray-500 text-xs">
            Threshold
          </p>

          <p className="text-xl font-bold">
            {alert.threshold_value}
          </p>

        </div>



        <div className="bg-[#151515] p-3 rounded-lg">

          <p className="text-gray-500 text-xs">
            Status
          </p>

          <p className="text-emerald-400 font-semibold">

            {
              alert.current_value > alert.threshold_value
              ? "Triggered"
              : "Resolved"
            }

          </p>

        </div>


      </div>


    </div>

  );

}