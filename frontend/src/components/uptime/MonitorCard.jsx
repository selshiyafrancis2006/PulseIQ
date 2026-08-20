import { useEffect, useState } from 'react';
import { apiFetch } from '../../utils/apiFetch';
import { API_BASE_URL } from '../../config/api';
import ResponseTimeChart from './ResponseTimeChart';
import MonitorStatusBadge from './MonitorStatusBadge';

function MonitorCard({ monitor }) {
  const [history, setHistory] = useState([]);
  const [uptime, setUptime] = useState(null);
  const [events, setEvents] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [h, u, e] = await Promise.all([
          apiFetch(`${API_BASE_URL}/api/monitors/${monitor.id}/history`).then(r => r.json()),
          apiFetch(`${API_BASE_URL}/api/monitors/${monitor.id}/uptime`).then(r => r.json()),
          apiFetch(`${API_BASE_URL}/api/monitors/${monitor.id}/events`).then(r => r.json()),
        ]);

        setHistory(h.reverse());
        setUptime(u.uptime);
        setEvents(e.reverse());
      } catch (err) {
        console.error(err);
      }
    };

    fetchData();
  }, [monitor.id]);

  const getTrend = () => {
    if (history.length < 2) return { icon: '→', color: 'text-gray-500' };

    const latest = history[0]?.response_time_ms ?? 0;
    const prev = history[1]?.response_time_ms ?? 0;

    if (latest > prev) return { icon: '▲', color: 'text-red-400' };
    if (latest < prev) return { icon: '▼', color: 'text-emerald-400' };

    return { icon: '→', color: 'text-gray-500' };
  };

  const getLiveStatus = () => {
    if (!monitor.checked_at) return 'STALE';
    const diff = Date.now() - new Date(monitor.checked_at).getTime();
    return diff < 120000 ? 'LIVE' : 'STALE';
  };

  const getEventColor = (type) => {
    switch (type) {
      case 'DOWN':
        return 'text-red-400';
      case 'UP':
        return 'text-emerald-400';
      case 'SLOW':
        return 'text-yellow-400';
      default:
        return 'text-gray-500';
    }
  };

  const trend = getTrend();
  const liveStatus = getLiveStatus();

  return (
    <div className="border border-[#2a2a2a] rounded-lg bg-[#111] hover:bg-[#151515] transition">

      {/* ================= HEADER ================= */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2a2a]">
        
        <div className="flex flex-col">
          <h3 className="text-white font-semibold text-lg">
            {monitor.name}
          </h3>
          <p className="text-gray-500 text-sm">
            {monitor.url}
          </p>
        </div>

        <MonitorStatusBadge
          status={monitor.status}
          responseTime={monitor.response_time_ms}
        />
      </div>

      {/* ================= METRICS ================= */}
      <div className="grid grid-cols-4 gap-4 px-5 py-4 items-center">

        {/* Chart */}
        <div className="col-span-1">
          <ResponseTimeChart
            data={history}
            status={monitor.status}
            responseTime={monitor.response_time_ms}
          />
        </div>

        {/* Response Time */}
        <div className="text-right">
          <p className="text-xs text-gray-500 uppercase">Response</p>
          <div className="flex justify-end items-center gap-2">
            <span className={`text-sm ${trend.color}`}>
              {trend.icon}
            </span>
            <span className="text-white font-semibold">
              {monitor.response_time_ms ?? '--'} ms
            </span>
          </div>
        </div>

        {/* Uptime */}
        <div className="text-right">
          <p className="text-xs text-gray-500 uppercase">Uptime</p>
          <span className="text-white font-semibold">
            {uptime !== null ? `${uptime}%` : '--'}
          </span>
        </div>

        {/* Live Status */}
        <div className="text-right">
          <p className="text-xs text-gray-500 uppercase">Status</p>
          <span
            className={`text-xs font-semibold ${
              liveStatus === 'LIVE' ? 'text-emerald-400' : 'text-gray-500'
            }`}
          >
            ● {liveStatus}
          </span>
        </div>
      </div>

      {/* ================= INCIDENTS ================= */}
      <div className="px-5 pb-4 border-t border-[#2a2a2a] pt-3">
        <p className="text-xs text-gray-500 mb-2 uppercase tracking-wide">
          Recent Incidents
        </p>

        {events.length === 0 ? (
          <p className="text-xs text-gray-600">No incidents</p>
        ) : (
          <div className="space-y-1">
            {events.slice(0, 3).map((event) => (
              <div
                key={event.id}
                className="flex justify-between text-xs"
              >
                <span className={getEventColor(event.type)}>
                  ● {event.type}
                </span>
                <span className="text-gray-500">
                  {event.message}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default MonitorCard;