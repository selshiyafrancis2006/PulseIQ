# PulseIQ APM steps 3 and 4 - run from the repo root (the folder containing backend\ and frontend\)
$ErrorActionPreference = 'Stop'
if (-not ((Test-Path 'backend') -and (Test-Path 'frontend'))) { throw 'Run this from the PulseIQ repo root.' }
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Write-RepoFile([string]$Path, [string]$Content) {
  $full = Join-Path (Get-Location) $Path
  New-Item -ItemType Directory -Force -Path (Split-Path $full) | Out-Null
  [System.IO.File]::WriteAllText($full, $Content.Replace("`r`n", "`n"), $utf8)
  Write-Host "wrote $Path"
}

Write-RepoFile 'backend/src/controllers/apm.controller.js' @'
const apmService = require('../services/apm.service');
const { resolveApmRange, APM_RANGES } = require('../utils/apmRange');

// Shared request checks. Returns { hostId, range } or null once it has
// already sent the error response.
const parseRequest = async (req, res, { needsRange }) => {

    const hostId = req.query.host_id;

    if (!hostId) {
        res.status(400).json({ error: 'host_id is required' });
        return null;
    }

    let range = null;

    if (needsRange) {
        range = resolveApmRange(req.query.range);

        if (!range) {
            res.status(400).json({
                error: `range must be one of: ${Object.keys(APM_RANGES).join(', ')}`
            });
            return null;
        }
    }

    const owns = await apmService.verifyHostOwnership(hostId, req.user.id);

    if (!owns) {
        res.status(404).json({ error: 'Host not found' });
        return null;
    }

    return { hostId, range };
};

const getTraces = async (req, res) => {
    try {

        const parsed = await parseRequest(req, res, { needsRange: false });
        if (!parsed) return;

        const traces = await apmService.fetchTraces(parsed.hostId);

        res.json(traces);

    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: 'Failed to fetch traces'
        });
    }
};

const getRouteSummary = async (req, res) => {
    try {

        const parsed = await parseRequest(req, res, { needsRange: true });
        if (!parsed) return;

        const summary = await apmService.fetchRouteSummary(
            parsed.hostId,
            parsed.range.seconds
        );

        res.json(summary);

    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: 'Failed to fetch route summary'
        });
    }
};

const getOverview = async (req, res) => {
    try {

        const parsed = await parseRequest(req, res, { needsRange: true });
        if (!parsed) return;

        const overview = await apmService.fetchOverview(
            parsed.hostId,
            parsed.range.seconds
        );

        res.json({ range: parsed.range.key, ...overview });

    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: 'Failed to fetch APM overview'
        });
    }
};

const getTimeSeries = async (req, res) => {
    try {

        const parsed = await parseRequest(req, res, { needsRange: true });
        if (!parsed) return;

        const points = await apmService.fetchTimeSeries(
            parsed.hostId,
            parsed.range.seconds,
            parsed.range.bucketSeconds
        );

        res.json({
            range: parsed.range.key,
            bucket_seconds: parsed.range.bucketSeconds,
            points
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: 'Failed to fetch APM time series'
        });
    }
};

module.exports = {
    getTraces,
    getRouteSummary,
    getOverview,
    getTimeSeries
};
'@

Write-RepoFile 'backend/src/routes/apm.routes.js' @'
const express = require('express');
const router = express.Router();

const {
    getTraces,
    getRouteSummary,
    getOverview,
    getTimeSeries
} = require('../controllers/apm.controller');

router.get('/traces', getTraces);
router.get('/traces/summary', getRouteSummary);
router.get('/traces/overview', getOverview);
router.get('/traces/timeseries', getTimeSeries);

module.exports = router;
'@

Write-RepoFile 'backend/src/services/apm.service.js' @'
const pool = require('../config/db');

const verifyHostOwnership = async (hostId, userId) => {

    const result = await pool.query(
        'SELECT id FROM hosts WHERE id = $1 AND user_id = $2',
        [hostId, userId]
    );

    return result.rows.length > 0;
};

const fetchTraces = async (hostId, limit = 100) => {

    const result = await pool.query(
        `SELECT id, method, route, status_code, duration_ms, timestamp
         FROM traces
         WHERE host_id = $1
         ORDER BY timestamp DESC
         LIMIT $2`,
        [hostId, limit]
    );

    return result.rows;
};

// pg returns numeric / bigint columns as strings; the API sends numbers.
const toNumber = (value) => (value === null || value === undefined ? null : Number(value));

// Error rate counts server errors (5xx) only: a 404 or 401 is the client's
// problem, not the service failing. Client errors are reported separately.
// Aggregates shared by the per-route summary, the overview and the series.
const LATENCY_AND_ERROR_COLUMNS = `
    COUNT(*) AS request_count,
    ROUND(AVG(duration_ms)::numeric, 1) AS avg_duration_ms,
    MAX(duration_ms) AS max_duration_ms,
    ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms))::numeric, 1) AS p50_duration_ms,
    ROUND((percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms))::numeric, 1) AS p95_duration_ms,
    ROUND((percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms))::numeric, 1) AS p99_duration_ms,
    COUNT(*) FILTER (WHERE status_code >= 500) AS error_count,
    COUNT(*) FILTER (WHERE status_code >= 400 AND status_code < 500) AS client_error_count,
    ROUND(100.0 * COUNT(*) FILTER (WHERE status_code >= 500) / NULLIF(COUNT(*), 0), 2) AS error_rate`;

