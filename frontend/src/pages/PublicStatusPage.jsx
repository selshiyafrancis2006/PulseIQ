import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { API_BASE_URL } from '../config/api';

function formatDate(value) {
  if (!value) return 'No check recorded yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}

function statusStyle(status) {
  switch (String(status || '').toUpperCase()) {
    case 'UP':
    case 'OPERATIONAL':
      return 'border-emerald-900 bg-emerald-950/30 text-emerald-300';
    case 'DOWN':
    case 'ERROR':
    case 'FAILED':
    case 'DEGRADED':
      return 'border-red-900 bg-red-950/30 text-red-300';
    default:
      return 'border-amber-900 bg-amber-950/30 text-amber-300';
  }
}

function statusLabel(status) {
  switch (String(status || '').toUpperCase()) {
    case 'UP':
    case 'OPERATIONAL':
      return 'Operational';
    case 'DOWN':
    case 'ERROR':
    case 'FAILED':
      return 'Down';
    case 'DEGRADED':
      return 'Degraded';
    default:
      return 'Unknown';
  }
}

export default function PublicStatusPage() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/public/status/${encodeURIComponent(slug)}`
        );
        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(result.message || result.error || 'This status page could not be found.');
        }

        if (active) {
          setData(result);
          setError('');
        }
      } catch (err) {
        if (active) setError(err.message || 'Unable to load status.');
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    const interval = setInterval(() => void load(), 30000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [slug]);

  const overall = data?.overall_status || 'UNKNOWN';

  return (
    <div className="min-h-screen bg-[#0b0b0b] px-4 py-12 text-white sm:px-8">
      <main className="mx-auto max-w-3xl">
        <div className="mb-10 flex items-center justify-between gap-4">
          <Link to="/" className="text-xl font-bold tracking-tight text-emerald-400">
            PulseIQ
          </Link>
          <span className="text-xs uppercase tracking-widest text-gray-500">System status</span>
        </div>

        {loading ? (
          <div className="rounded-xl border border-[#292929] bg-[#141414] p-8 text-sm text-gray-400">
            Loading current status...
          </div>
        ) : error ? (
          <div role="alert" className="rounded-xl border border-red-900 bg-[#141414] p-8">
            <h1 className="text-xl font-semibold">Status page unavailable</h1>
            <p className="mt-3 text-sm text-gray-400">{error}</p>
          </div>
        ) : (
          <>
            <header className={`rounded-xl border p-6 sm:p-8 ${statusStyle(overall)}`}>
              <p className="text-xs font-semibold uppercase tracking-widest opacity-80">Current status</p>
              <h1 className="mt-3 text-3xl font-semibold">{data.title}</h1>
              {data.description && (
                <p className="mt-3 max-w-2xl text-sm leading-6 opacity-80">{data.description}</p>
              )}
              <p className="mt-6 text-lg font-medium">
                {overall === 'OPERATIONAL'
                  ? 'All selected systems are operational'
                  : overall === 'DEGRADED'
                    ? 'Some systems are experiencing issues'
                    : 'Some system statuses are unknown'}
              </p>
            </header>

            <section className="mt-8">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Monitored services</h2>
                <span className="text-xs text-gray-500">Refreshes every 30 seconds</span>
              </div>

              {data.monitors?.length ? (
                <div className="overflow-hidden rounded-xl border border-[#292929] bg-[#141414]">
                  {data.monitors.map((monitor) => (
                    <article
                      key={monitor.id}
                      className="flex flex-col gap-3 border-b border-[#292929] p-5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <h3 className="truncate font-medium text-white">{monitor.name}</h3>
                        <p className="mt-1 text-xs text-gray-500">
                          Last checked: {formatDate(monitor.checked_at)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-4">
                        {monitor.response_time_ms != null && (
                          <span className="text-sm text-gray-400">
                            {monitor.response_time_ms} ms
                          </span>
                        )}
                        <span className={`rounded-full border px-3 py-1 text-xs font-medium ${statusStyle(monitor.status)}`}>
                          {statusLabel(monitor.status)}
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="rounded-xl border border-[#292929] bg-[#141414] p-6 text-sm text-gray-400">
                  No active monitors are currently displayed on this page.
                </p>
              )}
            </section>
          </>
        )}

        <footer className="mt-12 border-t border-[#242424] pt-5 text-xs text-gray-600">
          Status updates powered by PulseIQ
        </footer>
      </main>
    </div>
  );
}
