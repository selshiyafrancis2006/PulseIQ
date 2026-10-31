# PulseIQ

Open source, self-hosted real-time system monitoring dashboard. Built as a free alternative to Datadog for small teams.

## What it does

- Collects CPU, memory, disk and network metrics every 5 seconds
- Detects anomalies using a moving average algorithm (flags 40%+ deviations)
- Pushes live alerts to the dashboard via WebSocket
- JWT-based authentication (register/login)

## Tech Stack

| Layer | Tech |
|---|---|
| Backend | Node.js + Express |
| Database | PostgreSQL |
| Real-time | WebSockets (ws) |
| Metrics | systeminformation |
| Frontend | React + Vite + Tailwind CSS + Chart.js |
| Auth | JWT + bcryptjs |

## Project Structure

```
pulseiq/
├── backend/
│   ├── server.js       # Express + WebSocket server
│   ├── db.js           # PostgreSQL connection
│   ├── collector.js    # Reads system metrics every 5s
│   ├── routes.js       # API routes
│   ├── anomaly.js      # Moving average anomaly detection
│   └── auth.js         # JWT login/register
└── frontend/
    └── src/
        ├── App.jsx         # Routing
        ├── Dashboard.jsx   # Live dashboard
        ├── Landing.jsx     # Landing page
        └── Login.jsx       # Login/register form
```

## Database Schema

Run these in your PostgreSQL database before starting:

```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE metrics (
  id SERIAL PRIMARY KEY,
  cpu_usage FLOAT,
  memory_usage FLOAT,
  disk_usage FLOAT,
  network_in FLOAT,
  network_out FLOAT,
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE TABLE alerts (
  id SERIAL PRIMARY KEY,
  metric_name VARCHAR(50),
  metric_value FLOAT,
  average_value FLOAT,
  timestamp TIMESTAMP DEFAULT NOW()
);
```

## Environment Variables

Create a `.env` file inside the `backend/` folder:

```
DB_HOST=localhost
DB_USER=your_postgres_user
DB_PASSWORD=your_postgres_password
DB_NAME=pulseiq
DB_PORT=5432
JWT_SECRET=your_jwt_secret
PORT=5000
```

### Email Notifications (SMTP)

Email notifications require SMTP configuration in `backend/.env`:

```env
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
```

- `SMTP_HOST`: SMTP server hostname.
- `SMTP_PORT`: SMTP server port (commonly 587 or 465).
- `SMTP_SECURE`: Set to `true` for implicit TLS, commonly port 465.
- `SMTP_USER` and `SMTP_PASS`: SMTP authentication credentials.
- `SMTP_FROM`: Sender email address.

Keep SMTP credentials private. Do not commit actual `.env` files to Git. Email delivery requires valid SMTP configuration.
### Private Monitor Targets

By default, PulseIQ only allows monitors to target public IP addresses and public hostnames.

To allow monitoring private network targets, set this backend environment variable:

```env
PULSEIQ_ALLOW_PRIVATE_TARGETS=true
```

When enabled, PulseIQ permits:
- RFC1918 IPv4 private ranges (`10.0.0.0/8`, `172.16.0.0/12`, and `192.168.0.0/16`)
- IPv6 Unique Local Addresses (`fc00::/7`)
- Hostnames ending in `.local` or `.internal`

The following remain blocked, even when private targets are enabled:
- `localhost` and `.localhost` hostnames
- Loopback IP addresses (`127.0.0.0/8` and `::1`)
- Reserved and otherwise disallowed IP ranges
- Blocked hostname suffixes such as `.test` and `.invalid`

**Security warning:** Enabling private targets expands the destinations that monitors can access. Only enable this option in deployments where monitor creation is restricted to trusted users. Keep it disabled for public-facing deployments unless private-network monitoring is specifically required.


## Running Locally

**Backend**
```bash
cd backend
npm install
node server.js
```

**Frontend**
```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:5173`, backend on `http://localhost:5000`.

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | /api/auth/register | Register a new user |
| POST | /api/auth/login | Login and get JWT token |
| GET | /api/metrics | Last 20 metric readings |
| GET | /api/metrics/latest | Most recent metric reading |
| GET | /api/alerts | Last 20 anomaly alerts |

## How Anomaly Detection Works

Every 5 seconds, after saving a metric, PulseIQ:
1. Fetches the last 10 readings of that metric from the database
2. Calculates their average
3. If the current value is more than 40% above the average, it saves an alert
4. The alert is pushed live to the dashboard via WebSocket

No external ML library. Pure math.

## Roadmap

- [x] System metrics collection
- [x] Anomaly detection + alerts
- [x] Live WebSocket dashboard
- [x] JWT authentication
- [ ] Log collection + search
- [ ] Process monitor (per-process CPU/memory)
- [ ] Multi-server support
- [ ] Custom dashboards
- [ ] Docker + Railway deployment

## License

MIT