const normalizeStats = (row) => ({
    request_count: toNumber(row.request_count),
    avg_duration_ms: toNumber(row.avg_duration_ms),
    max_duration_ms: toNumber(row.max_duration_ms),
    p50_duration_ms: toNumber(row.p50_duration_ms),
    p95_duration_ms: toNumber(row.p95_duration_ms),
    p99_duration_ms: toNumber(row.p99_duration_ms),
    error_count: toNumber(row.error_count),
    client_error_count: toNumber(row.client_error_count),
    error_rate: toNumber(row.error_rate)
});

// Per-route latency percentiles and error rate over the last `rangeSeconds`.
// Slowest routes (by p95) come first.
const fetchRouteSummary = async (hostId, rangeSeconds = 3600) => {

    const result = await pool.query(
        `SELECT
            method,
            route,
            ${LATENCY_AND_ERROR_COLUMNS}
         FROM traces
         WHERE host_id = $1
           AND timestamp >= NOW() - make_interval(secs => $2::double precision)
         GROUP BY method, route
         ORDER BY p95_duration_ms DESC NULLS LAST, request_count DESC`,
        [hostId, rangeSeconds]
    );

    return result.rows.map((row) => ({
        method: row.method,
        route: row.route,
        ...normalizeStats(row)
    }));
};

// Host-wide totals for the range. Percentiles cannot be rebuilt from the
// per-route rows, so they are computed over every request here.
const fetchOverview = async (hostId, rangeSeconds = 3600) => {

    const result = await pool.query(
        `SELECT ${LATENCY_AND_ERROR_COLUMNS}
         FROM traces
         WHERE host_id = $1
           AND timestamp >= NOW() - make_interval(secs => $2::double precision)`,
        [hostId, rangeSeconds]
    );

    const stats = normalizeStats(result.rows[0]);

    return {
        ...stats,
        throughput_rpm: Number(((stats.request_count / rangeSeconds) * 60).toFixed(2))
    };
};

// Latency, throughput and error rate per fixed-width bucket (date_bin).
// Buckets with no traffic are kept (zero requests, null latency) so charts
// show a gap instead of joining the points either side of it.
const fetchTimeSeries = async (hostId, rangeSeconds, bucketSeconds) => {

    const result = await pool.query(
        `WITH params AS (
            SELECT make_interval(secs => $3::double precision) AS width,
                   TIMESTAMPTZ '2000-01-01 00:00:00+00' AS origin
         ),
         bounds AS (
            SELECT date_bin(width, NOW() - make_interval(secs => $2::double precision), origin) AS start_at,
                   date_bin(width, NOW(), origin) AS end_at
            FROM params
         ),
         buckets AS (
            SELECT generate_series(b.start_at, b.end_at, p.width) AS bucket
            FROM bounds b, params p
         ),
         agg AS (
            SELECT date_bin(p.width, t.timestamp, p.origin) AS bucket,
                   ${LATENCY_AND_ERROR_COLUMNS}
            FROM traces t, params p, bounds b
            WHERE t.host_id = $1
              AND t.timestamp >= b.start_at
            GROUP BY 1
         )
         SELECT buckets.bucket,
                COALESCE(agg.request_count, 0) AS request_count,
                agg.avg_duration_ms,
                agg.max_duration_ms,
                agg.p50_duration_ms,
                agg.p95_duration_ms,
                agg.p99_duration_ms,
                COALESCE(agg.error_count, 0) AS error_count,
                COALESCE(agg.client_error_count, 0) AS client_error_count,
                agg.error_rate
         FROM buckets
         LEFT JOIN agg ON agg.bucket = buckets.bucket
         ORDER BY buckets.bucket`,
        [hostId, rangeSeconds, bucketSeconds]
    );

    return result.rows.map((row) => {
        const stats = normalizeStats(row);

        return {
            bucket: row.bucket,
            ...stats,
            throughput_rpm: Number(((stats.request_count / bucketSeconds) * 60).toFixed(2))
        };
    });
};

module.exports = {
    verifyHostOwnership,
    fetchTraces,
    fetchRouteSummary,
    fetchOverview,
    fetchTimeSeries
};
'@

Write-RepoFile 'backend/src/utils/apmRange.js' @'
// Time ranges the APM read API accepts, and the bucket width used when a
// range is drawn as a time series. Widths keep every chart at 30-170 points.
const APM_RANGES = {
    '15m': { seconds: 15 * 60, bucketSeconds: 30 },
    '1h': { seconds: 60 * 60, bucketSeconds: 60 },
    '6h': { seconds: 6 * 60 * 60, bucketSeconds: 5 * 60 },
    '24h': { seconds: 24 * 60 * 60, bucketSeconds: 15 * 60 },
    '7d': { seconds: 7 * 24 * 60 * 60, bucketSeconds: 60 * 60 }
};

const DEFAULT_APM_RANGE = '1h';

// Returns the range config for a query value, or null when it is not one we
// offer. An absent value falls back to the default.
function resolveApmRange(value) {
    if (value === undefined || value === null || value === '') {
        return { key: DEFAULT_APM_RANGE, ...APM_RANGES[DEFAULT_APM_RANGE] };
    }

    if (typeof value !== 'string' || !Object.hasOwn(APM_RANGES, value)) {
        return null;
    }

    return { key: value, ...APM_RANGES[value] };
}

module.exports = { APM_RANGES, DEFAULT_APM_RANGE, resolveApmRange };
'@

Write-RepoFile 'backend/tests/apm.integration.test.js' @'
const {
    app,
    pool,
    request,
    resetDb,
    createUser,
    authHeader
} = require('./helpers');

let owner;
let stranger;
let hostId;
let emptyHostId;

const registerHost = async (token, name) => {
    const res = await request(app)
        .post('/api/hosts/register')
        .set(authHeader(token))
        .send({ name });

    expect(res.status).toBe(201);
    return res.body.id;
};

