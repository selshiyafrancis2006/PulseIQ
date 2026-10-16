import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiFetch } from '../utils/apiFetch';
import { API_BASE_URL } from '../config/api';
import MetricsChart from '../components/metrics/MetricsChart';
import {
  getHostStatus,
  STATUS_META,
  timeAgo,
  formatUptime,
  formatMemory,
  formatRate,
} from '../utils/hostStatus';

function InfoCard({ title, children }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#2a2a2a] bg-[#0d0d0d]">
      <div className="border-b border-[#2a2a2a] bg-[#141414] px-5 py-3">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>
      <dl className="divide-y divide-[#1f1f1f]">{children}</dl>
    </div>
  );
}

function InfoRow({ label, value, mono = false, valueClassName = '' }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-3">
      <dt className="shrink-0 text-sm text-gray-200">{label}</dt>

      <dd
        className={`min-w-0 break-words text-right text-sm font-medium ${
          valueClassName || 'text-white'
        } ${mono ? 'font-mono' : ''}`}
      >
        {value || '—'}
      </dd>
    </div>
  );
}

function KpiCard({ label, value, online }) {
  return (
    <div className="rounded-xl border border-emerald-500/20 bg-[#0d0d0d] p-5 shadow-[0_0_20px_rgba(16,185,129,0.04)]">
      <p className="text-sm font-medium text-gray-400">{label}</p>

      <p className="mt-2 text-3xl font-semibold text-emerald-400">
        {value}
      </p>

      <p className="mt-1 text-xs text-gray-500">
        {online ? 'Current' : 'Last known'}
      </p>
    </div>
  );
}

function percent(value) {
  return value != null ? `${Number(value).toFixed(1)}%` : '—';
}

