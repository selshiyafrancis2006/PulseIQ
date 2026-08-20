import {
  BrowserRouter,
  Routes,
  Route,
  Navigate
} from 'react-router-dom'

import Landing from './pages/Landing'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Uptime from './pages/Uptime'
import AlertRules from './pages/AlertRules'
import DashboardLayout from './layouts/DashboardLayout'
import Metrics from './pages/Metrics'
import Processes from './pages/Processes'
import AlertHistory from './pages/AlertHistory'
import ServiceHealth from './pages/ServiceHealth'
import Logs from './pages/Logs'
import Settings from './pages/Settings'

const ProtectedRoute = ({ children }) => {

  const token = localStorage.getItem('token')

  return token ? children : <Navigate to="/login" />
}

const withLayout = (Component) => (
  <DashboardLayout>
    <Component />
  </DashboardLayout>
)

export default function App() {

  return (

    <BrowserRouter>

      <Routes>

        {/* PUBLIC ROUTES */}
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />

        {/* PROTECTED DASHBOARD ROUTES */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <Dashboard />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/uptime"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <Uptime />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />

        <Route
  path="/metrics"
  element={
    <ProtectedRoute>
      <DashboardLayout>
        <Metrics />
      </DashboardLayout>
    </ProtectedRoute>
  }
/>

<Route
  path="/processes"
  element={
    <ProtectedRoute>
      <DashboardLayout>
        <Processes />
      </DashboardLayout>
    </ProtectedRoute>
  }
/>

<Route
  path="/alert-history"
  element={
    <ProtectedRoute>
      <DashboardLayout>
        <AlertHistory />
      </DashboardLayout>
    </ProtectedRoute>
  }
/>

<Route
  path="/service-health"
  element={
    <ProtectedRoute>
      <DashboardLayout>
        <ServiceHealth />
      </DashboardLayout>
    </ProtectedRoute>
  }
/>

<Route
  path="/logs"
  element={
    <ProtectedRoute>
      <DashboardLayout>
        <Logs />
      </DashboardLayout>
    </ProtectedRoute>
  }
/>

<Route
  path="/settings"
  element={
    <ProtectedRoute>
      <DashboardLayout>
        <Settings />
      </DashboardLayout>
    </ProtectedRoute>
  }
/>

        <Route
          path="/alerts"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <AlertRules />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />

      </Routes>

    </BrowserRouter>

  )
}