// 101 requests on GET /orders, 5 minutes ago, with durations 0..100 ms so the
// percentiles are exact: p50 = 50, p95 = 95, p99 = 99.
// 4 of them are 500s, 6 are 404s, the other 91 are 200s.
const seedOrders = () =>
    pool.query(
        `INSERT INTO traces (host_id, method, route, status_code, duration_ms, timestamp)
         SELECT $1, 'GET', '/orders',
                CASE WHEN n < 4 THEN 500 WHEN n < 10 THEN 404 ELSE 200 END,
                n,
                NOW() - INTERVAL '5 minutes'
         FROM generate_series(0, 100) AS n`,
        [hostId]
    );

const seedTrace = (route, status, duration, ago) =>
    pool.query(
        `INSERT INTO traces (host_id, method, route, status_code, duration_ms, timestamp)
         VALUES ($1, 'GET', $2, $3, $4, NOW() - $5::interval)`,
        [hostId, route, status, duration, ago]
    );

const get = (path, query, token = owner.token) =>
    request(app).get(`/api/apm${path}`).query(query).set(authHeader(token));

beforeAll(async () => {
    await resetDb();

    owner = await createUser();
    stranger = await createUser();

    hostId = await registerHost(owner.token, 'apm-host');
    emptyHostId = await registerHost(owner.token, 'apm-empty-host');
});

beforeEach(async () => {
    await pool.query('DELETE FROM traces');
});

afterAll(async () => {
    await pool.end();
});

describe('GET /api/apm/traces/summary', () => {
    test('reports p50/p95/p99 and a 5xx-based error rate per route', async () => {
        await seedOrders();

        const res = await get('/traces/summary', { host_id: hostId });

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);

        const row = res.body[0];
        expect(row).toMatchObject({
            method: 'GET',
            route: '/orders',
            request_count: 101,
            avg_duration_ms: 50,
            max_duration_ms: 100,
            p50_duration_ms: 50,
            p95_duration_ms: 95,
            p99_duration_ms: 99,
            error_count: 4,
            client_error_count: 6
        });
        // 4 / 101 = 3.96%; the six 404s do not count
        expect(row.error_rate).toBe(3.96);
    });

    test('orders routes by p95, slowest first', async () => {
        await seedTrace('/fast', 200, 10, '1 minute');
        await seedTrace('/slow', 200, 900, '1 minute');
        await seedTrace('/medium', 200, 200, '1 minute');

        const res = await get('/traces/summary', { host_id: hostId });

        expect(res.body.map((r) => r.route)).toEqual(['/slow', '/medium', '/fast']);
    });

    test('ignores requests that have no duration when computing percentiles', async () => {
        await seedTrace('/x', 200, 100, '1 minute');
        await seedTrace('/x', null, null, '1 minute');

        const res = await get('/traces/summary', { host_id: hostId });

        expect(res.body[0].request_count).toBe(2);
        expect(res.body[0].p95_duration_ms).toBe(100);
        expect(res.body[0].error_rate).toBe(0);
    });

    test('defaults to the last hour and honours the range selector', async () => {
        await seedTrace('/recent', 200, 10, '10 minutes');
        await seedTrace('/older', 200, 10, '3 hours');
        await seedTrace('/oldest', 200, 10, '3 days');

        const routes = async (query) =>
            (await get('/traces/summary', { host_id: hostId, ...query })).body
                .map((r) => r.route)
                .sort();

        expect(await routes({})).toEqual(['/recent']);
        expect(await routes({ range: '15m' })).toEqual(['/recent']);
        expect(await routes({ range: '6h' })).toEqual(['/older', '/recent']);
        expect(await routes({ range: '7d' })).toEqual(['/older', '/oldest', '/recent']);
    });

    test.each(['2h', '1H', 'abc', '0', '1h; DROP TABLE traces'])(
        'rejects an unsupported range %s',
        async (range) => {
            const res = await get('/traces/summary', { host_id: hostId, range });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/range must be one of/);
        }
    );

    test('requires a host_id', async () => {
        const res = await get('/traces/summary', {});

        expect(res.status).toBe(400);
    });

    test('hides another user\'s host', async () => {
        await seedOrders();

        const res = await get('/traces/summary', { host_id: hostId }, stranger.token);

        expect(res.status).toBe(404);
    });
});

describe('GET /api/apm/traces/overview', () => {
    test('returns host-wide percentiles, error rate and throughput', async () => {
        await seedOrders();
        await seedTrace('/other', 503, 100, '2 minutes');

        const res = await get('/traces/overview', { host_id: hostId, range: '15m' });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            range: '15m',
            request_count: 102,
            error_count: 5,
            client_error_count: 6
        });
        // 5 / 102 = 4.90%
        expect(res.body.error_rate).toBe(4.9);
        // 102 requests over 15 minutes
        expect(res.body.throughput_rpm).toBe(6.8);
        expect(res.body.p95_duration_ms).toBeGreaterThanOrEqual(95);
        expect(res.body.p99_duration_ms).toBeGreaterThanOrEqual(res.body.p95_duration_ms);
    });

    test('returns zeros and nulls, not an error, for a host with no traffic', async () => {
        const res = await get('/traces/overview', { host_id: emptyHostId });

        expect(res.status).toBe(200);
        expect(res.body.request_count).toBe(0);
        expect(res.body.error_count).toBe(0);
        expect(res.body.throughput_rpm).toBe(0);
        expect(res.body.p95_duration_ms).toBeNull();
        expect(res.body.error_rate).toBeNull();
    });

    test('is scoped to the requested host', async () => {
        await seedOrders();

        const res = await get('/traces/overview', { host_id: emptyHostId });

        expect(res.body.request_count).toBe(0);
    });

    test('hides another user\'s host', async () => {
        const res = await get('/traces/overview', { host_id: hostId }, stranger.token);

        expect(res.status).toBe(404);
    });
});

