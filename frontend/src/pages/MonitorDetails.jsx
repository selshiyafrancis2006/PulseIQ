import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiFetch } from '../utils/apiFetch';
import { API_BASE_URL } from '../config/api';

const RANGES = [
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
];

const formatDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
};

const formatTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatDuration = (milliseconds) => {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '—';

  const totalSeconds = Math.floor(milliseconds / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
};

function Panel({ title, subtitle, children, action }) {
  return (
    <section className="overflow-hidden rounded-xl border border-[#2a2a2a] bg-[#111]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#252525] px-5 py-4">
        <div>
          <h2 className="font-semibold text-white">{title}</h2>
          {subtitle && <p className="mt-1 text-xs text-gray-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function MetricCard({ label, value, note }) {
  return (
    <div className="rounded-xl border border-[#2a2a2a] bg-[#111] p-5">
      <p className="text-sm text-gray-400">{label}</p>
      <p className="mt-2 break-words text-2xl font-semibold text-white">{value}</p>
      {note && <p className="mt-1 text-xs text-gray-500">{note}</p>}
    </div>
  );
}

function StatusPill({ status }) {
  const styles = {
    UP: 'border-emerald-900 bg-emerald-950/40 text-emerald-400',
    DOWN: 'border-red-900 bg-red-950/40 text-red-400',
    PAUSED: 'border-[#444] bg-[#202020] text-gray-300',
    UNKNOWN: 'border-[#444] bg-[#202020] text-gray-400',
  };
  const label = status === 'UP' || status === 'DOWN' ? status : status === 'PAUSED' ? 'PAUSED' : 'UNKNOWN';

  return (
    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${styles[label]}`}>
      {label}
    </span>
  );
}

export default function MonitorDetails() {
  const { id } = useParams();
  const [monitor, setMonitor] = useState(null);
  const [history, setHistory] = useState([]);
  const [uptime, setUptime] = useState(null);
  const [events, setEvents] = useState([]);
  const [timeRange, setTimeRange] = useState('24h');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

 const fetchData = useCallback(async (showLoading = false, isActive = () => true) => {
    if (showLoading) setLoading(true);

    try {
const responses = await Promise.all([
  apiFetch(`${API_BASE_URL}/api/monitors/${id}`),
  apiFetch(`${API_BASE_URL}/api/monitors/status`),
  apiFetch(`${API_BASE_URL}/api/monitors/${id}/history?range=${timeRange}`),
  apiFetch(`${API_BASE_URL}/api/monitors/${id}/uptime?range=${timeRange}`),
  apiFetch(`${API_BASE_URL}/api/monitors/${id}/events`),
]);

      const failedResponse = responses.find((response) => !response.ok);
      if (failedResponse) {
        if (failedResponse.status === 404) {
          throw new Error('Monitor not found, or you do not have access to it.');
        }
        throw new Error('Unable to load monitor details. Please try again.');
      }

const [
  monitorData,
  monitorStatuses,
  historyData,
  uptimeData,
  eventsData,
] = await Promise.all(responses.map((response) => response.json()));

if (!isActive()) return;

const latestStatus = Array.isArray(monitorStatuses)
  ? monitorStatuses.find((item) => String(item.id) === String(id))
  : null;

setMonitor({
  ...monitorData,
  ...(latestStatus || {}),
});
      setHistory(Array.isArray(historyData) ? historyData.slice().reverse() : []);
      setUptime(uptimeData);
      setEvents(Array.isArray(eventsData) ? eventsData : []);
      setLastUpdated(new Date());
      setError('');
    } catch (err) {
      if (isActive()) {
  setError(err.message || 'Unable to load monitor details.');
}
    } finally {
      if (isActive()) {
  setLoading(false);
}
    }
  }, [id, timeRange]);

useEffect(() => {
  let active = true;

  const load = async (showLoading = false) => {
    if (!active) return;
    await fetchData(showLoading, () => active);
  };

  void load(true);

  const interval = setInterval(() => {
    void load(false);
  }, 30000);

  return () => {
    active = false;
    clearInterval(interval);
  };
}, [fetchData]);

  const validResponseTimes = history
    .filter((item) => item.response_time_ms != null && Number.isFinite(Number(item.response_time_ms)))
    .map((item) => Number(item.response_time_ms));

  const averageResponse = validResponseTimes.length
    ? Math.round(validResponseTimes.reduce((sum, value) => sum + value, 0) / validResponseTimes.length)
    : null;

  const chartData = history.map((item) => ({
    ...item,
    chartTime: formatTime(item.checked_at),
    response: item.response_time_ms == null ? null : Number(item.response_time_ms),
  }));

  const timingFields = [
    ['DNS', 'dns_time_ms'],
    ['Connection', 'connect_time_ms'],
    ['TLS', 'tls_time_ms'],
    ['TTFB', 'ttfb_time_ms'],
    ['Download', 'download_time_ms'],
  ];

  const timingAverages = timingFields.map(([label, field]) => {
    const values = history
      .filter((item) => item[field] != null && Number.isFinite(Number(item[field])))
      .map((item) => Number(item[field]));

    return {
      label,
      average: values.length
        ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
        : null,
      samples: values.length,
    };
  });

  const incidentTimeline = events
    .filter((event) => event.type === 'DOWN' || event.type === 'UP')
    .slice()
    .reverse()
    .reduce((incidents, event) => {
      if (event.type === 'DOWN') {
        incidents.push({
          ...event,
          recovery: null,
          duration: null,
        });
      } else {
        const lastIncident = incidents[incidents.length - 1];

        if (lastIncident && !lastIncident.recovery) {
          const duration =
            new Date(event.created_at).getTime() -
            new Date(lastIncident.created_at).getTime();

          if (Number.isFinite(duration) && duration >= 0) {
            lastIncident.recovery = event;
            lastIncident.duration = duration;
          }
        }
      }

      return incidents;
    }, [])
    .reverse();

  const status = monitor?.is_active === false
    ? 'PAUSED'
    : monitor?.status === 'UP' || monitor?.status === 'DOWN'
      ? monitor.status
      : 'UNKNOWN';

  if (loading && !monitor) {
    return (
      <div className="space-y-4 text-gray-400">
        <Link to="/uptime" className="text-sm hover:text-white">← Back to Uptime Monitoring</Link>
        <div className="rounded-xl border border-[#2a2a2a] bg-[#111] p-6">Loading monitor details...</div>
      </div>
    );
  }

  if (error && !monitor) {
    return (
      <div className="space-y-4">
        <Link to="/uptime" className="text-sm text-gray-400 hover:text-white">← Back to Uptime Monitoring</Link>
        <div role="alert" className="rounded-xl border border-red-900 bg-red-950/20 p-5 text-red-300">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void fetchData(true)}
            className="mt-3 rounded-md border border-red-900 px-3 py-2 text-sm hover:bg-red-950/40"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!monitor) return null;

  return (
    <div className="min-h-screen space-y-6 bg-[#0f0f0f] text-white">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/uptime" className="text-sm text-gray-400 hover:text-white">
            ← Back to Uptime Monitoring
          </Link>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold">{monitor.name}</h1>
            <StatusPill status={status} />
          </div>
          <p className="mt-2 break-all text-sm text-gray-400">{monitor.url}</p>
          {Array.isArray(monitor.tags) && monitor.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {monitor.tags.map((tag) => (
                <span key={tag} className="rounded-full border border-[#2a2a2a] bg-[#151515] px-2 py-1 text-xs text-gray-400">
                  {tag}
                </span>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-gray-600">
            {lastUpdated ? `Last updated ${lastUpdated.toLocaleTimeString()}` : 'Waiting for data'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="monitor-detail-range" className="text-sm text-gray-400">Time range</label>
          <select
            id="monitor-detail-range"
            value={timeRange}
            onChange={(event) => setTimeRange(event.target.value)}
            className="rounded-md border border-[#3a3a3a] bg-[#111] px-3 py-2 text-sm text-gray-200"
          >
            {RANGES.map((range) => (
              <option key={range.value} value={range.value}>Last {range.label}</option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-amber-900 bg-amber-950/20 p-3 text-sm text-amber-300">
          Refresh failed: {error}. Showing the last successfully loaded data.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">


<MetricCard
  label="Uptime"
  value={uptime?.uptime == null ? '-' : `${uptime.uptime}%`}
  note={
    !uptime
      ? 'No check data'
      : uptime.coverage === 'insufficient_data'
        ? `${uptime.up_checks} successful / ${uptime.total_checks} checks - incomplete coverage; percentage reflects recorded checks only`
        : `${uptime.up_checks} successful / ${uptime.total_checks} checks`
  }
/>

        <MetricCard
          label="Latest response"
          value={monitor.response_time_ms == null ? '—' : `${monitor.response_time_ms} ms`}
          note={monitor.checked_at ? `Checked ${formatDateTime(monitor.checked_at)}` : 'No check timestamp'}
        />
        <MetricCard
          label="Average response"
          value={averageResponse == null ? '—' : `${averageResponse} ms`}
          note={`${validResponseTimes.length} sampled measurements`}
        />
        <MetricCard
          label="Checks in range"
          value={uptime?.total_checks ?? '—'}
          note={uptime ? `${RANGES.find((range) => range.value === timeRange)?.label || timeRange}` : 'Waiting for data'}
        />
        <MetricCard
          label="SLO (30 days)"
          value={
            uptime?.slo?.status === 'insufficient_data'
              ? 'Insufficient data'
              : `${uptime.slo.target_percent}%`
          }
          note={
            uptime?.slo?.status === 'insufficient_data'
              ? 'More outage history is needed'
              : `${uptime.slo.observed_downtime_minutes} min downtime · ${uptime.slo.remaining_budget_minutes} min budget left`
          }
        />
      </div>

      <Panel
        title="Availability timeline"
        subtitle="Sampled historical checks; each segment represents a returned sample, not every individual check."
      >
        {history.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">No historical checks in this range.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex h-8 w-full gap-1 overflow-hidden">
              {history.map((item, index) => {
                const isUp = item.status === 'UP';
                const isDown = item.status === 'DOWN';
                const color = isUp ? 'bg-emerald-400' : isDown ? 'bg-red-500' : 'bg-gray-700';

                return (
                  <div
                    key={`${item.checked_at}-${index}`}
                    title={`${formatDateTime(item.checked_at)} — ${item.status || 'Unknown'}${item.response_time_ms == null ? '' : ` — ${item.response_time_ms} ms`}`}
                    className={`min-w-0 flex-1 rounded-sm ${color}`}
                  />
                );
              })}
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-gray-500">
              <span><span className="mr-2 inline-block h-2 w-2 rounded-sm bg-emerald-400" />UP</span>
              <span><span className="mr-2 inline-block h-2 w-2 rounded-sm bg-red-500" />DOWN</span>
              <span><span className="mr-2 inline-block h-2 w-2 rounded-sm bg-gray-700" />Unknown</span>
              <span className="ml-auto">{history.length} samples shown</span>
            </div>
          </div>
        )}
      </Panel>

      <Panel title="Response time" subtitle="Response-time measurements from sampled historical checks.">
        {chartData.every((item) => item.response == null) ? (
          <p className="py-8 text-center text-sm text-gray-500">No response-time measurements available.</p>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="responseFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#34d399" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#252525" strokeDasharray="3 3" />
                <XAxis dataKey="chartTime" tick={{ fill: '#888', fontSize: 11 }} minTickGap={30} />
                <YAxis tick={{ fill: '#888', fontSize: 11 }} unit=" ms" width={70} />
                <Tooltip
                  contentStyle={{ background: '#111', border: '1px solid #333', borderRadius: 8 }}
                  labelStyle={{ color: '#ccc' }}
                  formatter={(value) => [value == null ? 'No measurement' : `${value} ms`, 'Response']}
                />
                <Area type="monotone" dataKey="response" stroke="#34d399" fill="url(#responseFill)" connectNulls={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      <Panel title="Response timing breakdown" subtitle="Average timing components across samples where each measurement was recorded.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {timingAverages.map((item) => (
            <div key={item.label} className="rounded-lg border border-[#252525] bg-[#0c0c0c] p-4">
              <p className="text-sm text-gray-400">{item.label}</p>
              <p className="mt-2 text-xl font-semibold text-white">
                {item.average == null ? '—' : `${item.average} ms`}
              </p>
              <p className="mt-1 text-xs text-gray-600">{item.samples} samples</p>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Incident timeline" subtitle="DOWN events are paired with the next recovery event when one exists.">
        {incidentTimeline.length === 0 ? (
          <p className="py-4 text-sm text-gray-500">No recorded DOWN incidents in the available event history.</p>
        ) : (
          <div className="space-y-0">
            {incidentTimeline.map((incident) => (
              <div key={incident.id} className="border-b border-[#252525] py-4 last:border-b-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="mt-1 h-2.5 w-2.5 rounded-full bg-red-500" />
                    <div>
                      <p className="font-medium text-white">{incident.message || 'Service is down'}</p>
                      <p className="mt-1 text-xs text-gray-500">Started {formatDateTime(incident.created_at)}</p>
                      {incident.recovery && (
                        <p className="mt-1 text-xs text-gray-500">Recovered {formatDateTime(incident.recovery.created_at)}</p>
                      )}
                    </div>
                  </div>
                  <span className={`rounded-full border px-2.5 py-1 text-xs ${incident.recovery ? 'border-emerald-900 text-emerald-400' : 'border-red-900 text-red-400'}`}>
                    {incident.recovery ? 'Recovered' : 'Ongoing / recovery not recorded'}
                  </span>
                </div>
                <p className="ml-5 mt-2 text-sm text-gray-400">
                  Duration: {incident.duration == null ? 'Ongoing or unavailable' : formatDuration(incident.duration)}
                </p>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <div className="flex flex-wrap items-center justify-between gap-3 pb-6 text-xs text-gray-600">
        <span>Data refreshes every 30 seconds while this page is open.</span>
        <button
          type="button"
          onClick={() => void fetchData(false)}
          className="rounded-md border border-[#333] px-3 py-2 text-gray-300 hover:bg-[#1b1b1b]"
        >
          Refresh now
        </button>
      </div>
    </div>
  );
}
