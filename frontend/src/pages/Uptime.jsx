import { useEffect, useState } from 'react';
import { apiFetch } from '../utils/apiFetch';
import { API_BASE_URL } from '../config/api';

import UptimeSummary from '../components/uptime/UptimeSummary';
import MonitorList from '../components/uptime/MonitorList';
import MonitorToolbar from '../components/uptime/MonitorToolbar';

function Uptime() {
  const [monitors, setMonitors] = useState([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  useEffect(() => {
    const fetchMonitors = async () => {
      try {
        const res = await apiFetch(
          `${API_BASE_URL}/api/monitors/status`
        );

        if (!res.ok) {
          throw new Error('Failed to fetch monitor status');
        }

        const data = await res.json();
        setMonitors(data);
      } catch (err) {
        console.error('Error fetching monitors:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchMonitors();

    const interval = setInterval(fetchMonitors, 30000);

    return () => clearInterval(interval);
  }, []);

  const filteredMonitors = monitors.filter((monitor) => {
    const matchesSearch =
      monitor.name.toLowerCase().includes(search.toLowerCase()) ||
      monitor.url.toLowerCase().includes(search.toLowerCase());

    const matchesStatus =
      statusFilter === 'ALL' ||
      monitor.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white">

      {/* Header */}
      <div className="mb-8">
        <p className="text-xs uppercase tracking-widest text-gray-400">
          Monitoring
        </p>

        <h1 className="text-4xl font-bold mt-2">
          Uptime Monitoring
        </h1>

        <p className="text-gray-400 mt-2">
          Monitor website and API availability in real time.
        </p>
      </div>

      <MonitorToolbar
        search={search}
        setSearch={setSearch}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
      />

      <UptimeSummary monitors={filteredMonitors} />

      <MonitorList
        monitors={filteredMonitors}
        loading={loading}
      />

    </div>
  );
}

export default Uptime;