describe('GET /api/apm/traces/timeseries', () => {
    test('buckets traffic with date_bin and keeps empty buckets', async () => {
        // One statement, so both 10-minute traces share a timestamp and
        // cannot straddle a bucket boundary.
        await pool.query(
            `INSERT INTO traces (host_id, method, route, status_code, duration_ms, timestamp)
             VALUES ($1, 'GET', '/a', 200, 100, NOW() - INTERVAL '10 minutes'),
                    ($1, 'GET', '/a', 500, 300, NOW() - INTERVAL '10 minutes'),
                    ($1, 'GET', '/a', 200, 50, NOW() - INTERVAL '40 minutes')`,
            [hostId]
        );

        const res = await get('/traces/timeseries', { host_id: hostId, range: '1h' });

        expect(res.status).toBe(200);
        expect(res.body.range).toBe('1h');
        expect(res.body.bucket_seconds).toBe(60);

        const { points } = res.body;

        // 60 one-minute buckets covering the hour, plus the current partial one
        expect(points.length).toBeGreaterThanOrEqual(60);
        expect(points.length).toBeLessThanOrEqual(62);

        // buckets are consecutive and evenly spaced
        for (let i = 1; i < points.length; i += 1) {
            expect(
                new Date(points[i].bucket) - new Date(points[i - 1].bucket)
            ).toBe(60 * 1000);
        }

        const busy = points.filter((p) => p.request_count > 0);
        expect(busy).toHaveLength(2);
        expect(points.reduce((sum, p) => sum + p.request_count, 0)).toBe(3);

        const tenMinutes = busy.find((p) => p.request_count === 2);
        expect(tenMinutes).toMatchObject({
            error_count: 1,
            error_rate: 50,
            max_duration_ms: 300,
            throughput_rpm: 2
        });
        expect(tenMinutes.p50_duration_ms).toBe(200);

        const quiet = points.find((p) => p.request_count === 0);
        expect(quiet).toMatchObject({
            error_count: 0,
            throughput_rpm: 0,
            p95_duration_ms: null,
            error_rate: null
        });
    });

    test('uses wider buckets for longer ranges', async () => {
        await seedTrace('/a', 200, 10, '1 hour');

        const widths = {};
        for (const range of ['15m', '6h', '24h', '7d']) {
            const res = await get('/traces/timeseries', { host_id: hostId, range });
            expect(res.status).toBe(200);
            widths[range] = res.body.bucket_seconds;
        }

        expect(widths).toEqual({ '15m': 30, '6h': 300, '24h': 900, '7d': 3600 });
    });

    test('does not count traces from before the range', async () => {
        await seedTrace('/a', 200, 10, '2 hours');

        const res = await get('/traces/timeseries', { host_id: hostId, range: '1h' });

        expect(res.body.points.every((p) => p.request_count === 0)).toBe(true);
    });

    test('rejects an unsupported range and a foreign host', async () => {
        const bad = await get('/traces/timeseries', { host_id: hostId, range: '30d' });
        expect(bad.status).toBe(400);

        const foreign = await get('/traces/timeseries', { host_id: hostId }, stranger.token);
        expect(foreign.status).toBe(404);
    });
});
'@

Write-RepoFile 'frontend/src/components/apm/ApmOverviewCards.jsx' @'
import {
  formatMs,
  formatPercent,
  formatThroughput
} from '../../utils/apm'

function Card({ label, value, tone = 'text-white', hint }) {
  return (
    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-5 py-4">
      <p className="text-xs uppercase tracking-widest text-gray-500">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${tone}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  )
}

export default function ApmOverviewCards({ overview }) {

  if (!overview) return null

  const hasErrors = Number(overview.error_count) > 0

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
      <Card label="Requests" value={overview.request_count.toLocaleString()} />
      <Card label="Throughput" value={formatThroughput(overview.throughput_rpm)} />
      <Card label="p50" value={formatMs(overview.p50_duration_ms)} tone="text-emerald-400" />
      <Card label="p95" value={formatMs(overview.p95_duration_ms)} tone="text-amber-400" />
      <Card label="p99" value={formatMs(overview.p99_duration_ms)} tone="text-rose-400" />
      <Card
        label="Error rate"
        value={formatPercent(overview.error_rate)}
        tone={hasErrors ? 'text-red-400' : 'text-white'}
        hint={`${overview.error_count.toLocaleString()} server errors (5xx)`}
      />
    </div>
  )
}
'@

Write-RepoFile 'frontend/src/components/apm/ApmRangeSelector.jsx' @'
import { APM_RANGES } from '../../utils/apm'

export default function ApmRangeSelector({ value, onChange }) {

  return (
    <div
      role="group"
      aria-label="Time range"
      className="inline-flex rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] p-1"
    >
      {APM_RANGES.map((range) => {

        const active = range.value === value

        return (
          <button
            key={range.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(range.value)}
            className={`
              rounded-md px-3 py-1.5 text-sm font-medium transition
              ${active
                ? 'bg-[#2a2a2a] text-white'
                : 'text-gray-500 hover:text-gray-300'}
            `}
          >
            {range.label}
          </button>
        )
      })}
    </div>
  )
}
'@

Write-RepoFile 'frontend/src/components/apm/ApmRangeSelector.test.jsx' @'
import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ApmRangeSelector from './ApmRangeSelector'

describe('ApmRangeSelector', () => {
  test('marks the selected range and reports a new choice', () => {
    const onChange = vi.fn()

    render(<ApmRangeSelector value="1h" onChange={onChange} />)

    expect(screen.getByRole('button', { name: '1h' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '6h' })).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByRole('button', { name: '24h' }))

    expect(onChange).toHaveBeenCalledWith('24h')
  })
})
'@

