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
