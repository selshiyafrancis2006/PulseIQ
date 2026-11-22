import {
  BrowserRouter,
  Routes,
  Route,
  Navigate
} from 'react-router-dom'
import { lazy, Suspense } from 'react'
import DashboardLayout from './layouts/DashboardLayout'

const Landing = lazy(() => import('./pages/Landing'))
const Login = lazy(() => import('./pages/Login'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Uptime = lazy(() => import('./pages/Uptime'))
const MonitorDetails = lazy(() => import('./pages/MonitorDetails'))
const AlertRules = lazy(() => import('./pages/AlertRules'))

const Metrics = lazy(() => import('./pages/Metrics'))
const Processes = lazy(() => import('./pages/Processes'))
const AlertHistory = lazy(() => import('./pages/AlertHistory'))
const ServiceHealth = lazy(() => import('./pages/ServiceHealth'))
const Logs = lazy(() => import('./pages/Logs'))
const Settings = lazy(() => import('./pages/Settings'))
const Hosts = lazy(() => import('./pages/Hosts'))
const HostDetails = lazy(() => import('./pages/HostDetails'))
const Apm = lazy(() => import('./pages/Apm'))
const Anomalies = lazy(() => import('./pages/Anomalies'))
const Dashboards = lazy(() => import('./pages/Dashboards'))
const DashboardBuilder = lazy(() => import('./pages/DashboardBuilder'))
const StatusPageSettings = lazy(() => import('./pages/StatusPageSettings'))
const PublicStatusPage = lazy(() => import('./pages/PublicStatusPage'))
const ApiTests = lazy(() => import('./pages/ApiTests'))
const MaintenanceWindows = lazy(() => import('./pages/MaintenanceWindows'))


const ProtectedRoute = ({ children }) => {

  const token = localStorage.getItem('token')

  return token ? children : <Navigate to="/login" />
}

export default function App() {

  return (

    <BrowserRouter>

      <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-gray-400">Loading...</div>}>
        <Routes>

        {/* PUBLIC ROUTES */}
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/status/:slug" element={<PublicStatusPage />} />
        <Route
          path="/status-page"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <StatusPageSettings />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />


<Route
  path="/api-tests"
  element={
    <ProtectedRoute>
      <DashboardLayout>
        <ApiTests />
      </DashboardLayout>
    </ProtectedRoute>
  }
/>


<Route
  path="/maintenance"
  element={
    <ProtectedRoute>
      <DashboardLayout>
        <MaintenanceWindows />
      </DashboardLayout>
    </ProtectedRoute>
  }
/>
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
  path="/uptime/:id"
  element={
    <ProtectedRoute>
      <DashboardLayout>
        <MonitorDetails />
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
  path="/hosts"
  element={
    <ProtectedRoute>
      <DashboardLayout>
        <Hosts />
      </DashboardLayout>
    </ProtectedRoute>
  }
/>

<Route
  path="/hosts/:id"
  element={
    <ProtectedRoute>
      <DashboardLayout>
        <HostDetails />
      </DashboardLayout>
    </ProtectedRoute>
  }
/>
<Route
  path="/apm"
  element={
    <ProtectedRoute>
      <DashboardLayout>
        <Apm />
      </DashboardLayout>
    </ProtectedRoute>
  }
/>

<Route
  path="/anomalies"
  element={
    <ProtectedRoute>
      <DashboardLayout>
        <Anomalies />
      </DashboardLayout>
    </ProtectedRoute>
  }
/>

<Route
  path="/dashboards"
  element={
    <ProtectedRoute>
      <DashboardLayout>
        <Dashboards />
      </DashboardLayout>
    </ProtectedRoute>
  }
/>

<Route
  path="/dashboards/:id"
  element={
    <ProtectedRoute>
      <DashboardLayout>
        <DashboardBuilder />
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
      </Suspense>

    </BrowserRouter>

  )
}



