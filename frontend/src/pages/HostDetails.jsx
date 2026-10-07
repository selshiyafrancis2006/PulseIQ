import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiFetch } from '../utils/apiFetch';
import { API_BASE_URL } from '../config/api';
import MetricsChart from '../components/metrics/MetricsChart';

function isOnline(lastSeenAt) {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < 30000;
}

export default function HostDetails() {
  const { id } = useParams();
  const [host, setHost] = useState(null);
const [metrics, setMetrics] = useState([]);
const [loading, setLoading] = useState(true);

useEffect(() => {
  const fetchHost = async () => {
    try {
      const token = localStorage.getItem('token');

      const response = await fetch(
        `http://localhost:5000/api/hosts/${id}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch host');
      }

      const data = await response.json();
      setHost(data);

      const metricsResponse = await apiFetch(
        `${API_BASE_URL}/api/metrics?range=1h&host_id=${id}`
      );

      const metricsData = await metricsResponse.json();

      setMetrics(metricsData);
    } catch (error) {
      console.error('Failed to fetch host:', error);
    } finally {
      setLoading(false);
    }
  };

  fetchHost();

  const interval = setInterval(fetchHost, 5000);

  return () => clearInterval(interval);
}, [id]);

  if (loading) {
    return (
      <div className="p-6 text-gray-400">
        Loading host...
      </div>
    );
  }

  if (!host) {
    return (
      <div className="p-6 text-red-400">
        Host not found.
      </div>
    );
  }

  const online = isOnline(host.last_seen_at);

  return (
    <div className="space-y-8 p-6 text-white">

      {/* HEADER */}
      <div>
        <Link
          to="/hosts"
          className="text-sm text-gray-400 hover:text-white"
        >
          ← Hosts
        </Link>

        <div className="mt-4 flex items-center gap-3">
          <h1 className="text-3xl font-semibold">
            {host.name}
          </h1>

          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              online
                ? 'bg-emerald-500/10 text-emerald-400'
                : 'bg-red-500/10 text-red-400'
            }`}
          >
            ● {online ? 'ONLINE' : 'OFFLINE'}
          </span>
        </div>

        <p className="mt-2 text-sm text-gray-400">
          Host monitoring
        </p>
      </div>

      {/* CURRENT METRICS */}
<div className="grid grid-cols-1 gap-4 md:grid-cols-5">

  <div className="rounded-xl border border-emerald-500/20 bg-[#0d0d0d] p-5 shadow-[0_0_20px_rgba(16,185,129,0.04)]">
    <p className="text-sm font-medium text-gray-400">CPU</p>
    <p className="mt-2 text-3xl font-semibold text-emerald-400">
      {host.cpu_usage != null
        ? `${Number(host.cpu_usage).toFixed(1)}%`
        : '—'}
    </p>
  </div>

  <div className="rounded-xl border border-emerald-500/20 bg-[#0d0d0d] p-5 shadow-[0_0_20px_rgba(16,185,129,0.04)]">
    <p className="text-sm font-medium text-gray-400">Memory</p>
    <p className="mt-2 text-3xl font-semibold text-emerald-400">
      {host.memory_usage != null
        ? `${Number(host.memory_usage).toFixed(1)}%`
        : '—'}
    </p>
  </div>

  <div className="rounded-xl border border-emerald-500/20 bg-[#0d0d0d] p-5 shadow-[0_0_20px_rgba(16,185,129,0.04)]">
    <p className="text-sm font-medium text-gray-400">Disk</p>
    <p className="mt-2 text-3xl font-semibold text-emerald-400">
      {host.disk_usage != null
        ? `${Number(host.disk_usage).toFixed(1)}%`
        : '—'}
    </p>
  </div>
  <div className="rounded-xl border border-emerald-500/20 bg-[#0d0d0d] p-5 shadow-[0_0_20px_rgba(16,185,129,0.04)]">
  <p className="text-sm font-medium text-gray-400">Network In</p>
  <p className="mt-2 text-3xl font-semibold text-emerald-400">
    {host.network_in != null
  ? Number(host.network_in).toFixed(1)
  : '—'}
  </p>
</div>

<div className="rounded-xl border border-emerald-500/20 bg-[#0d0d0d] p-5 shadow-[0_0_20px_rgba(16,185,129,0.04)]">
  <p className="text-sm font-medium text-gray-400">Network Out</p>
<p className="mt-2 text-3xl font-semibold text-emerald-400">
  {host.network_out != null
    ? Number(host.network_out).toFixed(1)
    : '—'}
</p>
</div>

</div>
     <MetricsChart
  metrics={metrics}
  selectedMetrics={['cpu_usage']}
/>

<MetricsChart
  metrics={metrics}
  selectedMetrics={['memory_usage']}
/>

<MetricsChart
  metrics={metrics}
  selectedMetrics={['disk_usage']}
/>

    </div>
  );
}