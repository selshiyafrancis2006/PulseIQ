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
  monitor_type: 'HTTP',
  url: '',
  tcp_host: '',
  tcp_port: 443,
  dns_hostname: '',
  dns_record_type: 'A',
  dnsExpectedValuesText: '',
  tags: '',
  interval_seconds: 30,
  renotify_minutes: 60,
  failure_threshold: 3,
  heartbeat_grace_seconds: 60,
  method: 'GET',
  headersText: '{}',
  body: '',
  timeout_ms: 10000,
  expected_status_codes: '',
  expected_keyword: '',
  max_response_time_ms: '',
  slo_target_percent: 99.9,
  slo_window_days: 30,
};

const NUMERIC_FIELDS = [
  'interval_seconds',
  'renotify_minutes',
  'tcp_port',
  'failure_threshold',
  'heartbeat_grace_seconds',
  'timeout_ms',
  'slo_target_percent',
  'slo_window_days',
];

function MonitorForm({ monitor, saving, onSubmit, onCancel }) {
  const [form, setForm] = useState(() => monitor ? {
    name: monitor.name || '',
    monitor_type: monitor.monitor_type || 'HTTP',
    url: monitor.url || '',
    tcp_host: monitor.tcp_host || '',
    tcp_port: monitor.tcp_port ?? 443,
    dns_hostname: monitor.dns_hostname || '',
    dns_record_type: monitor.dns_record_type || 'A',
    dnsExpectedValuesText: Array.isArray(monitor.dns_expected_values) ? monitor.dns_expected_values.join('\n') : '',
    tags: Array.isArray(monitor.tags) ? monitor.tags.join(', ') : '',
    interval_seconds: monitor.interval_seconds ?? 30,
    renotify_minutes: monitor.renotify_minutes ?? 60,
    failure_threshold: monitor.failure_threshold ?? 3,
    heartbeat_grace_seconds: monitor.heartbeat_grace_seconds ?? 60,
    method: monitor.method || 'GET',
    headersText: JSON.stringify(
      monitor.headers && typeof monitor.headers === 'object' &&
      !Array.isArray(monitor.headers) ? monitor.headers : {},
      null,
      2
    ),
    body: monitor.body ?? '',
    timeout_ms: monitor.timeout_ms ?? 10000,
    expected_status_codes: Array.isArray(monitor.expected_status_codes)
      ? monitor.expected_status_codes.join(', ')
      : '',
    expected_keyword: monitor.expected_keyword ?? '',
    max_response_time_ms: monitor.max_response_time_ms ?? '',
    slo_target_percent: monitor.slo_target_percent ?? 99.9,
    slo_window_days: monitor.slo_window_days ?? 30,
  } : { ...EMPTY_FORM });
  const [error, setError] = useState('');

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
    const monitorType = form.monitor_type;
    const url = form.url.trim();
    const tcpHost = form.tcp_host.trim();
    const dnsHostname = form.dns_hostname.trim();

    if (!name || name.length > 255) {
      setError('Enter a monitor name of up to 255 characters.');
      return;
    }

    if (monitorType === 'HTTP') {
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
    } else if (monitorType === 'TCP') {
      if (!tcpHost || tcpHost.length > 253) {
        setError('Enter a hostname or IP address of up to 253 characters.');
        return;
      }

      if (!Number.isInteger(form.tcp_port) ||
          form.tcp_port < 1 || form.tcp_port > 65535) {
        setError('TCP port must be an integer between 1 and 65535.');
        return;
      }

      if (!Number.isInteger(form.timeout_ms) ||
          form.timeout_ms < 1000 || form.timeout_ms > 30000) {
        setError('TCP timeout must be between 1000 and 30000 milliseconds.');
        return;
      }
    } else if (monitorType === 'DNS') {
      if (!dnsHostname || dnsHostname.length > 253) {
        setError('Enter a DNS hostname of up to 253 characters.');
        return;
      }

      if (!/^(A|AAAA|CNAME|MX|TXT|NS)$/.test(form.dns_record_type)) {
        setError('Choose a supported DNS record type.');
        return;
      }
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

    if (!Number.isInteger(form.failure_threshold) ||
        form.failure_threshold < 1 || form.failure_threshold > 10) {
      setError('Failure threshold must be an integer between 1 and 10.');
      return;
    }

    if (monitorType === 'HEARTBEAT' &&
        (!Number.isInteger(form.heartbeat_grace_seconds) ||
          form.heartbeat_grace_seconds < 0 || form.heartbeat_grace_seconds > 86400)) {
      setError('Heartbeat grace period must be an integer between 0 and 86400 seconds.');
      return;
    }

    if (
      !Number.isFinite(form.slo_target_percent) ||
      form.slo_target_percent < 90 ||
      form.slo_target_percent > 100 ||
      Math.abs(form.slo_target_percent * 100 - Math.round(form.slo_target_percent * 100)) > 1e-8
    ) {
      setError('SLO target must be between 90 and 100 with at most 2 decimal places.');
      return;
    }

    if (!Number.isInteger(form.slo_window_days) || form.slo_window_days < 1 || form.slo_window_days > 365) {
      setError('SLO window must be an integer between 1 and 365 days.');
      return;
    }

    let httpHeaders = {};

    if (monitorType === 'HTTP') {
      const allowedMethods = [
        'GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS',
      ];

      if (!allowedMethods.includes(form.method)) {
        setError('Choose a supported HTTP method.');
        return;
      }

      try {
        httpHeaders = JSON.parse(form.headersText || '{}');
      } catch {
        setError('Headers must contain valid JSON.');
        return;
      }

      if (
        !httpHeaders ||
        typeof httpHeaders !== 'object' ||
        Array.isArray(httpHeaders)
      ) {
        setError('Headers must be a JSON object.');
        return;
      }

      const headerEntries = Object.entries(httpHeaders);
      const forbiddenHeaders = new Set([
        'host', 'content-length', 'connection', 'transfer-encoding',
        'proxy-authorization', 'proxy-connection', 'upgrade',
      ]);
      const headerNamePattern = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

      if (headerEntries.length > 50) {
        setError('Use no more than 50 HTTP headers.');
        return;
      }

      for (const [key, value] of headerEntries) {
        if (
          !key ||
          key.length > 100 ||
          !headerNamePattern.test(key) ||
          forbiddenHeaders.has(key.toLowerCase())
        ) {
          setError(`Invalid or restricted HTTP header name: ${key}`);
          return;
        }

        if (
          typeof value !== 'string' ||
          value.length > 8192 ||
          /[\r\n]/.test(value)
        ) {
          setError(`Invalid value for HTTP header: ${key}`);
          return;
        }
      }

      if (
        !Number.isInteger(form.timeout_ms) ||
        form.timeout_ms < 1 ||
        form.timeout_ms > 30000
      ) {
        setError('HTTP timeout must be between 1 and 30000 milliseconds.');
        return;
      }

      if (new TextEncoder().encode(form.body).length > 1000000) {
        setError('HTTP request body cannot exceed 1 MB.');
        return;
      }

      const statusCodesText = form.expected_status_codes.trim();
      if (statusCodesText) {
        const statusCodes = statusCodesText.split(',').map(
          (code) => Number(code.trim())
        );

        if (
          statusCodes.length > 20 ||
          statusCodes.some(
            (code) => !Number.isInteger(code) || code < 100 || code > 599
          ) ||
          new Set(statusCodes).size !== statusCodes.length
        ) {
          setError('Expected status codes must be 1â€“20 unique codes between 100 and 599.');
          return;
        }
      }

      if (
        form.expected_keyword.trim().length > 500
      ) {
        setError('Expected keyword cannot exceed 500 characters.');
        return;
      }

      if (form.max_response_time_ms !== '') {
        const maxResponseTime = Number(form.max_response_time_ms);

        if (
          !Number.isInteger(maxResponseTime) ||
          maxResponseTime < 1 ||
          maxResponseTime > 30000
        ) {
          setError('Maximum response time must be between 1 and 30000 milliseconds.');
          return;
        }
      }
    }

    const tags = form.tags.split(',').map((tag) => tag.trim()).filter(Boolean);
    if (tags.length > 20 || tags.some((tag) => tag.length > 50)) {
      setError('Use at most 20 tags, each up to 50 characters.');
      return;
    }

    const payload = {
      name,
      monitor_type: monitorType,
      tags: [...new Set(tags)],
      interval_seconds: form.interval_seconds,
      renotify_minutes: form.renotify_minutes,
      failure_threshold: form.failure_threshold,
      slo_target_percent: form.slo_target_percent,
      slo_window_days: form.slo_window_days,
    };

    if (monitorType === 'HTTP') {
      const statusCodesText = form.expected_status_codes.trim();

      payload.url = url;
      payload.method = form.method;
      payload.headers = httpHeaders;
      payload.body = form.body === '' ? null : form.body;
      payload.timeout_ms = form.timeout_ms;
      payload.expected_status_codes = statusCodesText
        ? statusCodesText.split(',').map((code) => Number(code.trim()))
        : null;
      payload.expected_keyword = form.expected_keyword.trim() || null;
      payload.max_response_time_ms = form.max_response_time_ms === ''
        ? null
        : Number(form.max_response_time_ms);
    } else if (monitorType === 'TCP') {
      payload.tcp_host = tcpHost;
      payload.tcp_port = form.tcp_port;
      payload.timeout_ms = form.timeout_ms;
    } else if (monitorType === 'DNS') {
      payload.dns_hostname = dnsHostname;
      payload.dns_record_type = form.dns_record_type;
      payload.dns_expected_values = form.dnsExpectedValuesText
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean);
    } else if (monitorType === 'HEARTBEAT') {
      payload.heartbeat_grace_seconds = form.heartbeat_grace_seconds;
    }

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
          <label className={labelClass} htmlFor="monitor-type">Monitor type</label>
          <select
            id="monitor-type"
            name="monitor_type"
            value={form.monitor_type}
            onChange={handleChange}
            disabled={Boolean(monitor)}
            className={`${inputClass} disabled:cursor-not-allowed disabled:opacity-70`}
          >
            <option value="HTTP">HTTP / HTTPS</option>
            <option value="TCP">TCP port</option>
            <option value="DNS">DNS lookup</option>
            <option value="HEARTBEAT">Heartbeat (push check-in)</option>
          </select>
          {monitor && (
            <p className="mt-1 text-xs text-gray-500">
              Monitor type cannot be changed after creation.
            </p>
          )}
        </div>

        {form.monitor_type === 'HEARTBEAT' ? (
          <>
            <div className="rounded-lg border border-[#303030] bg-[#111] p-3 text-sm text-gray-300">
              Create this monitor, then configure your service or scheduled job to send a check-in using its generated token. If a check-in is missed beyond the configured deadline, the monitor will go DOWN.
            </div>
            <div>
              <label className={labelClass} htmlFor="heartbeat-grace-seconds">
                Heartbeat grace period (seconds)
              </label>
              <input
                id="heartbeat-grace-seconds"
                name="heartbeat_grace_seconds"
                type="number"
                min={0}
                max={86400}
                step={1}
                value={form.heartbeat_grace_seconds}
                onChange={handleChange}
                required
                className={inputClass}
              />
              <p className="mt-1 text-xs text-gray-500">
                Extra time allowed after the check-in interval before this monitor is marked DOWN. Set to 0 for no extra grace.
              </p>
            </div>
          </>
        ) : form.monitor_type === 'HTTP' ? (
          <>
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
              <label className={labelClass} htmlFor="monitor-method">HTTP method</label>
              <select
                id="monitor-method"
                name="method"
                value={form.method}
                onChange={handleChange}
                className={inputClass}
              >
                {['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].map((method) => (
                  <option key={method} value={method}>{method}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass} htmlFor="monitor-headers">
                Request headers (JSON)
              </label>
              <textarea
                id="monitor-headers"
                name="headersText"
                value={form.headersText}
                onChange={handleChange}
                rows={4}
                spellCheck={false}
                className={inputClass}
                placeholder={'{\n  "Authorization": "Bearer token"\n}'}
              />
              <p className="mt-1 text-xs text-gray-500">
                Optional JSON object. Maximum 50 headers.
              </p>
            </div>

            <div>
              <label className={labelClass} htmlFor="monitor-body">
                Request body
              </label>
              <textarea
                id="monitor-body"
                name="body"
                value={form.body}
                onChange={handleChange}
                rows={4}
                className={inputClass}
                placeholder="Optional request body for POST, PUT or PATCH."
              />
              <p className="mt-1 text-xs text-gray-500">
                Leave empty to send no request body. Maximum 1 MB.
              </p>
            </div>

            <div>
              <label className={labelClass} htmlFor="monitor-timeout">
                Request timeout (milliseconds)
              </label>
              <input
                id="monitor-timeout"
                name="timeout_ms"
                type="number"
                min={1}
                max={30000}
                step={1}
                value={form.timeout_ms}
                onChange={handleChange}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-gray-500">
                Allowed range: 1â€“30000 milliseconds.
              </p>
            </div>

            <div>
              <label className={labelClass} htmlFor="monitor-status-codes">
                Expected status codes
              </label>
              <input
                id="monitor-status-codes"
                name="expected_status_codes"
                value={form.expected_status_codes}
                onChange={handleChange}
                className={inputClass}
                placeholder="200, 201, 204"
              />
              <p className="mt-1 text-xs text-gray-500">
                Comma-separated. Leave empty to accept the default 200â€“399 range.
              </p>
            </div>

            <div>
              <label className={labelClass} htmlFor="monitor-keyword">
                Expected response keyword
              </label>
              <input
                id="monitor-keyword"
                name="expected_keyword"
                value={form.expected_keyword}
                onChange={handleChange}
                maxLength={500}
                className={inputClass}
                placeholder="healthy"
              />
              <p className="mt-1 text-xs text-gray-500">
                The response body must contain this text, ignoring case.
              </p>
            </div>

            <div>
              <label className={labelClass} htmlFor="monitor-max-response">
                Maximum response time (milliseconds)
              </label>
              <input
                id="monitor-max-response"
                name="max_response_time_ms"
                type="number"
                min={1}
                max={30000}
                step={1}
                value={form.max_response_time_ms}
                onChange={handleChange}
                className={inputClass}
                placeholder="No limit"
              />
              <p className="mt-1 text-xs text-gray-500">
                Leave empty for no response-time limit.
              </p>
            </div>
          </>
        ) : form.monitor_type === 'TCP' ? (
          <>
            <div>
              <label className={labelClass} htmlFor="monitor-tcp-host">
                Hostname or IP address
              </label>
              <input
                id="monitor-tcp-host"
                name="tcp_host"
                type="text"
                value={form.tcp_host}
                onChange={handleChange}
                maxLength={253}
                required
                className={inputClass}
                placeholder="db.example.com"
              />
              <p className="mt-1 text-xs text-gray-500">
                Use a public hostname or IP address.
              </p>
            </div>

            <div>
              <label className={labelClass} htmlFor="monitor-tcp-port">TCP port</label>
              <input
                id="monitor-tcp-port"
                name="tcp_port"
                type="number"
                min={1}
                max={65535}
                step={1}
                value={form.tcp_port}
                onChange={handleChange}
                required
                className={inputClass}
                placeholder="443"
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="monitor-tcp-timeout">
                TCP timeout (milliseconds)
              </label>
              <input
                id="monitor-tcp-timeout"
                name="timeout_ms"
                type="number"
                min={1000}
                max={30000}
                step={1}
                value={form.timeout_ms}
                onChange={handleChange}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-gray-500">
                Allowed range: 1000–30000 milliseconds.
              </p>
            </div>
          </>
        ) : (
          <>
            <div>
              <label className={labelClass} htmlFor="monitor-dns-hostname">
                DNS hostname
              </label>
              <input
                id="monitor-dns-hostname"
                name="dns_hostname"
                type="text"
                value={form.dns_hostname}
                onChange={handleChange}
                maxLength={253}
                required
                className={inputClass}
                placeholder="example.com"
              />
              <p className="mt-1 text-xs text-gray-500">
                Enter a public DNS hostname, not a URL or IP address.
              </p>
            </div>

            <div>
              <label className={labelClass} htmlFor="monitor-dns-record-type">
                DNS record type
              </label>
              <select
                id="monitor-dns-record-type"
                name="dns_record_type"
                value={form.dns_record_type}
                onChange={handleChange}
                required
                className={inputClass}
              >
                <option value="A">A - IPv4 address</option>
                <option value="AAAA">AAAA - IPv6 address</option>
                <option value="CNAME">CNAME - Canonical name</option>
                <option value="MX">MX - Mail server</option>
                <option value="TXT">TXT - Text record</option>
                <option value="NS">NS - Name server</option>
              </select>
            </div>

            <div>
              <label className={labelClass} htmlFor="monitor-dns-expected-values">
                Expected DNS values (optional)
              </label>
              <textarea
                id="monitor-dns-expected-values"
                name="dnsExpectedValuesText"
                value={form.dnsExpectedValuesText}
                onChange={handleChange}
                rows={4}
                maxLength={20480}
                className={inputClass}
                placeholder="One expected value per line"
              />
              <p className="mt-1 text-xs text-gray-500">
                Every listed value must appear in the DNS response. For MX, use priority followed by hostname (for example: 10 mail.example.com).
              </p>
            </div>
          </>
        )}

        <div className="rounded-lg border border-[#303030] bg-[#111] p-4">
          <h3 className="mb-3 text-sm font-semibold text-white">Service Level Objective (SLO)</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="monitor-slo-target">SLO target (%)</label>
              <input id="monitor-slo-target" name="slo_target_percent" type="number" min={90} max={100} step={0.01} value={form.slo_target_percent} onChange={handleChange} required className={inputClass} />
              <p className="mt-1 text-xs text-gray-500">Allowed range: 90â€“100%, up to 2 decimal places.</p>
            </div>
            <div>
              <label className={labelClass} htmlFor="monitor-slo-window">SLO window (days)</label>
              <input id="monitor-slo-window" name="slo_window_days" type="number" min={1} max={365} step={1} value={form.slo_window_days} onChange={handleChange} required className={inputClass} />
              <p className="mt-1 text-xs text-gray-500">Rolling measurement window: 1â€“365 days.</p>
            </div>
          </div>
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
            Allowed range: 30-3600 seconds.
          </p>
        </div>

        <div>
          <label className={labelClass} htmlFor="monitor-failure-threshold">
            Consecutive failures before DOWN
          </label>
          <input
            id="monitor-failure-threshold"
            name="failure_threshold"
            type="number"
            min={1}
            max={10}
            step={1}
            value={form.failure_threshold}
            onChange={handleChange}
            required
            className={inputClass}
          />
          <p className="mt-1 text-xs text-gray-500">
            The monitor is marked DOWN only after this many consecutive failed checks (1â€“10).
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
