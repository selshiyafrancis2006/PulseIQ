import { useMemo, useState } from "react";

import useServiceHealth from "../hooks/useServiceHealth";

import ServiceHealthSummary from "../components/serviceHealth/ServiceHealthSummary";
import ServiceHealthToolbar from "../components/serviceHealth/ServiceHealthToolbar";
import ServiceList from "../components/serviceHealth/ServiceList";
import ServiceSkeleton from "../components/serviceHealth/ServiceSkeleton";

export default function ServiceHealth() {
  const {
    services,
    summary,
    loading,
    error,
    refresh,
  } = useServiceHealth();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  const filteredServices = useMemo(() => {
    return services.filter((service) => {
      const matchesSearch = service.name
        .toLowerCase()
        .includes(search.toLowerCase());

      const matchesStatus =
        statusFilter === "All" ||
        service.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [services, search, statusFilter]);

  if (error) {
    return (
      <div className="text-red-400 text-center py-10">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6 text-white">

      {/* Header */}

      <div>
        <h1 className="text-3xl font-bold">
          Service Health
        </h1>

        <p className="text-gray-400 mt-1">
          Monitor the health and availability of all backend services.
        </p>
      </div>

      {/* Summary */}

      <ServiceHealthSummary
        totalServices={summary.totalServices}
        healthyServices={summary.healthyServices}
        degradedServices={summary.degradedServices}
        downServices={summary.downServices}
        overallHealth={summary.overallHealth}
      />

      {/* Toolbar */}

      <ServiceHealthToolbar
        search={search}
        setSearch={setSearch}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        onRefresh={refresh}
      />

      {/* Content */}

      {loading ? (
        <div className="space-y-5">
          {[...Array(4)].map((_, index) => (
            <ServiceSkeleton key={index} />
          ))}
        </div>
      ) : (
        <ServiceList services={filteredServices} />
      )}

    </div>
  );
}