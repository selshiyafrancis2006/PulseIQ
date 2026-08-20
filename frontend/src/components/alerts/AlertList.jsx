import AlertCard from "./AlertCard";


export default function AlertList({ alerts }) {


  return (

    <div className="space-y-4">

      {
        alerts.map(alert => (

          <AlertCard
            key={alert.id}
            alert={alert}
          />

        ))
      }

    </div>

  );

}