import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '../config/api';
import { apiFetch } from '../utils/apiFetch';

const inputClass =
  'mt-2 w-full rounded-lg border border-[#303030] bg-[#111] px-4 py-3 text-sm text-white outline-none focus:border-emerald-500';

const statuses = ['investigating', 'identified', 'monitoring', 'resolved'];

export default function StatusPageIncidents({ monitors = [] }) {
  const [incidents, setIncidents] = useState([]);
  const [title, setTitle] = useState('');
  const [impact, setImpact] = useState('minor');
  const [message, setMessage] = useState('');
  const [monitorIds, setMonitorIds] = useState([]);
  const [updateMessages, setUpdateMessages] = useState({});
  const [updateStatuses, setUpdateStatuses] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadIncidents = useCallback(async () => {
    setError('');
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/status-pages/incidents`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || 'Could not load incidents.');
      }
      setIncidents(Array.isArray(data.incidents) ? data.incidents : []);
    } catch (err) {
      setError(err.message || 'Could not load incidents.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadIncidents();
  }, [loadIncidents]);

  const toggleMonitor = (id) => {
    setMonitorIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    );
  };

  const createIncident = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');

    try {
      const response = await apiFetch(`${API_BASE_URL}/api/status-pages/incidents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          impact,
          message: message.trim(),
          monitor_ids: monitorIds,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || 'Could not create incident.');
      }

      setTitle('');
      setImpact('minor');
      setMessage('');
      setMonitorIds([]);
      setNotice('Incident announcement created.');
      await loadIncidents();
    } catch (err) {
      setError(err.message || 'Could not create incident.');
    } finally {
      setSaving(false);
    }
  };

  const addUpdate = async (incidentId) => {
    const updateMessage = (updateMessages[incidentId] || '').trim();
    const incident = incidents.find((item) => String(item.id) === String(incidentId));
    const defaultStatus = incident?.status === 'resolved'
      ? 'investigating'
      : incident?.status || 'investigating';
    const status = updateStatuses[incidentId] || defaultStatus;

    if (!updateMessage) {
      setError('Enter an update message first.');
      return;
    }

    setSaving(true);
    setError('');
    setNotice('');

    try {
      const response = await apiFetch(
        `${API_BASE_URL}/api/status-pages/incidents/${incidentId}/updates`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status, message: updateMessage }),
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || 'Could not add incident update.');
      }

      setUpdateMessages((current) => ({ ...current, [incidentId]: '' }));
      setUpdateStatuses((current) => {
        const next = { ...current };
        delete next[incidentId];
        return next;
      });
      setNotice('Incident update published.');
      await loadIncidents();
    } catch (err) {
      setError(err.message || 'Could not add incident update.');
    } finally {
      setSaving(false);
    }
  };

  const impactClass = {
    minor: 'text-blue-300',
    major: 'text-amber-300',
    critical: 'text-red-300',
  };

  return (
    <section className="space-y-6 rounded-xl border border-[#292929] bg-[#141414] p-6">
      <div>
        <h2 className="text-lg font-medium text-white">Incident announcements</h2>
        <p className="mt-1 text-sm text-gray-400">
          Publish incidents and timestamped progress updates on your public status page.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="rounded-lg border border-emerald-900 bg-emerald-950/30 p-3 text-sm text-emerald-300">
          {notice}
        </div>
      )}

      <form onSubmit={createIncident} className="space-y-4 rounded-lg border border-[#303030] p-4">
        <h3 className="font-medium text-white">Create an incident</h3>

        <label className="block text-sm text-gray-300">
          Incident title
          <input
            className={inputClass}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={160}
            placeholder="e.g. API requests experiencing delays"
            required
          />
        </label>

        <label className="block text-sm text-gray-300">
          Impact
          <select className={inputClass} value={impact} onChange={(event) => setImpact(event.target.value)}>
            <option value="minor">Minor</option>
            <option value="major">Major</option>
            <option value="critical">Critical</option>
          </select>
        </label>

        <label className="block text-sm text-gray-300">
          Initial announcement
          <textarea
            className={inputClass}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={5000}
            rows={3}
            placeholder="Describe what is happening and what users may experience."
            required
          />
        </label>

        <div>
          <p className="text-sm text-gray-300">Affected monitors (optional)</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {monitors.map((monitor) => (
              <label key={monitor.id} className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  className="accent-emerald-500"
                  checked={monitorIds.includes(Number(monitor.id))}
                  onChange={() => toggleMonitor(Number(monitor.id))}
                />
                <span className="truncate">{monitor.name}</span>
              </label>
            ))}
            {monitors.length === 0 && (
              <p className="text-xs text-gray-500">No monitors available to link.</p>
            )}
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-emerald-500 px-5 py-3 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-50"
        >
          {saving ? 'Publishing...' : 'Publish incident'}
        </button>
      </form>

      <div className="space-y-4">
        <h3 className="font-medium text-white">Incident history</h3>

        {loading ? (
          <p className="text-sm text-gray-400">Loading incidents...</p>
        ) : incidents.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[#333] p-4 text-sm text-gray-400">
            No incidents have been announced yet.
          </p>
        ) : incidents.map((incident) => (
          <article key={incident.id} className="space-y-4 rounded-lg border border-[#303030] p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h4 className="font-medium text-white">{incident.title}</h4>
                <p className={`mt-1 text-xs capitalize ${impactClass[incident.impact] || 'text-gray-400'}`}>
                  {incident.impact} impact
                </p>
              </div>
              <span className="rounded-md border border-[#383838] px-2 py-1 text-xs capitalize text-gray-300">
                {incident.status.replaceAll('_', ' ')}
              </span>
            </div>

            {Array.isArray(incident.affected_monitors) && incident.affected_monitors.length > 0 && (
              <p className="text-xs text-gray-400">
                Affected: {incident.affected_monitors.map((monitor) => monitor.name).join(', ')}
              </p>
            )}

            <div className="space-y-3 border-l border-[#383838] pl-4">
              {(incident.updates || []).map((update) => (
                <div key={update.id}>
                  <p className="text-xs capitalize text-emerald-400">{update.status}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-gray-300">{update.message}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {new Date(update.created_at).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>

            <div className="grid gap-3 border-t border-[#303030] pt-4 sm:grid-cols-[180px_1fr_auto]">
              <select
                className={inputClass + ' mt-0'}
                value={updateStatuses[incident.id] || (incident.status === 'resolved' ? 'investigating' : incident.status)}
                onChange={(event) => setUpdateStatuses((current) => ({
                  ...current,
                  [incident.id]: event.target.value,
                }))}
              >
                {(incident.status === 'resolved' ? ['investigating'] : statuses).map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
              <input
                className={inputClass + ' mt-0'}
                value={updateMessages[incident.id] || ''}
                onChange={(event) => setUpdateMessages((current) => ({
                  ...current,
                  [incident.id]: event.target.value,
                }))}
                maxLength={5000}
                placeholder="Write an incident update..."
              />
              <button
                type="button"
                disabled={saving}
                onClick={() => addUpdate(incident.id)}
                className="rounded-lg border border-[#383838] px-4 py-3 text-sm text-white hover:bg-[#202020] disabled:opacity-50"
              >
                {incident.status === 'resolved' ? 'Reopen incident' : 'Add update'}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}



