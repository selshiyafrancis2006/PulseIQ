import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE_URL } from '../config/api';
import { apiFetch } from '../utils/apiFetch';
import {
  DURATION_PRESETS,
  MAX_DURATION_MINUTES,
  MAX_REASON_LENGTH,
  buildWindowPayload,
  formatWindowDate,
} from '../utils/maintenance';

const WINDOWS_URL = `${API_BASE_URL}/api/maintenance-windows`;
const REFRESH_MS = 30000;

const TABS = [
  { key: 'active', label: 'Active' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'ended', label: 'Ended' },
];

const STATE_STYLES = {
  active: 'border-amber-800 bg-amber-950/40 text-amber-300',
  upcoming: 'border-sky-800 bg-sky-950/40 text-sky-300',
  ended: 'border-[#383838] bg-[#1c1c1c] text-gray-400',
};

const inputClass =
  'mt-2 w-full rounded-lg border border-[#303030] bg-[#111] px-4 py-3 text-sm text-white outline-none focus:border-emerald-500';

const EMPTY_FORM = {
  monitorId: '',
  reason: '',
  startMode: 'now',
  startsAt: '',
  durationChoice: '60',
  customMinutes: '',
};

async function readJson(response) {
  return response.json().catch(() => ({}));
}

export default function MaintenanceWindows() {
  const [windows, setWindows] = useState([]);
  const [monitors, setMonitors] = useState([]);
  const [tab, setTab] = useState('active');
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadData = useCallback(async () => {
    try {
      const [windowsResponse, monitorsResponse] = await Promise.all([
        apiFetch(WINDOWS_URL),
        apiFetch(`${API_BASE_URL}/api/monitors`),
      ]);

      const windowsData = await readJson(windowsResponse);
      const monitorsData = await readJson(monitorsResponse);

      if (!windowsResponse.ok) {
        throw new Error(
          windowsData.message || 'Could not load maintenance windows.'
        );
      }

      if (!monitorsResponse.ok) {
        throw new Error(monitorsData.message || 'Could not load monitors.');
      }

      setWindows(Array.isArray(windowsData) ? windowsData : []);
      setMonitors(Array.isArray(monitorsData) ? monitorsData : []);
      setError('');
    } catch (err) {
      setError(err.message || 'Unable to load maintenance windows.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();

    // Window states change with time, so refresh periodically.
    const timer = setInterval(() => void loadData(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [loadData]);

  const updateForm = (changes) =>
    setForm((current) => ({ ...current, ...changes }));

  async function handleCreate(event) {
    event.preventDefault();
    setError('');
    setNotice('');

    const built = buildWindowPayload(form);

    if (!built.ok) {
      setError(built.error);
      return;
    }

    setSubmitting(true);

    try {
      const response = await apiFetch(WINDOWS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(built.payload),
      });
      const data = await readJson(response);

      if (!response.ok) {
        throw new Error(data.message || 'Could not create the window.');
      }

      setNotice('Maintenance window created.');
      setForm((current) => ({ ...EMPTY_FORM, monitorId: current.monitorId }));
      setTab(data.state === 'upcoming' ? 'upcoming' : 'active');
      await loadData();
    } catch (err) {
      setError(err.message || 'Could not create the window.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEnd(id) {
    setBusyId(id);
    setError('');
    setNotice('');

    try {
      const response = await apiFetch(`${WINDOWS_URL}/${id}/end`, {
        method: 'POST',
      });
      const data = await readJson(response);

      if (!response.ok) {
        throw new Error(data.message || 'Could not end the window.');
      }

      setNotice('Maintenance window ended. Alerts are active again.');
      await loadData();
    } catch (err) {
      setError(err.message || 'Could not end the window.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this maintenance window?')) return;

    setBusyId(id);
    setError('');
    setNotice('');

    try {
      const response = await apiFetch(`${WINDOWS_URL}/${id}`, {
        method: 'DELETE',
      });
      const data = await readJson(response);

      if (!response.ok) {
        throw new Error(data.message || 'Could not delete the window.');
      }

      setNotice('Maintenance window deleted.');
      await loadData();
    } catch (err) {
      setError(err.message || 'Could not delete the window.');
    } finally {
      setBusyId(null);
    }
  }

  const counts = {
    active: windows.filter((item) => item.state === 'active').length,
    upcoming: windows.filter((item) => item.state === 'upcoming').length,
    ended: windows.filter((item) => item.state === 'ended').length,
  };

  const visible = windows.filter((item) => item.state === tab);

  if (loading) {
    return (
      <div className="text-sm text-gray-400">
        Loading maintenance windows...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-7">
      <header>
        <p className="text-sm text-emerald-400">PLANNED DOWNTIME</p>
        <h1 className="mt-2 text-3xl font-semibold text-white">
          Maintenance windows
        </h1>
        <p className="mt-2 text-sm text-gray-400">
          Checks keep running during a window, but they send no alerts and do
          not count against uptime.
        </p>
      </header>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-900 bg-red-950/40 p-4 text-sm text-red-300"
        >
          {error}
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="rounded-lg border border-emerald-900 bg-emerald-950/30 p-4 text-sm text-emerald-300"
        >
          {notice}
        </div>
      )}

      <form
        onSubmit={handleCreate}
        className="space-y-5 rounded-xl border border-[#292929] bg-[#141414] p-6"
      >
        <h2 className="text-lg font-medium text-white">Schedule a window</h2>

        <label className="block text-sm text-gray-300">
          Applies to
          <select
            className={inputClass}
            value={form.monitorId}
            onChange={(event) => updateForm({ monitorId: event.target.value })}
          >
            <option value="">All my monitors</option>
            {monitors.map((monitor) => (
              <option key={monitor.id} value={String(monitor.id)}>
                {monitor.name}
              </option>
            ))}
          </select>
          {monitors.length === 0 && (
            <span className="mt-1 block text-xs text-gray-500">
              You have no monitors yet. Create one in{' '}
              <Link to="/uptime" className="text-emerald-400 hover:underline">
                Uptime Monitoring
              </Link>
              .
            </span>
          )}
        </label>

        <label className="block text-sm text-gray-300">
          Reason (optional)
          <input
            className={inputClass}
            value={form.reason}
            maxLength={MAX_REASON_LENGTH}
            placeholder="Database upgrade"
            onChange={(event) => updateForm({ reason: event.target.value })}
          />
        </label>

        <fieldset className="space-y-3">
          <legend className="text-sm text-gray-300">Starts</legend>
          <div className="flex flex-wrap gap-5 text-sm text-white">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="startMode"
                className="accent-emerald-500"
                checked={form.startMode === 'now'}
                onChange={() => updateForm({ startMode: 'now' })}
              />
              Right now
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="startMode"
                className="accent-emerald-500"
                checked={form.startMode === 'later'}
                onChange={() => updateForm({ startMode: 'later' })}
              />
              Schedule for later
            </label>
          </div>

          {form.startMode === 'later' && (
            <label className="block text-sm text-gray-300">
              Start date and time
              <input
                type="datetime-local"
                className={inputClass}
                value={form.startsAt}
                onChange={(event) => updateForm({ startsAt: event.target.value })}
              />
            </label>
          )}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm text-gray-300">
            Duration
            <select
              className={inputClass}
              value={form.durationChoice}
              onChange={(event) =>
                updateForm({ durationChoice: event.target.value })
              }
            >
              {DURATION_PRESETS.map((preset) => (
                <option key={preset.value} value={String(preset.value)}>
                  {preset.label}
                </option>
              ))}
              <option value="custom">Custom...</option>
            </select>
          </label>

          {form.durationChoice === 'custom' && (
            <label className="block text-sm text-gray-300">
              Custom duration (minutes)
              <input
                type="number"
                min="1"
                max={MAX_DURATION_MINUTES}
                className={inputClass}
                value={form.customMinutes}
                onChange={(event) =>
                  updateForm({ customMinutes: event.target.value })
                }
              />
            </label>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-emerald-500 px-5 py-3 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Creating...' : 'Create window'}
        </button>
      </form>

      <section className="rounded-xl border border-[#292929] bg-[#141414] p-6">
        <div role="tablist" className="mb-4 flex flex-wrap gap-2">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              onClick={() => setTab(item.key)}
              className={`rounded-lg px-4 py-2 text-sm transition ${
                tab === item.key
                  ? 'bg-emerald-500 font-semibold text-black'
                  : 'border border-[#383838] text-gray-300 hover:bg-[#202020]'
              }`}
            >
              {item.label} ({counts[item.key]})
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[#333] p-5 text-sm text-gray-400">
            No {tab} maintenance windows.
          </p>
        ) : (
          <ul className="divide-y divide-[#292929]">
            {visible.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 py-4"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-white">
                      {item.monitor_name || 'All monitors'}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs capitalize ${STATE_STYLES[item.state]}`}
                    >
                      {item.state}
                    </span>
                  </div>
                  {item.reason && (
                    <p className="mt-1 text-sm text-gray-300">{item.reason}</p>
                  )}
                  <p className="mt-1 text-xs text-gray-500">
                    {formatWindowDate(item.starts_at)} to{' '}
                    {formatWindowDate(item.ends_at)}
                  </p>
                </div>

                <div className="flex gap-2">
                  {item.state === 'active' && (
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => handleEnd(item.id)}
                      className="rounded-lg border border-[#383838] px-4 py-2 text-sm text-white hover:bg-[#202020] disabled:opacity-50"
                    >
                      End now
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => handleDelete(item.id)}
                    className="rounded-lg border border-red-900 px-4 py-2 text-sm text-red-300 hover:bg-red-950/40 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}