export default function HostDetails() {
  const { id } = useParams();
  const [host, setHost] = useState(null);
  const currentHostIdRef = useRef(Number(id));
  currentHostIdRef.current = Number(id);

  const [metrics, setMetrics] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [hasMoreAlerts, setHasMoreAlerts] = useState(true);
  const [loadingMoreAlerts, setLoadingMoreAlerts] = useState(false);
  const [timeRange, setTimeRange] = useState('1h');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

if (host?.id !== Number(id)) {
  setAlerts([]);
  setHasMoreAlerts(true);
  setLoadingMoreAlerts(false);
}

    const fetchHost = async () => {
      try {
        const hostResponse = await apiFetch(
          `${API_BASE_URL}/api/hosts/${id}`
        );

        if (!hostResponse.ok) {
          throw new Error('Failed to fetch host');
        }

        const hostData = await hostResponse.json();

        const metricsResponse = await apiFetch(
          `${API_BASE_URL}/api/metrics?range=${timeRange}&host_id=${id}`
        );

        const metricsData = metricsResponse.ok
          ? await metricsResponse.json()
          : [];

const alertsResponse = await apiFetch(
  `${API_BASE_URL}/api/alerts?host_id=${id}&limit=20&offset=0`
);

const alertsData = alertsResponse.ok
  ? await alertsResponse.json()
  : [];

if (!active || Number(id) !== currentHostIdRef.current) return;

setHost(hostData);
setMetrics(Array.isArray(metricsData) ? metricsData : []);
setAlerts((previous) => {
  const latest = Array.isArray(alertsData) ? alertsData : [];
  const latestIds = new Set(latest.map((alert) => alert.id));

  return [
    ...latest,
    ...previous.filter((alert) => !latestIds.has(alert.id)),
  ];
});
setHasMoreAlerts(Array.isArray(alertsData) && alertsData.length === 20);
      } catch (error) {
        console.error('Failed to fetch host:', error);
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchHost();

    const interval = setInterval(() => {
      if (!document.hidden) fetchHost();
    }, 5000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [id, timeRange]);


  const loadMoreAlerts = async () => {
    const requestedHostId = Number(id);

    if (loadingMoreAlerts || !hasMoreAlerts) return;

    setLoadingMoreAlerts(true);

    try {
      const response = await apiFetch(
        `${API_BASE_URL}/api/alerts?host_id=${requestedHostId}&limit=20&offset=${alerts.length}`
      );

      if (!response.ok) {
        throw new Error('Failed to load older alerts');
      }

      const olderAlerts = await response.json();

      if (requestedHostId !== currentHostIdRef.current) return;
      if (!Array.isArray(olderAlerts)) return;

      setAlerts((previous) => {
        const existingIds = new Set(previous.map((alert) => alert.id));
        const newAlerts = olderAlerts.filter(
          (alert) => !existingIds.has(alert.id)
        );

        return [...previous, ...newAlerts];
      });

      setHasMoreAlerts(olderAlerts.length === 20);
    } catch (error) {
      console.error('Failed to load older alerts:', error);
    } finally {
      if (requestedHostId === currentHostIdRef.current) {
        setLoadingMoreAlerts(false);
      }
    }
  };

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

    const status = getHostStatus(host);
  const meta = STATUS_META[status];
  const online = status === 'online';

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

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold">
            {host.name}
          </h1>

          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${meta.badge}`}
          >
            ● {meta.label.toUpperCase()}
          </span>

          <span className="text-sm text-gray-500">
            Last seen {timeAgo(host.last_seen_at)}
          </span>
        </div>

        {host.tags && host.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {host.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-[#2a2a2a] bg-[#0f0f0f] px-2 py-0.5 text-xs text-gray-300"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* SYSTEM INFO */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-white">
          System info
        </h2>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">

          <InfoCard title="Host">
            <InfoRow label="Hostname" value={host.hostname} />
            <InfoRow label="IP address" value={host.ip_address} mono />
            <InfoRow label="Operating system" value={host.os} />
            <InfoRow
              label="Platform / Arch"
              value={
                host.platform || host.arch
                  ? [host.platform, host.arch].filter(Boolean).join(' / ')
                  : null
              }
            />
          </InfoCard>

          <InfoCard title="Hardware">
            <InfoRow label="CPU" value={host.cpu_model} />
            <InfoRow
              label="Cores"
              value={host.cpu_cores != null ? String(host.cpu_cores) : null}
            />
            <InfoRow
              label="Memory"
              value={
                host.total_memory_mb != null
                  ? formatMemory(host.total_memory_mb)
                  : null
              }
            />
          </InfoCard>

          <InfoCard title="Agent">
            <InfoRow
              label="Agent version"
              value={host.agent_version}
              mono
            />
                        <InfoRow
              label="Uptime"
              value={
                online
                  ? formatUptime(host.boot_time)
                  : status === 'pending'
                    ? 'Waiting for first heartbeat'
                    : 'Offline'
              }
              valueClassName={status === 'offline' ? 'text-red-400' : ''}
            />
            <InfoRow
              label="Registered"
              value={
                host.created_at
                  ? new Date(host.created_at).toLocaleDateString()
                  : null
              }
            />
          </InfoCard>

        </div>

        {!host.hostname && !host.os && (
          <p className="mt-3 text-sm text-gray-200">
            No system info yet. It appears once the agent reports in.
          </p>
        )}
      </div>


{/* HEALTH & ALERTS */}
<div>
  <div className="mb-4 flex items-center justify-between">
    <h2 className="text-lg font-semibold text-white">
      Health & Alerts
    </h2>

    <span className="text-sm text-gray-400">
      {alerts.length} alert{alerts.length !== 1 ? 's' : ''}
    </span>
  </div>

  {alerts.length === 0 && (
    <div className="rounded-xl border border-[#2a2a2a] bg-[#0d0d0d] p-5 text-sm text-gray-400">
      No recent alerts for this host.
    </div>
  )}

  {alerts.length > 0 && (
    <div className="space-y-2">

{alerts.map((alert) => {
  const isOfflineAlert = alert.metric_name === 'host_offline';
  const isRecoveredAlert = alert.metric_name === 'host_recovered';

  return (
    <div
      key={alert.id}
      className="flex items-center justify-between gap-4 rounded-xl border border-[#2a2a2a] bg-[#0d0d0d] px-5 py-4"
    >
      <div>
        <p className="text-sm font-medium text-white">
          {isOfflineAlert
            ? 'HOST OFFLINE'
            : isRecoveredAlert
              ? 'HOST RECOVERED'
              : alert.metric_name}
        </p>

        {isOfflineAlert ? (
          <p className="mt-1 text-xs text-red-400">
            No recent heartbeat was received; the host
            was detected as offline at this time.
          </p>
        ) : isRecoveredAlert ? (
          <p className="mt-1 text-xs text-emerald-400">
            The host resumed sending heartbeats and was detected as recovered.
          </p>
        ) : (
          <p className="mt-1 text-xs text-gray-500">
            Current: {Number(alert.current_value).toFixed(1)}%
            {' · '}
            Threshold: {Number(alert.threshold_value).toFixed(1)}%
          </p>
        )}
      </div>

      <span
        className={`rounded-full px-3 py-1 text-xs font-medium ${
          isOfflineAlert
            ? 'bg-red-500/10 text-red-400'
            : isRecoveredAlert
              ? 'bg-emerald-500/10 text-emerald-400'
              : alert.severity === 'Critical'
                ? 'bg-red-500/10 text-red-400'
                : alert.severity === 'Warning'
                  ? 'bg-yellow-500/10 text-yellow-400'
                  : 'bg-gray-500/10 text-gray-400'
        }`}
      >
        {isRecoveredAlert ? 'Recovered' : alert.severity}
      </span>
    </div>
  );
})}
    </div>
  )}

  {hasMoreAlerts && alerts.length > 0 && (
    <div className="mt-4 flex justify-center">
      <button
        onClick={loadMoreAlerts}
        disabled={loadingMoreAlerts}
        className="rounded-lg border border-[#2a2a2a] px-4 py-2 text-sm text-gray-300 transition hover:border-emerald-500/50 hover:text-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loadingMoreAlerts ? 'Loading older alerts...' : 'Load More Alerts'}
      </button>
    </div>
  )}
</div>

<div className="mb-4 flex justify-end">

  <div className="flex rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] p-1">
    {['1h', '6h', '24h'].map((range) => (
      <button
        key={range}
        onClick={() => setTimeRange(range)}
        className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
          timeRange === range
            ? 'bg-emerald-500/10 text-emerald-400'
            : 'text-gray-400 hover:text-white'
        }`}
      >
        {range.toUpperCase()}
      </button>
    ))}
  </div>
</div>


      {/* HOST METRICS */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
       <KpiCard
  label="CPU"
  value={percent(host.cpu_usage)}
  online={online}
/>

<KpiCard
  label="Memory"
  value={percent(host.memory_usage)}
  online={online}
/>

<KpiCard
  label="Disk"
  value={percent(host.disk_usage)}
  online={online}
/>

<KpiCard
  label="Network In"
  value={formatRate(host.network_in)}
  online={online}
/>

<KpiCard
  label="Network Out"
  value={formatRate(host.network_out)}
  online={online}
/>
      </div>

      <MetricsChart
  metrics={metrics}
  selectedMetrics={['cpu_usage']}
  timeRange={timeRange}
/>

      <MetricsChart
  metrics={metrics}
  selectedMetrics={['memory_usage']}
  timeRange={timeRange}
/>

      <MetricsChart
  metrics={metrics}
  selectedMetrics={['disk_usage']}
  timeRange={timeRange}
/>

    </div>
  );
}