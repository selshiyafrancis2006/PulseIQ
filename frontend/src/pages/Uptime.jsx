import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../utils/apiFetch';
import { API_BASE_URL } from '../config/api';

import UptimeSummary from '../components/uptime/UptimeSummary';
import MonitorList from '../components/uptime/MonitorList';
import MonitorToolbar from '../components/uptime/MonitorToolbar';
import MonitorForm from '../components/uptime/MonitorForm';

function Uptime() {
  const [monitors, setMonitors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingMonitor, setEditingMonitor] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busyMonitorId, setBusyMonitorId] = useState(null);
  const [pageError, setPageError] = useState('');
  const [notice, setNotice] = useState('');
  const formRef = useRef(null);
  const noticeRef = useRef(null);

  useEffect(() => {
    if (!showForm) return;

    formRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  }, [showForm, editingMonitor]);

  useEffect(() => {
    if (!notice) return undefined;

    const timer = setTimeout(() => setNotice(''), 3000);
    return () => clearTimeout(timer);
  }, [notice]);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [tagFilter, setTagFilter] = useState('');
  const [timeRange, setTimeRange] = useState('24h');

  const fetchMonitors = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);

    try {
      const res = await apiFetch(`${API_BASE_URL}/api/monitors/status`);

      if (!res.ok) {
        throw new Error('Failed to fetch monitor status.');
      }

      const data = await res.json();
      setMonitors(data);
      setPageError('');
    } catch (error) {
      console.error('Error fetching monitors:', error);
      setPageError(error.message || 'Unable to load monitors.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchMonitors(true);

    const interval = setInterval(() => {
      void fetchMonitors();
    }, 30000);

    return () => clearInterval(interval);
  }, [fetchMonitors]);

  const handleSave = async (payload) => {
    setSaving(true);
    setPageError('');
    setNotice('');

    try {
      const isEditing = Boolean(editingMonitor);
      const url = isEditing
        ? `${API_BASE_URL}/api/monitors/${editingMonitor.id}`
        : `${API_BASE_URL}/api/monitors`;

      const res = await apiFetch(url, {
        method: isEditing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(
          data.error ||
            data.message ||
            `Failed to ${isEditing ? 'update' : 'create'} monitor.`
        );
      }

      setShowForm(false);
      setEditingMonitor(null);
      setNotice(isEditing ? 'Monitor updated successfully.' : 'Monitor created successfully.');
      await fetchMonitors(true);
      requestAnimationFrame(() => document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' }));
    } catch (error) {
      setPageError(error.message || 'Unable to save monitor.');
      throw error;
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePause = async (monitor) => {
    setBusyMonitorId(monitor.id);
    setPageError('');
    setNotice('');

    try {
      const action = monitor.is_active === false ? 'resume' : 'pause';
      const res = await apiFetch(
        `${API_BASE_URL}/api/monitors/${monitor.id}/${action}`,
        { method: 'PATCH' }
      );

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || data.message || `Failed to ${action} monitor.`);
      }

      setNotice(`Monitor ${action === 'pause' ? 'Paused' : 'Resumed'} Successfully`);
      requestAnimationFrame(() => document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' }));
      await fetchMonitors();
    } catch (error) {
      setPageError(error.message || 'Unable to change monitor state.');
      requestAnimationFrame(() => document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' }));
    } finally {
      setBusyMonitorId(null);
    }
  };

  const handleDelete = async (monitor) => {
    const target = monitor || deleteTarget;
    if (!target) return;
    setBusyMonitorId(target.id);
    setPageError('');
    setNotice('');

    try {
      const res = await apiFetch(`${API_BASE_URL}/api/monitors/${target.id}`, {
        method: 'DELETE',
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || data.message || 'Failed to delete monitor.');
      }

      setDeleteTarget(null);
      setNotice(`Monitor "${target.name}" deleted successfully.`);
      await fetchMonitors(true);
      requestAnimationFrame(() => document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' }));
    } catch (error) {
      setPageError(error.message || 'Unable to delete monitor.');
    } finally {
      setBusyMonitorId(null);
    }
  };

  const handleEdit = (monitor) => {
    setPageError('');
    setNotice('');
    setEditingMonitor(monitor);
    setShowForm(true);
  };

  const handleAdd = () => {
    setPageError('');
    setNotice('');
    setEditingMonitor(null);
    setShowForm(true);
  };

  const filteredMonitors = monitors.filter((monitor) => {
    const name = (monitor.name || '').toLowerCase();
    const url = (monitor.url || '').toLowerCase();
    const tcpTarget = `${monitor.tcp_host || ''}:${monitor.tcp_port || ''}`.toLowerCase();
    const dnsTarget = `${monitor.dns_hostname || ''} ${monitor.dns_record_type || ''}`.toLowerCase();
    const query = search.trim().toLowerCase();

    const matchesSearch =
      name.includes(query) ||
      url.includes(query) ||
      tcpTarget.includes(query) ||
      dnsTarget.includes(query);
    const matchesStatus =
      statusFilter === 'ALL' || monitor.status === statusFilter;
    const matchesTag =
      !tagFilter || (monitor.tags || []).includes(tagFilter.trim());

    return matchesSearch && matchesStatus && matchesTag;
  });

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white">
      <div className="mb-8">
        <p className="text-xs uppercase tracking-widest text-gray-400">
          Monitoring
        </p>
        <h1 className="mt-2 text-4xl font-bold">Uptime Monitoring</h1>
        <p className="mt-2 text-gray-400">
          Monitor website and API availability in real time.
        </p>
      </div>

      <MonitorToolbar
        search={search}
        setSearch={setSearch}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        tagFilter={tagFilter}
        setTagFilter={setTagFilter}
        onAddMonitor={handleAdd}
      />

      {(pageError || notice) && <div ref={noticeRef} />}
      {pageError && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-900 bg-red-950/30 p-3 text-sm text-red-300"
        >
          {pageError}
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="mb-4 rounded-lg border border-emerald-900 bg-emerald-950/30 p-3 text-sm text-emerald-300"
        >
          {notice}
        </div>
      )}

      {showForm && (
        <div ref={formRef}>
          <MonitorForm
          key={editingMonitor ? editingMonitor.id : 'new'}
          monitor={editingMonitor}
          saving={saving}
          onSubmit={handleSave}
          onCancel={() => {
            if (!saving) {
              setShowForm(false);
              setEditingMonitor(null);
            }
          }}
          />
        </div>
      )}

      {deleteTarget && (
  <div
    role="alertdialog"
    aria-labelledby="delete-monitor-title"
    className="mb-4 rounded-lg border border-[#3a3a3a] bg-[#151515] p-4"
  >
    <h4 id="delete-monitor-title" className="font-semibold text-white">
      Delete "{deleteTarget.name}"?
    </h4>
    <p className="mt-2 text-sm text-gray-300">
      This will permanently delete this monitor. This action cannot be undone.
    </p>
    <div className="mt-4 flex flex-wrap gap-3">
      <button
        type="button"
        onClick={() => handleDelete(deleteTarget)}
        disabled={busyMonitorId === deleteTarget.id}
        className="rounded-md border border-red-700 bg-red-950/30 px-4 py-2 text-sm text-red-400 hover:bg-red-950/60 disabled:opacity-50"
      >
        {busyMonitorId === deleteTarget.id ? 'Deleting...' : 'Confirm delete'}
      </button>
      <button
        type="button"
        onClick={() => setDeleteTarget(null)}
        disabled={busyMonitorId === deleteTarget.id}
        className="rounded-md border border-[#3a3a3a] px-4 py-2 text-sm text-gray-200 hover:bg-[#252525] disabled:opacity-50"
      >
        Cancel
      </button>
    </div>
  </div>
)}

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
  <UptimeSummary monitors={filteredMonitors} />

  <div className="flex items-center gap-2">
    <label
      htmlFor="uptime-range"
      className="text-sm text-gray-400"
    >
      Time range
    </label>

    <select
      id="uptime-range"
      value={timeRange}
      onChange={(event) => setTimeRange(event.target.value)}
      className="rounded-md border border-[#3a3a3a] bg-[#111] px-3 py-2 text-sm text-gray-200"
    >
      <option value="24h">Last 24 hours</option>
      <option value="7d">Last 7 days</option>
      <option value="30d">Last 30 days</option>
    </select>
  </div>
</div>

<MonitorList
  monitors={filteredMonitors}
  loading={loading}
  timeRange={timeRange}
        onEdit={handleEdit}
        onTogglePause={handleTogglePause}
        onDelete={(monitor) => {
          requestAnimationFrame(() => document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' }));
          setPageError('');
          setNotice('');
          setDeleteTarget(monitor);
        }}
        onConfirmDelete={handleDelete}
        busyMonitorId={busyMonitorId}
        deleteTarget={deleteTarget}
        onCancelDelete={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export default Uptime;
