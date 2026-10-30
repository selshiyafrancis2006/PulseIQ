import { useCallback, useEffect, useState } from 'react';
import useHosts from '../../hooks/useHosts';
import { apiFetch } from '../../utils/apiFetch';
import { API_BASE_URL } from '../../config/api';

function formatDate(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}

function hostStatusClass(status) {
  if (status === 'online') return 'text-emerald-400';
  if (status === 'offline') return 'text-red-400';
  return 'text-amber-400';
}

export default function MonitorLocationsPanel({ monitorId }) {
  const { hosts, loading: hostsLoading, error: hostsError } = useHosts();

  const [selectedHostIds, setSelectedHostIds] = useState([]);
  const [quorum, setQuorum] = useState(1);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
  if (!message) return;

  const timeoutId = setTimeout(() => {
    setMessage('');
  }, 3000);

  return () => clearTimeout(timeoutId);
}, [message]);

  const locationsUrl = `${API_BASE_URL}/api/monitors/${monitorId}/locations`;

  const loadLocations = useCallback(async () => {
    const response = await apiFetch(locationsUrl);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to load check locations');
    }

    setLocations(Array.isArray(data.locations) ? data.locations : []);
    setSelectedHostIds(
      (data.locations || []).map((location) => Number(location.host_id))
    );
    setQuorum(Number(data.quorum) || 1);
  }, [locationsUrl]);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError('');

      try {
        const response = await apiFetch(locationsUrl);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || data.error || 'Failed to load check locations');
        }

        if (!active) return;

        setLocations(Array.isArray(data.locations) ? data.locations : []);
        setSelectedHostIds(
          (data.locations || []).map((location) => Number(location.host_id))
        );
        setQuorum(Number(data.quorum) || 1);
      } catch (err) {
        if (active) setError(err.message || 'Unable to load check locations');
      } finally {
        if (active) setLoading(false);
      }
    }

    load();

    return () => {
      active = false;
    };
  }, [locationsUrl]);

  function toggleHost(hostId) {
    setSelectedHostIds((current) => {
      const next = current.includes(hostId)
        ? current.filter((id) => id !== hostId)
        : [...current, hostId];

      setQuorum((currentQuorum) => Math.min(currentQuorum, next.length + 1));
      return next;
    });

    setMessage('');
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    setMessage('');

    try {
      const response = await apiFetch(locationsUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host_ids: selectedHostIds,
          quorum,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Failed to save check locations');
      }

      await loadLocations();
      setMessage('Check locations saved successfully.');
    } catch (err) {
      setError(err.message || 'Unable to save check locations');
    } finally {
      setSaving(false);
    }
  }

  const maxQuorum = selectedHostIds.length + 1;

  return (
    <section className="overflow-hidden rounded-xl border border-[#2a2a2a] bg-[#111]">
      <div className="border-b border-[#252525] px-5 py-4">
        <h2 className="font-semibold text-white">Multi-location checks</h2>
        <p className="mt-1 text-xs text-gray-500">
          Select agents to check this monitor from additional locations.
          The central checker always contributes one vote.
        </p>
      </div>

      <div className="space-y-5 p-5">
        {loading ? (
          <p className="text-sm text-gray-400">Loading check locations...</p>
        ) : (
          <>
            <div>
              <h3 className="mb-3 text-sm font-medium text-gray-200">
                Available agents
              </h3>

              {hostsLoading ? (
                <p className="text-sm text-gray-500">Loading registered agents...</p>
              ) : hosts.length === 0 ? (
                <p className="rounded-lg border border-[#252525] bg-[#0c0c0c] p-4 text-sm text-gray-500">
                  No registered agents yet. The central checker will continue
                  monitoring this target.
                </p>
              ) : (
                <div className="space-y-2">
                  {hosts.map((host) => {
                    const hostId = Number(host.id);
                    const checked = selectedHostIds.includes(hostId);

                    return (
                      <label
                        key={host.id}
                        className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-[#252525] bg-[#0c0c0c] p-3"
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleHost(hostId)}
                            className="accent-emerald-500"
                          />
                          <span className="truncate text-sm text-gray-200">
                            {host.name}
                          </span>
                        </span>

                        <span className={`shrink-0 text-xs capitalize ${hostStatusClass(host.status)}`}>
                          {host.status || 'pending'}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}

              {hostsError && (
                <p className="mt-2 text-xs text-amber-400">
                  Agent list: {hostsError}
                </p>
              )}
            </div>

            <div className="rounded-lg border border-[#252525] bg-[#0c0c0c] p-4">
              <label htmlFor="monitor-quorum" className="block text-sm font-medium text-gray-200">
                Required quorum
              </label>

              <select
                id="monitor-quorum"
                value={quorum}
                onChange={(event) => setQuorum(Number(event.target.value))}
                className="mt-2 rounded-md border border-[#3a3a3a] bg-[#151515] px-3 py-2 text-sm text-white"
              >
                {Array.from({ length: maxQuorum }, (_, index) => index + 1).map((value) => (
                  <option key={value} value={value}>
                    {value} {value === 1 ? 'vote' : 'votes'}
                  </option>
                ))}
              </select>

              <p className="mt-2 text-xs text-gray-500">
                {maxQuorum} total possible voters: one central checker and{' '}
                {selectedHostIds.length} selected agent
                {selectedHostIds.length === 1 ? '' : 's'}.
                A matching UP or DOWN quorum determines the monitor status.
                Insufficient or conflicting votes are inconclusive.
              </p>
            </div>

            <div>
              <h3 className="mb-3 text-sm font-medium text-gray-200">
                Assigned location results
              </h3>

              {locations.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No agents are currently assigned. Only the central checker is active.
                </p>
              ) : (
                <div className="space-y-2">
                  {locations.map((location) => (
                    <div
                      key={location.host_id}
                      className="rounded-lg border border-[#252525] bg-[#0c0c0c] p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium text-gray-200">
                          {location.host_name || `Host ${location.host_id}`}
                        </span>
                        <span className="text-xs text-gray-400">
                          {location.agent_status === 'offline' || location.agent_status === 'pending' ? 'Agent status: ' : 'Latest result: '}
                          <span className={
                            location.agent_status === 'offline' || (location.agent_status === 'online' && location.result_is_fresh && location.last_status === 'DOWN')
                              ? 'text-red-400'
                              : location.agent_status === 'pending' || (location.agent_status === 'online' && !location.last_status)
                                ? 'text-gray-500'
                                : location.agent_status === 'online' && !location.result_is_fresh
                                  ? 'text-amber-400'
                                  : 'text-emerald-400'
                          }>
                            {location.agent_status === 'offline'
                              ? 'Agent offline'
                              : location.agent_status === 'pending'
                                ? 'Awaiting heartbeat'
                                : !location.last_status
                                  ? 'No result'
                                  : !location.result_is_fresh
                                    ? 'Stale - not counted'
                                    : location.last_status}
                          </span>
                        </span>
                      </div>

                      <p className="mt-2 text-xs text-gray-500">
                        Last check: {formatDate(location.last_checked_at)}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        Agent last seen: {formatDate(location.last_seen_at)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {error && (
              <p role="alert" className="text-sm text-red-400">{error}</p>
            )}

            {message && (
              <p role="status" className="text-sm text-emerald-400">{message}</p>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save locations'}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
