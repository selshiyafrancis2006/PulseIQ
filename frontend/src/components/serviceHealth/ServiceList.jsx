import ServiceCard from "./ServiceCard";
import EmptyState from "./EmptyState";

export default function ServiceList({ services }) {
  if (!services || services.length === 0) {
    return (
      <EmptyState
        title="No Services Found"
        description="There are no services available. Try adjusting your filters or add a new service."
      />
    );
  }

  return (
    <div className="grid gap-5">
      {services.map((service) => (
        <ServiceCard
          key={service.id}
          service={service}
        />
      ))}
    </div>
  );
}