Write-RepoFile 'frontend/src/components/apm/ApmTimeSeriesCharts.jsx' @'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend
} from 'chart.js'
import { formatBucketLabel, toChartNumber } from '../../utils/apm'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend
)

const TICK_COLOR = '#6b7280'
const GRID_COLOR = '#2a2a2a'

const baseOptions = (unit, showLegend) => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: {
      display: showLegend,
      labels: { color: '#9ca3af', boxWidth: 12 }
    },
    tooltip: {
      callbacks: {
        label: (context) =>
          context.parsed.y === null
            ? `${context.dataset.label}: no data`
            : `${context.dataset.label}: ${context.parsed.y.toLocaleString(undefined, {
                maximumFractionDigits: 2
              })} ${unit}`
      }
    }
  },
  scales: {
    x: {
      ticks: { color: TICK_COLOR, maxTicksLimit: 8, maxRotation: 0 },
      grid: { color: GRID_COLOR }
    },
    y: {
      beginAtZero: true,
      title: { display: true, text: unit, color: TICK_COLOR },
      ticks: { color: TICK_COLOR },
      grid: { color: GRID_COLOR }
    }
  }
})

const lineDataset = (label, color, values) => ({
  label,
  data: values,
  borderColor: color,
  backgroundColor: color,
  borderWidth: 2,
  pointRadius: 0,
  pointHoverRadius: 4,
  tension: 0.2,
  // null buckets (no traffic) leave a gap instead of joining across it
  spanGaps: false
})

function ChartPanel({ title, testId, unit, labels, datasets, showLegend = false }) {
  return (
    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-5">
      <h2 className="text-lg font-semibold mb-4">{title}</h2>
      <div className="h-56" data-testid={testId}>
        <Line
          data={{ labels, datasets }}
          options={baseOptions(unit, showLegend)}
        />
      </div>
    </div>
  )
}

export default function ApmTimeSeriesCharts({ points, range }) {

  if (!points || points.length === 0) return null

  const labels = points.map((point) => formatBucketLabel(point.bucket, range))
  const column = (key) => points.map((point) => toChartNumber(point[key]))

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">

      <div className="xl:col-span-2">
        <ChartPanel
          title="Latency"
          testId="apm-latency-chart"
          unit="ms"
          showLegend
          labels={labels}
          datasets={[
            lineDataset('p50', '#10b981', column('p50_duration_ms')),
            lineDataset('p95', '#f59e0b', column('p95_duration_ms')),
            lineDataset('p99', '#fb7185', column('p99_duration_ms'))
          ]}
        />
      </div>

      <ChartPanel
        title="Throughput"
        testId="apm-throughput-chart"
        unit="req/min"
        labels={labels}
        datasets={[lineDataset('Throughput', '#38bdf8', column('throughput_rpm'))]}
      />

      <ChartPanel
        title="Error rate"
        testId="apm-error-rate-chart"
        unit="%"
        labels={labels}
        datasets={[lineDataset('Error rate (5xx)', '#ef4444', column('error_rate'))]}
      />

    </div>
  )
}
'@

Write-RepoFile 'frontend/src/components/dashboards/ApmSummaryWidget.jsx' @'
import { useEffect, useState } from 'react'
import { apiFetch } from '../../utils/apiFetch'
import { API_BASE_URL } from '../../config/api'

export default function ApmSummaryWidget({ hostId }) {

  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {

    if (!hostId) return

    const fetchSummary = async () => {
      try {
        const res = await apiFetch(
          `${API_BASE_URL}/api/apm/traces/overview?host_id=${hostId}`
        )

        if (!res.ok) {
          throw new Error(`APM overview request failed: ${res.status}`)
        }

        const data = await res.json()

        setSummary({
          totalRequests: Number(data.request_count),
          p95: data.p95_duration_ms === null ? null : Number(data.p95_duration_ms),
          errorRate: data.error_rate === null ? null : Number(data.error_rate),
          totalErrors: Number(data.error_count)
        })
      } catch (err) {
        console.error('Widget failed to fetch APM summary:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchSummary()

    const interval = setInterval(fetchSummary, 15000)
    return () => clearInterval(interval)

  }, [hostId])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center gap-4 p-4">
        <div className="h-10 w-14 bg-[#2a2a2a] rounded animate-pulse" />
        <div className="h-10 w-14 bg-[#2a2a2a] rounded animate-pulse" />
        <div className="h-10 w-14 bg-[#2a2a2a] rounded animate-pulse" />
      </div>
    )
  }

  if (!summary) {
    return <div className="h-full flex items-center justify-center text-xs text-gray-600">No data yet</div>
  }

  return (
    <div className="h-full flex items-center justify-around p-4 text-center">

      <div>
        <p className="text-2xl font-bold text-white">{summary.totalRequests}</p>
        <p className="text-xs text-gray-500 mt-1">Requests</p>
      </div>

      <div>
        <p className="text-2xl font-bold text-emerald-400">
          {summary.p95 === null ? '—' : `${summary.p95.toFixed(0)}ms`}
        </p>
        <p className="text-xs text-gray-500 mt-1">p95</p>
      </div>

      <div>
        <p className={`text-2xl font-bold ${summary.totalErrors > 0 ? 'text-red-400' : 'text-white'}`}>
          {summary.errorRate === null ? '—' : `${summary.errorRate.toFixed(1)}%`}
        </p>
        <p className="text-xs text-gray-500 mt-1">Error rate</p>
      </div>

    </div>
  )
}
'@

