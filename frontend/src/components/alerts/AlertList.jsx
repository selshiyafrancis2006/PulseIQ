import AlertCard from "./AlertCard";


export default function AlertList({ alerts, onAcknowledge, acknowledgingIds = [], acknowledgementErrors = {} }) {


  return (

    <div className="space-y-4">

      {
        alerts.map(alert => (

          <AlertCard
            key={alert.id}
            alert={alert}
            onAcknowledge={onAcknowledge}
            isAcknowledging={acknowledgingIds.includes(alert.id)}
            acknowledgementError={acknowledgementErrors[alert.id]}
          />

        ))
      }

    </div>

  );

}