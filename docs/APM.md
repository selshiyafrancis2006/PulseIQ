# APM (Application Performance Monitoring)

PulseIQ APM records one trace per HTTP request handled by your Node.js/Express
app and shows per-route request counts, latency and error counts, plus the most
recent requests. It can also alert on slow or failing services.

APM is attached to a **host**. Each host has an API key (Hosts page); the
middleware uses that key, so traces appear under the host they belong to. APM
works with or without the metrics agent running on that machine.

## 1. Set it up

Open **Hosts → Add Host** and choose the **APM (Express)** tab, or do it by hand:

1. Copy `agent/apm-middleware.js` from this repository into your app and run
   `npm install axios`.
2. Register it before your routes:

```js
const pulseiqApm = require('./apm-middleware')

app.use(pulseiqApm({
  backendUrl: 'http://localhost:5000',   // your PulseIQ backend
  apiKey: '<the host API key>',
}))
```

In production, leave the options out and set `PULSEIQ_BACKEND_URL` and
`PULSEIQ_API_KEY` instead, so the key is not committed to code. If either value
is missing the middleware logs a warning and does nothing.

Requests appear on the **APM** page within a few seconds. The page refreshes
every 5 seconds and pauses while the browser tab is hidden.

### What the middleware sends

After each response finishes it posts `method`, `route`, `status_code` and
`duration_ms`. It never waits for PulseIQ and never affects your response: if
the backend is slow or down, the trace is dropped and a message is logged.

`route` is Express's matched pattern (`/widgets/:id`), not the raw URL, so
`/widgets/1` and `/widgets/2` aggregate into one row. A request that matches no
route is reported with its raw URL.

## 2. Read the data

All read endpoints need a user JWT (`Authorization: Bearer <token>`) and a
`host_id` that belongs to that user. A missing `host_id` gives `400`, and a host
that is not yours (or does not exist) gives `404`.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/apm/traces?host_id=` | The 100 most recent traces, newest first |
| GET | `/api/apm/traces/summary?host_id=&range=` | Per method + route aggregates for a time range |

**Trace fields:** `id`, `method`, `route`, `status_code`, `duration_ms`, `timestamp`.

**Summary fields:** `method`, `route`, `request_count`, `avg_duration_ms`,
`max_duration_ms`, `error_count`. Rows are sorted by `avg_duration_ms`, slowest
first. In the summary, `error_count` counts every status of 400 or above.

**`range`** is one of `1m`, `5m`, `15m`, `1h` (default), `6h`, `24h`, `3d`, `7d`.
Anything else returns `400`. The dashboard's APM widget passes the dashboard's
time range through this parameter.

### Ingest

| Method | Endpoint | Auth |
|---|---|---|
| POST | `/api/agent/traces` | `X-API-Key: <host API key>` |

Body: `method` (string, up to 10 characters), `route` (string, up to 255
characters), and optional integers `status_code` (100–599) and `duration_ms`
(0 or more). Invalid values return `400`; success returns `201` with the stored
trace. Control characters in `method` or `route` are rejected.

## 3. Alerts

APM alerts use the same pipeline as host metric alerts: rules in **Alert Rules**,
history in **Alerts**, breach and recovery tracked per host.

| Rule | Meaning | Default |
|---|---|---|
| `apm_p95_ms` | p95 request latency, in milliseconds | above 1000 for 3 evaluations |
| `apm_error_rate` | Share of requests with a 5xx status, in percent | above 5 for 3 evaluations |

How it works:

- A job runs **every minute**. For each host whose owner has an active APM rule,
  it computes p95 latency (`percentile_cont(0.95)`) and the 5xx error rate over
  the last **5 minutes**, and passes them to the alert engine.
- A rule's **duration** counts consecutive evaluations, so 3 means 3 minutes in a
  row. One alert is created when the count is reached; it is not repeated while
  the host stays in breach. When the value drops back under the threshold the
  breach clears, and a later incident alerts again.
- Only **5xx** responses count as errors for alerting. 4xx responses are client
  mistakes and are ignored.
- A host needs at least **20 requests** in the window to be evaluated. Below
  that the host is skipped and its alert state is left as it was.
- Severity is **Critical** at an error rate of 25% or more, or p95 of 5000 ms or
  more; otherwise **Warning**.

Configure the job with backend environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `APM_ALERT_WINDOW_MINUTES` | `5` | How far back p95 and error rate are computed |
| `APM_ALERT_MIN_REQUESTS` | `20` | Minimum requests in the window before a host is evaluated |

Existing users need the default rules added once:

```bash
psql -h localhost -U <db_user> -d pulseiq -f backend/migrations/20261126_apm_alert_rules.sql
```

The migration is safe to re-run and does not change rules a user already has.
New users get the rules when they register.

APM alerts are recorded in Alert History. They are not sent to notification
channels such as email or Slack.

## 4. Troubleshooting

| Symptom | Check |
|---|---|
| Nothing on the APM page | Is the middleware registered *before* your routes? Is the key the one for the selected host? Look for `[pulseiq-apm] failed to report trace` in your app's log. |
| `[pulseiq-apm] ... not configured` warning | `backendUrl` or `apiKey` (or the two env vars) is empty. |
| Reports fail from Docker | Use `host.docker.internal` instead of `localhost` in `backendUrl`. |
| APM page shows an error with Retry | The backend returned an error or could not be reached; the page keeps showing the last good data if it has any. |
| No alert although latency is high | The host needs 20+ requests in the last 5 minutes, the rule must be active, and the breach must last the rule's duration. |

## 5. Tests

```bash
cd backend && npm test -- apm
cd frontend && npx vitest run ApmSummaryWidget usePolledResource InstallInstructions
```

The backend integration tests (`apm.integration.test.js`,
`apmAlert.integration.test.js`) need the same test database as the other
integration tests.
