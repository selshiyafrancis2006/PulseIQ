import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '../config/api';
import { apiFetch } from '../utils/apiFetch';
import {
  Activity,
  CheckCircle2,
  Clock3,
  Code2,
  History,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  XCircle,
} from 'lucide-react';

const API = `${API_BASE_URL}/api/api-tests`;

const NEW_STEP = {
  method: 'GET',
  url: 'https://example.com',
  headers: {},
  timeout_ms: 10000,
  assertions: { status: 200 },
};

function prettyJson(value) {
  return JSON.stringify(value ?? {}, null, 2);
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function duration(value) {
  if (value == null) return '—';
  return value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(2)} s`;
}

async function readResponse(response) {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function FieldLabel({ children }) {
  return (
    <label className="mb-2 block text-sm font-medium text-gray-300">
      {children}
    </label>
  );
}

function StatusPill({ status }) {
  const passed = status === 'passed';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
      passed
        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
        : 'border-red-500/30 bg-red-500/10 text-red-400'
    }`}>
      {passed ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
      {passed ? 'Passed' : 'Failed'}
    </span>
  );
}

export default function ApiTests() {
  const [tests, setTests] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [name, setName] = useState('');
  const [stepsText, setStepsText] = useState(prettyJson([NEW_STEP]));
  const [runs, setRuns] = useState([]);
  const [selectedRun, setSelectedRun] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isNew, setIsNew] = useState(false);

  const request = useCallback(async (path, options) => {
    const response = await apiFetch(`${API}${path}`, options);
    const data = await readResponse(response);

    if (!response.ok) {
      throw new Error(data?.error || `Request failed (${response.status})`);
    }

    return data;
  }, []);

  const loadTests = useCallback(async (preferredId) => {
    setLoading(true);
    setError('');

    try {
      const data = await request('');
      setTests(data);

      const targetId = preferredId ?? selectedId;
      const selected = data.find((test) => String(test.id) === String(targetId))
        ?? data[0]
        ?? null;

      if (selected) {
        setSelectedId(selected.id);
        setName(selected.name);
        setStepsText(prettyJson(selected.steps));
        setIsNew(false);
      } else {
        setSelectedId(null);
        setRuns([]);
        setSelectedRun(null);
        setName('');
        setStepsText(prettyJson([NEW_STEP]));
        setIsNew(false);
      }
    } catch (err) {
      setError(err.message || 'Unable to load API tests.');
    } finally {
      setLoading(false);
    }
  }, [request, selectedId]);

  const loadRuns = useCallback(async (id) => {
    if (!id) {
      setRuns([]);
      setSelectedRun(null);
      return;
    }

    try {
      const data = await request(`/${id}/runs`);
      setRuns(data);
      setSelectedRun((current) =>
        current ? data.find((run) => run.id === current.id) ?? current : null
      );
    } catch (err) {
      setError(err.message || 'Unable to load run history.');
    }
  }, [request]);

  useEffect(() => {
    loadTests();
  }, [loadTests]);

  useEffect(() => {
    if (selectedId && !isNew) loadRuns(selectedId);
    else {
      setRuns([]);
      setSelectedRun(null);
    }
  }, [selectedId, isNew, loadRuns]);

  function chooseTest(test) {
    setSelectedId(test.id);
    setName(test.name);
    setStepsText(prettyJson(test.steps));
    setIsNew(false);
    setSelectedRun(null);
    setError('');
    setNotice('');
  }

  function startNewTest() {
    setSelectedId(null);
    setName('');
    setStepsText(prettyJson([NEW_STEP]));
    setIsNew(true);
    setRuns([]);
    setSelectedRun(null);
    setError('');
    setNotice('');
  }

  function addStep() {
    try {
      const steps = JSON.parse(stepsText);
      if (!Array.isArray(steps)) throw new Error('Steps must be a JSON array.');
      if (steps.length >= 10) throw new Error('A test can contain at most 10 steps.');
      setStepsText(prettyJson([...steps, {
        ...NEW_STEP,
        url: 'https://example.com',
      }]));
      setError('');
    } catch (err) {
      setError(`Cannot add a step: ${err.message}`);
    }
  }

  async function saveTest(event) {
    event.preventDefault();
    setError('');
    setNotice('');

    let steps;
    try {
      steps = JSON.parse(stepsText);
    } catch {
      setError('Steps are not valid JSON. Check the editor and try again.');
      return;
    }

    if (!Array.isArray(steps) || steps.length < 1 || steps.length > 10) {
      setError('Steps must be a JSON array containing between 1 and 10 steps.');
      return;
    }

    if (!name.trim()) {
      setError('Enter a name for this API test.');
      return;
    }

    setSaving(true);
    try {
      const payload = { name: name.trim(), steps };
      const saved = isNew
        ? await request('', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await request(`/${selectedId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

      setNotice('API test saved.');
      setIsNew(false);
      await loadTests(saved.id);
      setSelectedId(saved.id);
    } catch (err) {
      setError(err.message || 'Unable to save this API test.');
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    if (!selectedId || isNew) {
      setError('Save this test before running it.');
      return;
    }

    setRunning(true);
    setError('');
    setNotice('');
    setSelectedRun(null);

    try {
      const result = await request(`/${selectedId}/run`, { method: 'POST' });
      setSelectedRun(result);
      setNotice(result.status === 'passed'
        ? 'All steps passed.'
        : `Test failed${result.failed_step ? ` at step ${result.failed_step}` : ''}.`);
      await loadRuns(selectedId);
      setSelectedRun(result);
    } catch (err) {
      setError(err.message || 'Unable to run this API test.');
    } finally {
      setRunning(false);
    }
  }

  async function deleteTest() {
    if (!selectedId || isNew) return;
    if (!window.confirm('Delete this API test and its associated run history?')) return;

    setError('');
    setNotice('');

    try {
      await request(`/${selectedId}`, { method: 'DELETE' });
      setNotice('API test deleted.');
      setSelectedId(null);
      await loadTests(null);
    } catch (err) {
      setError(err.message || 'Unable to delete this API test.');
    }
  }

  return (
    <div className="space-y-6 text-white">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-emerald-400">
            <Code2 size={20} />
            <span className="text-sm font-semibold uppercase tracking-wider">
              Monitoring
            </span>
          </div>
          <h1 className="text-3xl font-bold">API Tests</h1>
          <p className="mt-2 max-w-2xl text-gray-400">
            Define multi-step HTTP checks, assert responses, extract values,
            and inspect execution history.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => loadTests(selectedId)}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-200 hover:bg-white/10 disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            type="button"
            onClick={startNewTest}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-black hover:bg-emerald-400"
          >
            <Plus size={16} />
            New test
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="h-fit rounded-xl border border-white/10 bg-[#111315] p-4">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Saved tests</h2>
            <span className="rounded-md bg-white/5 px-2 py-1 text-xs text-gray-400">
              {tests.length}
            </span>
          </div>

          {loading && tests.length === 0 ? (
            <div className="flex items-center gap-2 py-8 text-sm text-gray-400">
              <LoaderCircle size={16} className="animate-spin" />
              Loading tests…
            </div>
          ) : tests.length === 0 ? (
            <div className="rounded-lg border border-dashed border-white/10 px-3 py-6 text-center">
              <Code2 size={24} className="mx-auto mb-2 text-gray-500" />
              <p className="text-sm text-gray-300">No API tests yet</p>
              <p className="mt-1 text-xs text-gray-500">
                Create a test to begin checking an endpoint.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {tests.map((test) => (
                <button
                  type="button"
                  key={test.id}
                  onClick={() => chooseTest(test)}
                  className={`w-full rounded-lg border p-3 text-left transition ${
                    !isNew && String(selectedId) === String(test.id)
                      ? 'border-emerald-500/40 bg-emerald-500/10'
                      : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.06]'
                  }`}
                >
                  <span className="block truncate text-sm font-medium text-gray-100">
                    {test.name}
                  </span>
                  <span className="mt-1 block text-xs text-gray-500">
                    {Array.isArray(test.steps) ? test.steps.length : 0} steps
                  </span>
                  <span className="mt-2 block text-xs text-gray-500">
                    Updated {formatDate(test.updated_at)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </aside>

        <div className="min-w-0 space-y-6">
          {(error || notice) && (
            <div className={`rounded-lg border px-4 py-3 text-sm ${
              error
                ? 'border-red-500/30 bg-red-500/10 text-red-300'
                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
            }`}>
              {error || notice}
            </div>
          )}

          <form
            onSubmit={saveTest}
            className="space-y-5 rounded-xl border border-white/10 bg-[#111315] p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">
                  {isNew ? 'Create API test' : name || 'Test configuration'}
                </h2>
                <p className="mt-1 text-sm text-gray-400">
                  Configure each request as a JSON step definition.
                </p>
              </div>
              <span className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-gray-400">
                {isNew ? 'Unsaved' : `Test #${selectedId ?? '—'}`}
              </span>
            </div>

            <div>
              <FieldLabel>Test name</FieldLabel>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={100}
                required
                placeholder="e.g. Public API availability"
                className="w-full rounded-lg border border-white/10 bg-[#090a0b] px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <FieldLabel>Steps definition (JSON)</FieldLabel>
                <button
                  type="button"
                  onClick={addStep}
                  className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-white/5"
                >
                  <Plus size={14} />
                  Add step
                </button>
              </div>
              <textarea
                value={stepsText}
                onChange={(event) => setStepsText(event.target.value)}
                spellCheck={false}
                rows={18}
                required
                className="w-full resize-y rounded-lg border border-white/10 bg-[#090a0b] p-4 font-mono text-sm leading-6 text-emerald-100 outline-none focus:border-emerald-500"
                aria-label="API test steps JSON"
              />
              <p className="mt-2 text-xs leading-5 text-gray-500">
                Up to 10 steps. Supported fields include method, url, headers,
                body, timeout_ms, assertions.status, assertions.body, and extract.
                Use <code className="text-gray-300">{'{{variableName}}'}</code> to
                reuse values extracted by earlier steps.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
              <div className="flex gap-2">
                {!isNew && (
                  <button
                    type="button"
                    onClick={deleteTest}
                    className="inline-flex items-center gap-2 rounded-lg border border-red-500/20 px-3 py-2 text-sm text-red-300 hover:bg-red-500/10"
                  >
                    <Trash2 size={15} />
                    Delete
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium hover:bg-white/10 disabled:opacity-50"
                >
                  {saving
                    ? <LoaderCircle size={16} className="animate-spin" />
                    : <Save size={16} />}
                  {saving ? 'Saving…' : 'Save test'}
                </button>
                <button
                  type="button"
                  onClick={runTest}
                  disabled={running || isNew || !selectedId}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-black hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {running
                    ? <LoaderCircle size={16} className="animate-spin" />
                    : <Play size={16} />}
                  {running ? 'Running…' : 'Run test'}
                </button>
              </div>
            </div>
          </form>

          {selectedRun && (
            <section className="space-y-4 rounded-xl border border-white/10 bg-[#111315] p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Execution results</h2>
                  <p className="mt-1 text-xs text-gray-500">
                    Run #{selectedRun.id} · {formatDate(selectedRun.started_at)}
                  </p>
                </div>
                <StatusPill status={selectedRun.status} />
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-white/5 bg-white/[0.03] p-3">
                  <p className="text-xs text-gray-500">Total duration</p>
                  <p className="mt-1 text-lg font-semibold">
                    {duration(selectedRun.duration_ms)}
                  </p>
                </div>
                <div className="rounded-lg border border-white/5 bg-white/[0.03] p-3">
                  <p className="text-xs text-gray-500">Steps executed</p>
                  <p className="mt-1 text-lg font-semibold">
                    {Array.isArray(selectedRun.results) ? selectedRun.results.length : 0}
                  </p>
                </div>
                <div className="col-span-2 rounded-lg border border-white/5 bg-white/[0.03] p-3 sm:col-span-1">
                  <p className="text-xs text-gray-500">Finished</p>
                  <p className="mt-1 text-sm font-medium">
                    {formatDate(selectedRun.finished_at)}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                {Array.isArray(selectedRun.results) && selectedRun.results.map((result, index) => (
                  <div key={`${selectedRun.id}-${index}`} className="rounded-lg border border-white/10 bg-[#090a0b] p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {result.passed
                          ? <CheckCircle2 size={17} className="text-emerald-400" />
                          : <XCircle size={17} className="text-red-400" />}
                        <span className="text-sm font-semibold">
                          Step {result.step ?? index + 1}
                        </span>
                        {result.method && (
                          <span className="rounded bg-white/5 px-2 py-1 font-mono text-xs text-gray-300">
                            {result.method}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-gray-500">
                        {duration(result.duration_ms)}
                      </span>
                    </div>
                    {result.url && (
                      <p className="mb-3 break-all font-mono text-xs text-gray-400">
                        {result.url}
                      </p>
                    )}
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/30 p-3 text-xs leading-5 text-gray-300">
                      {prettyJson(result)}
                    </pre>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="rounded-xl border border-white/10 bg-[#111315] p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <History size={18} className="text-emerald-400" />
                  <h2 className="text-lg font-semibold">Run history</h2>
                </div>
                <p className="mt-1 text-sm text-gray-400">
                  Select a previous execution to inspect its recorded results.
                </p>
              </div>
              {selectedId && !isNew && (
                <button
                  type="button"
                  onClick={() => loadRuns(selectedId)}
                  className="inline-flex items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-xs text-gray-300 hover:bg-white/5"
                >
                  <RefreshCw size={14} />
                  Refresh history
                </button>
              )}
            </div>

            {!selectedId || isNew ? (
              <p className="py-6 text-center text-sm text-gray-500">
                Save a test to view its run history.
              </p>
            ) : runs.length === 0 ? (
              <div className="py-8 text-center">
                <Clock3 size={24} className="mx-auto mb-2 text-gray-500" />
                <p className="text-sm text-gray-300">No runs recorded yet</p>
                <p className="mt-1 text-xs text-gray-500">
                  Run this test to create its first execution record.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-sm">
                  <thead className="border-b border-white/10 text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-3 py-3 font-medium">Result</th>
                      <th className="px-3 py-3 font-medium">Started</th>
                      <th className="px-3 py-3 font-medium">Duration</th>
                      <th className="px-3 py-3 font-medium">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {runs.map((run) => (
                      <tr key={run.id} className="text-gray-300">
                        <td className="px-3 py-3">
                          <StatusPill status={run.status} />
                        </td>
                        <td className="px-3 py-3 text-xs text-gray-400">
                          {formatDate(run.started_at)}
                        </td>
                        <td className="px-3 py-3 text-xs">
                          {duration(run.duration_ms)}
                        </td>
                        <td className="px-3 py-3">
                          <button
                            type="button"
                            onClick={() => setSelectedRun(run)}
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300"
                          >
                            <Activity size={14} />
                            Inspect
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
