import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE_URL } from '../config/api';
import { apiFetch } from '../utils/apiFetch';

const inputClass =
  'mt-2 w-full rounded-lg border border-[#303030] bg-[#111] px-4 py-3 text-sm text-white outline-none focus:border-emerald-500';

export default function StatusPageSettings() {
  const [page, setPage] = useState(null);
  const [monitors, setMonitors] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [title, setTitle] = useState('System Status');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const [pageResponse, monitorsResponse] = await Promise.all([
        apiFetch(`${API_BASE_URL}/api/status-pages`),
        apiFetch(`${API_BASE_URL}/api/monitors/status`),
      ]);

      const pageData = await pageResponse.json().catch(() => ({}));
      const monitorData = await monitorsResponse.json().catch(() => ({}));

      if (!pageResponse.ok) {
        throw new Error(pageData.message || pageData.error || 'Could not load status page settings.');
      }

      if (!monitorsResponse.ok) {
        throw new Error(monitorData.message || monitorData.error || 'Could not load monitors.');
      }

      setPage(pageData.page || null);
      setTitle(pageData.page?.title || 'System Status');
      setDescription(pageData.page?.description || '');
      setIsPublic(Boolean(pageData.page?.is_public));
      setSelectedIds((pageData.monitor_ids || []).map(Number));
      setMonitors(Array.isArray(monitorData) ? monitorData : []);
    } catch (err) {
      setError(err.message || 'Unable to load status page settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const toggleMonitor = (id) => {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    );
  };

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');

    try {
      const response = await apiFetch(`${API_BASE_URL}/api/status-pages`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          is_public: isPublic,
          monitor_ids: selectedIds,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Could not save status page.');
      }

      setPage(data.page || null);
      setSelectedIds((data.monitor_ids || []).map(Number));
      setNotice('Status page settings saved.');
    } catch (err) {
      setError(err.message || 'Unable to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const publicUrl = page?.slug
    ? `${window.location.origin}/status/${page.slug}`
    : '';

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setNotice('Public URL copied.');
      setError('');
    } catch {
      setError('Could not copy automatically. Select and copy the URL instead.');
    }
  };

  if (loading) {
    return <div className="text-sm text-gray-400">Loading status page settings...</div>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-7">
      <header>
        <p className="text-sm text-emerald-400">PUBLIC STATUS</p>
        <h1 className="mt-2 text-3xl font-semibold text-white">Status page</h1>
        <p className="mt-2 text-sm text-gray-400">
          Publish a public view of the monitors you choose. Visitors do not need a PulseIQ account.
        </p>
      </header>

      {error && (
        <div role="alert" className="rounded-lg border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {notice && (
        <div role="status" className="rounded-lg border border-emerald-900 bg-emerald-950/30 p-4 text-sm text-emerald-300">
          {notice}
        </div>
      )}

      <form onSubmit={save} className="space-y-6">
        <section className="space-y-5 rounded-xl border border-[#292929] bg-[#141414] p-6">
          <h2 className="text-lg font-medium text-white">Page details</h2>

          <label className="block text-sm text-gray-300">
            Page title
            <input
              className={inputClass}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              required
            />
          </label>

          <label className="block text-sm text-gray-300">
            Description
            <textarea
              className={inputClass}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Updates about service availability and incidents."
            />
            <span className="mt-1 block text-xs text-gray-500">
              {description.length}/500 characters
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[#303030] p-4">
            <input
              type="checkbox"
              className="mt-1 accent-emerald-500"
              checked={isPublic}
              onChange={(event) => setIsPublic(event.target.checked)}
            />
            <span>
              <span className="block text-sm font-medium text-white">Publish status page</span>
              <span className="mt-1 block text-sm text-gray-400">
                Anyone with the public URL can view the selected monitor statuses.
              </span>
            </span>
          </label>
        </section>

        <section className="rounded-xl border border-[#292929] bg-[#141414] p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium text-white">Monitors to display</h2>
              <p className="mt-1 text-sm text-gray-400">
                Choose the monitors visitors should see.
              </p>
            </div>
            <span className="text-sm text-gray-400">{selectedIds.length} selected</span>
          </div>

          {monitors.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[#333] p-5 text-sm text-gray-400">
              You have no monitors yet. Create one in{' '}
              <Link to="/uptime" className="text-emerald-400 hover:underline">
                Uptime Monitoring
              </Link>.
            </p>
          ) : (
            <div className="divide-y divide-[#292929]">
              {monitors.map((monitor) => (
                <label key={monitor.id} className="flex cursor-pointer items-center gap-3 py-4">
                  <input
                    type="checkbox"
                    className="accent-emerald-500"
                    checked={selectedIds.includes(Number(monitor.id))}
                    onChange={() => toggleMonitor(Number(monitor.id))}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-white">{monitor.name}</span>
                    <span className="mt-1 block truncate text-xs text-gray-500">{monitor.url}</span>
                  </span>
                  <span className={`text-xs ${
                    monitor.is_active === false ? 'text-gray-500' :
                    String(monitor.status || '').toUpperCase() === 'UP' ? 'text-emerald-400' :
                    String(monitor.status || '').toUpperCase() === 'DOWN' ? 'text-red-400' :
                    'text-amber-400'
                  }`}>
                    {monitor.is_active === false ? 'Paused' : monitor.status || 'Unknown'}
                  </span>
                </label>
              ))}
            </div>
          )}
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-emerald-500 px-5 py-3 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save settings'}
          </button>

          {page?.slug && (
            <button
              type="button"
              onClick={copyUrl}
              disabled={!publicUrl}
              className="rounded-lg border border-[#383838] px-5 py-3 text-sm text-white hover:bg-[#202020]"
            >
              Copy public URL
            </button>
          )}

          {page?.slug && isPublic && (
            <a
              href={publicUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-emerald-400 hover:underline"
            >
              Open public page
            </a>
          )}
        </div>

        {page?.slug && (
          <div className="rounded-lg border border-[#292929] bg-[#101010] p-4">
            <p className="text-xs text-gray-500">Your status page URL</p>
            <p className="mt-2 break-all text-sm text-gray-200">{publicUrl}</p>
            {!isPublic && (
              <p className="mt-2 text-xs text-amber-400">
                This page is currently private. Save with publishing enabled to make it accessible.
              </p>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
