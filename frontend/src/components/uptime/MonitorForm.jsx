import { useState } from 'react';

const RENOTIFY_OPTIONS = [
  { value: 0, label: 'Never (only the first alert)' },
  { value: 15, label: 'Every 15 minutes' },
  { value: 30, label: 'Every 30 minutes' },
  { value: 60, label: 'Every hour' },
  { value: 180, label: 'Every 3 hours' },
  { value: 360, label: 'Every 6 hours' },
  { value: 720, label: 'Every 12 hours' },
  { value: 1440, label: 'Every 24 hours' },
];

const EMPTY_FORM = {
  name: '',
  url: '',
  tags: '',
  interval_seconds: 30,
  renotify_minutes: 60,
};

const NUMERIC_FIELDS = ['interval_seconds', 'renotify_minutes'];

function MonitorForm({ monitor, saving, onSubmit, onCancel }) {
  const [form, setForm] = useState(() => monitor ? {
    name: monitor.name || '',
    url: monitor.url || '',
    tags: Array.isArray(monitor.tags) ? monitor.tags.join(', ') : '',
    interval_seconds: monitor.interval_seconds ?? 30,
    renotify_minutes: monitor.renotify_minutes ?? 60,
  } : { ...EMPTY_FORM });
  const [error, setError] = useState('');

  // A value set through the API may not be one of the presets;
  // keep it selectable so editing never silently changes it.
  const renotifyOptions = RENOTIFY_OPTIONS.some(
    (option) => option.value === form.renotify_minutes
  )
    ? RENOTIFY_OPTIONS
    : [
        ...RENOTIFY_OPTIONS,
        {
          value: form.renotify_minutes,
          label: `Every ${form.renotify_minutes} minutes`,
        },
      ].sort((a, b) => a.value - b.value);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: NUMERIC_FIELDS.includes(name) ? Number(value) : value,
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    const name = form.name.trim();
    const url = form.url.trim();

    if (!name || name.length > 255) {
      setError('Enter a monitor name of up to 255 characters.');
      return;
    }

    if (!url || url.length > 500) {
      setError('Enter a URL of up to 500 characters.');
      return;
    }

    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol) ||
          parsed.username || parsed.password) {
        setError('Use an HTTP or HTTPS URL without embedded credentials.');
        return;
      }
    } catch {
      setError('Enter a valid HTTP or HTTPS URL.');
      return;
    }

    if (!Number.isInteger(form.interval_seconds) ||
        form.interval_seconds < 30 || form.interval_seconds > 3600) {
      setError('Check interval must be between 30 and 3600 seconds.');
      return;
    }

    if (!Number.isInteger(form.renotify_minutes) ||
        (form.renotify_minutes !== 0 &&
          (form.renotify_minutes < 5 || form.renotify_minutes > 1440))) {
      setError('Re-notify interval must be off, or between 5 and 1440 minutes.');
      return;
    }

    const tags = form.tags.split(',').map((tag) => tag.trim()).filter(Boolean);
    if (tags.length > 20 || tags.some((tag) => tag.length > 50)) {
      setError('Use at most 20 tags, each up to 50 characters.');
      return;
    }

    const payload = {
      name,
      url,
      tags: [...new Set(tags)],
      interval_seconds: form.interval_seconds,
      renotify_minutes: form.renotify_minutes,
    };

    try {
      await onSubmit(payload);
    } catch (submitError) {
      setError(submitError.message || 'Failed to save monitor.');
    }
  };

  const inputClass = 'w-full rounded-lg border border-[#303030] bg-[#0f0f0f] px-3 py-2.5 text-white outline-none focus:border-emerald-500';
  const labelClass = 'mb-1.5 block text-sm text-gray-300';

  return (
    <div className="mb-6 rounded-xl border border-[#2a2a2a] bg-[#171717] p-5">
      <h2 className="mb-4 text-lg font-semibold">
        {monitor ? 'Edit Monitor' : 'Add Monitor'}
      </h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className={labelClass} htmlFor="monitor-name">Name</label>
          <input
            id="monitor-name"
            name="name"
            value={form.name}
            onChange={handleChange}
            maxLength={255}
            required
            className={inputClass}
            placeholder="Production API"
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="monitor-url">URL</label>
          <input
            id="monitor-url"
            name="url"
            type="url"
            value={form.url}
            onChange={handleChange}
            maxLength={500}
            required
            className={inputClass}
            placeholder="https://example.com/health"
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="monitor-tags">Tags</label>
          <input
            id="monitor-tags"
            name="tags"
            value={form.tags}
            onChange={handleChange}
            className={inputClass}
            placeholder="env:prod, team:backend"
          />
          <p className="mt-1 text-xs text-gray-500">Separate tags with commas.</p>
        </div>

        <div>
          <label className={labelClass} htmlFor="monitor-interval">
            Check interval
          </label>
          <select
            id="monitor-interval"
            name="interval_seconds"
            value={form.interval_seconds}
            onChange={handleChange}
            className={inputClass}
          >
            <option value={30}>Every 30 seconds</option>
            <option value={60}>Every 1 minute</option>
            <option value={120}>Every 2 minutes</option>
            <option value={300}>Every 5 minutes</option>
            <option value={600}>Every 10 minutes</option>
            <option value={1800}>Every 30 minutes</option>
            <option value={3600}>Every 60 minutes</option>
          </select>
          <p className="mt-1 text-xs text-gray-500">
            Allowed range: 30–3600 seconds.
          </p>
        </div>

        <div>
          <label className={labelClass} htmlFor="monitor-renotify">
            Re-notify while down
          </label>
          <select
            id="monitor-renotify"
            name="renotify_minutes"
            value={form.renotify_minutes}
            onChange={handleChange}
            className={inputClass}
          >
            {renotifyOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">
            Send a reminder to your notification channels if the monitor
            stays down.
          </p>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-400">{error}</p>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-emerald-600 px-4 py-2.5 font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving...' : monitor ? 'Save Changes' : 'Create Monitor'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-lg border border-[#363636] px-4 py-2.5 text-gray-300 hover:bg-[#222] disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

export default MonitorForm;