Write-RepoFile 'frontend/src/pages/Apm.jsx' @'
import { useEffect, useState } from 'react'
import api from '../services/api'
import useHosts from '../hooks/useHosts'
import HostSelector from '../components/shared/hostSelector'
import ApmRangeSelector from '../components/apm/ApmRangeSelector'
import ApmOverviewCards from '../components/apm/ApmOverviewCards'
import ApmTimeSeriesCharts from '../components/apm/ApmTimeSeriesCharts'
import {
  DEFAULT_APM_RANGE,
  formatMs,
  formatPercent,
  getApmRange
} from '../utils/apm'

function statusColor(status) {
  if (status >= 500) return 'text-red-400'
  if (status >= 400) return 'text-yellow-400'
  return 'text-emerald-400'
}

export default function Apm() {

  const { hosts, selectedHostId, setSelectedHostId } = useHosts()

  const [range, setRange] = useState(DEFAULT_APM_RANGE)

  // Everything the page shows, tagged with the host and range it was loaded
  // for. If the tag does not match the current selection the data is stale
  // (a slow response from before the person switched), so it is not shown.
  const [data, setData] = useState(null)

  const rangeConfig = getApmRange(range)
  const selectionKey = `${selectedHostId}:${range}`
  const ready = data !== null && data.key === selectionKey

  useEffect(() => {

    if (!selectedHostId) {
      return
    }

    let ignore = false
    const key = `${selectedHostId}:${range}`
    const params = { host_id: selectedHostId, range }

    const fetchData = async () => {

      try {

        const [summaryRes, overviewRes, seriesRes, tracesRes] = await Promise.all([
          api.get('/apm/traces/summary', { params }),
          api.get('/apm/traces/overview', { params }),
          api.get('/apm/traces/timeseries', { params }),
          api.get('/apm/traces', { params: { host_id: selectedHostId } })
        ])

        // A response for a host/range that is no longer selected must not
        // overwrite the one that is.
        if (ignore) return

        setData({
          key,
          summary: summaryRes.data,
          overview: overviewRes.data,
          series: seriesRes.data.points,
          traces: tracesRes.data,
          failed: false
        })

      } catch (err) {

        console.error('Failed to fetch APM data:', err)

        if (ignore) return

        // Keep what is already on screen for this selection; only fall back
        // to an empty state when there is nothing to keep.
        setData((previous) =>
          previous && previous.key === key
            ? previous
            : { key, summary: [], overview: null, series: [], traces: [], failed: true }
        )

      }

    }

    fetchData()

    const interval = setInterval(fetchData, getApmRange(range).refreshMs)

    return () => {
      ignore = true
      clearInterval(interval)
    }

  }, [selectedHostId, range])

  const summary = ready ? data.summary : []
  const traces = ready ? data.traces : []

  return (
    <div className="space-y-8 text-white">

      {/* HEADER */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">APM</h1>
          <p className="mt-2 text-gray-400">
            Request latency, throughput and error rate, over {rangeConfig.description}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <ApmRangeSelector value={range} onChange={setRange} />

          <HostSelector
            hosts={hosts}
            selectedHostId={selectedHostId}
            onChange={setSelectedHostId}
          />
        </div>
      </div>

      {/* OVERVIEW */}
      {ready && <ApmOverviewCards overview={data.overview} />}

      {/* TIME SERIES */}
      {ready && <ApmTimeSeriesCharts points={data.series} range={range} />}

      {/* ROUTE SUMMARY */}
      <div className="
        bg-[#1a1a1a]
        border border-[#2a2a2a]
        rounded-xl
        overflow-hidden
      ">

        <h2 className="px-5 py-4 text-lg font-semibold border-b border-[#2a2a2a]">
          Routes
        </h2>

        {!ready ? (
          <p className="p-5 text-sm text-gray-500">Loading...</p>
        ) : data.failed ? (
          <p className="p-5 text-sm text-red-400">
            Couldn't load APM data for this host.
          </p>
        ) : summary.length === 0 ? (
          <p className="p-5 text-sm text-gray-500">
            No requests recorded for this host in {rangeConfig.description}. Add the APM
            middleware to an app and point it at this host's API key to see data here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#2a2a2a] text-left text-gray-500 uppercase text-xs tracking-widest">
                  <th className="px-5 py-3">Method</th>
                  <th className="px-5 py-3">Route</th>
                  <th className="px-5 py-3">Requests</th>
                  <th className="px-5 py-3">p50</th>
                  <th className="px-5 py-3">p95</th>
                  <th className="px-5 py-3">p99</th>
                  <th className="px-5 py-3">Max</th>
                  <th className="px-5 py-3">Error rate</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((row) => (
                  <tr key={`${row.method}-${row.route}`} className="border-b border-[#2a2a2a] last:border-0">
                    <td className="px-5 py-4 font-mono text-xs text-gray-400">{row.method}</td>
                    <td className="px-5 py-4 font-medium">{row.route}</td>
                    <td className="px-5 py-4 text-gray-400">{row.request_count}</td>
                    <td className="px-5 py-4">{formatMs(row.p50_duration_ms)}</td>
                    <td className="px-5 py-4">{formatMs(row.p95_duration_ms)}</td>
                    <td className="px-5 py-4">{formatMs(row.p99_duration_ms)}</td>
                    <td className="px-5 py-4 text-gray-400">{formatMs(row.max_duration_ms)}</td>
                    <td className={`px-5 py-4 ${Number(row.error_count) > 0 ? 'text-red-400' : 'text-gray-500'}`}>
                      {formatPercent(row.error_rate)}
                      <span className="ml-2 text-xs text-gray-500">
                        ({row.error_count} 5xx)
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      </div>

      {/* RECENT TRACES */}
      <div className="
        bg-[#1a1a1a]
        border border-[#2a2a2a]
        rounded-xl
        overflow-hidden
      ">

        <h2 className="px-5 py-4 text-lg font-semibold border-b border-[#2a2a2a]">
          Recent Requests
        </h2>

        {traces.length === 0 ? (
          <p className="p-5 text-sm text-gray-500">No recent requests.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#2a2a2a] text-left text-gray-500 uppercase text-xs tracking-widest">
                <th className="px-5 py-3">Time</th>
                <th className="px-5 py-3">Method</th>
                <th className="px-5 py-3">Route</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Duration</th>
              </tr>
            </thead>
            <tbody>
              {traces.map((trace) => (
                <tr key={trace.id} className="border-b border-[#2a2a2a] last:border-0">
                  <td className="px-5 py-4 text-gray-400">
                    {new Date(trace.timestamp).toLocaleTimeString()}
                  </td>
                  <td className="px-5 py-4 font-mono text-xs text-gray-400">{trace.method}</td>
                  <td className="px-5 py-4 font-medium">{trace.route}</td>
                  <td className={`px-5 py-4 font-semibold ${statusColor(trace.status_code)}`}>
                    {trace.status_code}
                  </td>
                  <td className="px-5 py-4 text-gray-400">{trace.duration_ms} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      </div>

    </div>
  )
}
'@

Write-RepoFile 'frontend/src/pages/Apm.test.jsx' @'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import api from '../services/api'
import useHosts from '../hooks/useHosts'
import Apm from './Apm'

vi.mock('../services/api', () => ({
  default: { get: vi.fn() }
}))

vi.mock('../hooks/useHosts', () => ({
  default: vi.fn()
}))

// Canvas is unavailable in jsdom; expose the chart data instead.
vi.mock('react-chartjs-2', () => ({
  Line: ({ data }) => (
    <div data-testid="line-chart" data-chart={JSON.stringify(data)} />
  )
}))

const stats = (overrides = {}) => ({
  request_count: 101,
  avg_duration_ms: 50,
  max_duration_ms: 100,
  p50_duration_ms: 50,
  p95_duration_ms: 95,
  p99_duration_ms: 99,
  error_count: 4,
  client_error_count: 6,
  error_rate: 3.96,
  ...overrides
})

const series = [
  { bucket: '2026-11-26T10:00:00Z', ...stats({ request_count: 0, p50_duration_ms: null, p95_duration_ms: null, p99_duration_ms: null, error_rate: null, error_count: 0 }), throughput_rpm: 0 },
  { bucket: '2026-11-26T10:01:00Z', ...stats(), throughput_rpm: 101 }
]

// Builds an api.get implementation that answers every APM endpoint
const respond = ({ summary, overview, points } = {}) => (url) => {
  const body = {
    '/apm/traces/summary': summary ?? [{ method: 'GET', route: '/orders', ...stats() }],
    '/apm/traces/overview': overview ?? { range: '1h', ...stats(), throughput_rpm: 1.7 },
    '/apm/traces/timeseries': { range: '1h', bucket_seconds: 60, points: points ?? series },
    '/apm/traces': [
      { id: 1, method: 'GET', route: '/orders', status_code: 200, duration_ms: 12, timestamp: new Date().toISOString() }
    ]
  }[url]

  return Promise.resolve({ data: body })
}

// "/orders" is in both the Routes and the Recent Requests table; the Routes
// table comes first.
const findRoutesRow = async (route = '/orders') =>
  (await screen.findAllByText(route, { selector: 'td' }))[0].closest('tr')

const callsTo = (url) => api.get.mock.calls.filter(([called]) => called === url)

beforeEach(() => {
  api.get.mockReset()
  useHosts.mockReturnValue({
    hosts: [{ id: 1, name: 'web-1' }],
    selectedHostId: 1,
    setSelectedHostId: vi.fn()
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Apm page', () => {
  test('requests every endpoint with the default 1h range', async () => {
    api.get.mockImplementation(respond())

    render(<Apm />)

    await findRoutesRow()

    for (const url of ['/apm/traces/summary', '/apm/traces/overview', '/apm/traces/timeseries']) {
      expect(callsTo(url)[0][1].params).toEqual({ host_id: 1, range: '1h' })
    }
  })

  test('shows percentiles and a 5xx-based error rate per route and overall', async () => {
    api.get.mockImplementation(respond())

    render(<Apm />)

    const row = await findRoutesRow()

    expect(within(row).getByText('50 ms')).toBeInTheDocument()
    expect(within(row).getByText('95 ms')).toBeInTheDocument()
    expect(within(row).getByText('99 ms')).toBeInTheDocument()
    expect(within(row).getByText(/3\.96%/)).toBeInTheDocument()
    expect(within(row).getByText('(4 5xx)')).toBeInTheDocument()

    expect(screen.getByText('1.7 req/min')).toBeInTheDocument()
    expect(screen.getByText('4 server errors (5xx)')).toBeInTheDocument()
  })

  test('draws latency, throughput and error-rate charts, leaving gaps for empty buckets', async () => {
    api.get.mockImplementation(respond())

    render(<Apm />)

    await findRoutesRow()

    const charts = screen.getAllByTestId('line-chart').map((el) => JSON.parse(el.dataset.chart))

    expect(charts).toHaveLength(3)

    const [latency, throughput, errorRate] = charts
    expect(latency.datasets.map((d) => d.label)).toEqual(['p50', 'p95', 'p99'])
    // empty bucket first, then real values: null must stay null, not 0
    expect(latency.datasets[1].data).toEqual([null, 95])
    expect(throughput.datasets[0].data).toEqual([0, 101])
    expect(errorRate.datasets[0].data).toEqual([null, 3.96])
  })

  test('re-requests with the chosen range and updates the heading', async () => {
    api.get.mockImplementation(respond())

    render(<Apm />)

    await findRoutesRow()

    fireEvent.click(screen.getByRole('button', { name: '6h' }))

    await waitFor(() =>
      expect(callsTo('/apm/traces/summary').some(([, config]) => config.params.range === '6h')).toBe(true)
    )

    expect(screen.getByText(/over the last 6 hours/)).toBeInTheDocument()
  })

  test('ignores a slow response for a range that is no longer selected', async () => {
    let releaseSlow
    const slow = new Promise((resolve) => { releaseSlow = resolve })

    api.get.mockImplementation((url, config) => {
      if (url === '/apm/traces/summary' && config.params.range === '1h') {
        return slow
      }

      if (url === '/apm/traces/summary') {
        return Promise.resolve({ data: [{ method: 'GET', route: '/six-hour-route', ...stats() }] })
      }

      return respond()(url, config)
    })

    render(<Apm />)

    // switch away while the 1h summary is still in flight
    fireEvent.click(screen.getByRole('button', { name: '6h' }))

    await screen.findByText('/six-hour-route', { selector: 'td' })

    releaseSlow({ data: [{ method: 'GET', route: '/one-hour-route', ...stats() }] })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.queryByText('/one-hour-route')).not.toBeInTheDocument()
    expect(screen.getByText('/six-hour-route', { selector: 'td' })).toBeInTheDocument()
  })

  test('shows an empty state naming the range when there is no traffic', async () => {
    api.get.mockImplementation(respond({
      summary: [],
      overview: { range: '1h', ...stats({ request_count: 0, error_count: 0, error_rate: null, p50_duration_ms: null, p95_duration_ms: null, p99_duration_ms: null }), throughput_rpm: 0 },
      points: []
    }))

    render(<Apm />)

    expect(await screen.findByText(/No requests recorded for this host in the last hour/)).toBeInTheDocument()
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument()
  })

  test('shows an error message when the first load fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    api.get.mockRejectedValue(new Error('boom'))

    render(<Apm />)

    expect(await screen.findByText(/Couldn't load APM data/)).toBeInTheDocument()
  })
})
'@

Write-RepoFile 'frontend/src/utils/apm.js' @'
// Ranges the APM API accepts (see backend/src/utils/apmRange.js) and how
// often each is worth refreshing: a 7-day series is expensive to compute
// and barely changes in 5 seconds.
export const APM_RANGES = [
  { value: '15m', label: '15m', description: 'the last 15 minutes', refreshMs: 5000 },
  { value: '1h', label: '1h', description: 'the last hour', refreshMs: 5000 },
  { value: '6h', label: '6h', description: 'the last 6 hours', refreshMs: 15000 },
  { value: '24h', label: '24h', description: 'the last 24 hours', refreshMs: 30000 },
  { value: '7d', label: '7d', description: 'the last 7 days', refreshMs: 60000 }
]

export const DEFAULT_APM_RANGE = '1h'

export const getApmRange = (value) =>
  APM_RANGES.find((range) => range.value === value) ||
  APM_RANGES.find((range) => range.value === DEFAULT_APM_RANGE)

const isMissing = (value) =>
  value === null || value === undefined || Number.isNaN(Number(value))

// null (no requests, so no latency) renders as a dash, never as "0 ms"
export const formatMs = (value) =>
  isMissing(value)
    ? '—'
    : `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })} ms`

export const formatPercent = (value) =>
  isMissing(value)
    ? '—'
    : `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`

export const formatThroughput = (value) =>
  isMissing(value)
    ? '—'
    : `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })} req/min`

// Day-or-longer ranges need the date too, or labels repeat ambiguously
export const formatBucketLabel = (timestamp, rangeValue) => {
  const date = new Date(timestamp)

  if (rangeValue === '24h' || rangeValue === '7d') {
    return date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    ...(rangeValue === '15m' ? { second: '2-digit' } : {})
  })
}

// null (not 0 or NaN) for a missing value, so a chart shows a gap
export const toChartNumber = (value) =>
  isMissing(value) ? null : Number(value)
'@

Write-RepoFile 'frontend/src/utils/apm.test.js' @'
import { describe, expect, test } from 'vitest'
import {
  APM_RANGES,
  DEFAULT_APM_RANGE,
  formatMs,
  formatPercent,
  formatThroughput,
  getApmRange,
  toChartNumber
} from './apm'

describe('apm utils', () => {
  test('offers exactly the ranges the API accepts', () => {
    expect(APM_RANGES.map((range) => range.value)).toEqual(['15m', '1h', '6h', '24h', '7d'])
    expect(DEFAULT_APM_RANGE).toBe('1h')
  })

  test('falls back to the default range for an unknown value', () => {
    expect(getApmRange('2h').value).toBe('1h')
    expect(getApmRange('7d').value).toBe('7d')
  })

  test('shows a dash, not zero, when there is no value', () => {
    expect(formatMs(null)).toBe('—')
    expect(formatMs(undefined)).toBe('—')
    expect(formatPercent(null)).toBe('—')
    expect(formatThroughput(null)).toBe('—')
  })

  test('formats real values, including zero', () => {
    expect(formatMs(95.5)).toBe('95.5 ms')
    expect(formatMs(0)).toBe('0 ms')
    expect(formatPercent(3.96)).toBe('3.96%')
    expect(formatPercent(0)).toBe('0%')
    expect(formatThroughput(6.8)).toBe('6.8 req/min')
  })

  test('chart values keep missing data as null so lines show a gap', () => {
    expect(toChartNumber(null)).toBeNull()
    expect(toChartNumber(undefined)).toBeNull()
    expect(toChartNumber(0)).toBe(0)
    expect(toChartNumber('12.5')).toBe(12.5)
  })
})
'@

Write-Host 'Done. Now run the checks.'
