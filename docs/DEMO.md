# PulseIQ Demo Script

**Duration:** 3–4 minutes

## 1. Introduction (20 seconds)

PulseIQ is a self-hosted monitoring platform for website availability, response times, incidents, and infrastructure health.

## 2. Uptime Monitoring (60 seconds)

Show the Monitoring page.

Explain how monitors check configured endpoints at defined intervals. Highlight health status, response time, uptime, recent incidents, and tags such as `env:prod` and `critical`.

Open a monitor's details and show its historical response times and uptime information.

## 3. SSL, TCP, and DNS Checks (30 seconds)

Show the HTTPS monitor's SSL certificate panel, including expiry date and days remaining.

Briefly introduce TCP port checks and DNS resolution using the existing test monitors.

## 4. Host Monitoring (40 seconds)

Open the Hosts page. Explain how an installed agent reports system metrics such as CPU, memory, and disk usage. Show actual host status and collected metrics.

## 5. Dashboards and Status Reporting (40 seconds)

Show an existing dashboard and its monitoring widget.

If the public status page is verified and configured, demonstrate it and explain how it exposes service status separately from the private monitoring dashboard.

## 6. Technical Overview (30 seconds)

Explain the architecture:
- Frontend: React and Vite
- Backend: Node.js and Express
- Database: PostgreSQL
- Deployment: Docker
- Testing: automated backend tests

## Closing

PulseIQ combines uptime checks, response-time tracking, incident visibility, and host monitoring in one platform.

**Demo checklist**
- Start the application and confirm the dashboard loads.
- Use existing monitors with real data.
- Verify the host agent is reporting.
- Avoid exposing API keys, JWTs, credentials, or private information.
- Only demonstrate features that have been verified.
