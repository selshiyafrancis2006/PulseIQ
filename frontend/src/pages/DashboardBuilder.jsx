import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Responsive, WidthProvider } from 'react-grid-layout/legacy'
import api from '../services/api'
import useHosts from '../hooks/useHosts'
import AddWidgetModal from '../components/dashboards/AddWidgetModal'
import MetricChartWidget from '../components/dashboards/MetricChartWidget'
import MonitorStatusWidget from '../components/dashboards/MonitorStatusWidget'
import LogCountWidget from '../components/dashboards/LogCountWidget'

import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

const ResponsiveGridLayout = WidthProvider(Responsive)

export default function DashboardBuilder() {

  const { id } = useParams()
  const navigate = useNavigate()
  const { hosts } = useHosts()

  const [dashboard, setDashboard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showAddWidget, setShowAddWidget] = useState(false)
  const [timeRange, setTimeRange] = useState('1h')
  const [editMode, setEditMode] = useState(false)

  const [renamingWidgetId, setRenamingWidgetId] = useState(null)
  const [renameValue, setRenameValue] = useState('')

  const saveTimeout = useRef(null)

  useEffect(() => {

    const fetchDashboard = async () => {
      try {
        const { data } = await api.get(`/dashboards/${id}`)
        setDashboard(data)
      } catch (err) {
        console.error('Failed to load dashboard:', err)
        navigate('/dashboards')
      } finally {
        setLoading(false)
      }
    }

    fetchDashboard()

  }, [id, navigate])

  const persistLayout = useCallback(async (widgets) => {

    setSaving(true)

    try {
      await api.put(`/dashboards/${id}/layout`, { layout: widgets })
    } catch (err) {
      console.error('Failed to save layout:', err)
    } finally {
      setSaving(false)
    }

  }, [id])

  const scheduleSave = useCallback((widgets) => {

    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current)
    }

    saveTimeout.current = setTimeout(() => {
      persistLayout(widgets)
    }, 600)

  }, [persistLayout])

  const handleLayoutChange = (newLayout) => {

    if (!dashboard || !editMode) return

    const updatedWidgets = dashboard.layout.map((widget) => {
      const gridItem = newLayout.find((item) => item.i === widget.id)
      if (!gridItem) return widget

      return {
        ...widget,
        x: gridItem.x,
        y: gridItem.y,
        w: gridItem.w,
        h: gridItem.h
      }
    })

    setDashboard((prev) => ({ ...prev, layout: updatedWidgets }))
    scheduleSave(updatedWidgets)
  }

  const handleAddWidget = ({ type, config, title }) => {

    const columnWidth = (type === 'monitor_status' || type === 'log_count') ? 3 : 4
    const columnsPerRow = Math.floor(12 / columnWidth)

    const newWidget = {
      id: `w-${Date.now()}`,
      type,
      title,
      x: (dashboard.layout.length % columnsPerRow) * columnWidth,
      y: Infinity,
      w: columnWidth,
      h: 3,
      config
    }

    const updatedWidgets = [...dashboard.layout, newWidget]

    setDashboard((prev) => ({ ...prev, layout: updatedWidgets }))
    setShowAddWidget(false)
    persistLayout(updatedWidgets)
  }

  const handleRemoveWidget = (widgetId) => {

    const updatedWidgets = dashboard.layout.filter((w) => w.id !== widgetId)

    setDashboard((prev) => ({ ...prev, layout: updatedWidgets }))
    persistLayout(updatedWidgets)
  }

  const startRenameWidget = (widget) => {
    setRenamingWidgetId(widget.id)
    setRenameValue(widget.title || widget.type.replace('_', ' '))
  }

  const cancelRenameWidget = () => {
    setRenamingWidgetId(null)
    setRenameValue('')
  }

  const submitRenameWidget = (widgetId) => {

    if (!renameValue.trim()) return

    const updatedWidgets = dashboard.layout.map((w) =>
      w.id === widgetId ? { ...w, title: renameValue.trim() } : w
    )

    setDashboard((prev) => ({ ...prev, layout: updatedWidgets }))
    cancelRenameWidget()
    persistLayout(updatedWidgets)
  }

  if (loading) {
    return <p className="text-sm text-gray-500">Loading dashboard...</p>
  }

  if (!dashboard) {
    return null
  }

  const gridLayout = dashboard.layout.map((widget) => ({
    i: widget.id,
    x: widget.x,
    y: widget.y,
    w: widget.w,
    h: widget.h
  }))

  const hostName = (hostId) =>
    hosts.find((h) => h.id === hostId)?.name || `Host ${hostId}`

  return (
    <div className="space-y-6 text-white">

      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div>
          <button
            onClick={() => navigate('/dashboards')}
            className="text-xs text-gray-500 hover:text-white mb-2"
          >
            ← Back to Dashboards
          </button>
          <h1 className="text-3xl font-bold">{dashboard.name}</h1>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            className="
              bg-[#1a1a1a]
              border border-[#2a2a2a]
              text-white
              px-3 py-2
              rounded-lg
              text-sm
              outline-none
              focus:border-emerald-500
            "
          >
            <option value="1m">Last 1 Minute</option>
            <option value="5m">Last 5 Minutes</option>
            <option value="15m">Last 15 Minutes</option>
            <option value="1h">Last 1 Hour</option>
            <option value="6h">Last 6 Hours</option>
            <option value="24h">Last 24 Hours</option>
            <option value="3d">Last 3 Days</option>
            <option value="7d">Last 7 Days</option>
          </select>

          {saving && (
            <span className="text-xs text-gray-500">Saving...</span>
          )}

          {editMode && (
            <button
              onClick={() => setShowAddWidget(true)}
              className="
                px-4 py-2
                rounded-lg
                bg-emerald-600
                hover:bg-emerald-500
                text-sm
                font-semibold
                transition-colors
              "
            >
              + Add Widget
            </button>
          )}

          <button
            onClick={() => setEditMode((prev) => !prev)}
            className={`
              px-4 py-2
              rounded-lg
              text-sm
              font-semibold
              transition-colors
              ${editMode
                ? 'bg-emerald-600 hover:bg-emerald-500'
                : 'bg-[#2a2a2a] hover:bg-[#333] text-gray-300'
              }
            `}
          >
            {editMode ? 'Done Editing' : 'Edit Dashboard'}
          </button>
        </div>
      </div>

      {/* GRID */}
      {dashboard.layout.length === 0 ? (
        <div className="
          bg-[#1a1a1a]
          border border-dashed border-[#2a2a2a]
          rounded-xl
          p-16
          text-center
        ">
          <p className="text-gray-500 text-sm">
            {editMode
              ? 'No widgets yet. Click "Add Widget" to start building this dashboard.'
              : 'This dashboard is empty. Click "Edit Dashboard" to add widgets.'}
          </p>
        </div>
      ) : (
        <ResponsiveGridLayout
          className="layout"
          layouts={{ lg: gridLayout }}
          breakpoints={{ lg: 1024, md: 768, sm: 480 }}
          cols={{ lg: 12, md: 8, sm: 4 }}
          rowHeight={80}
          onLayoutChange={handleLayoutChange}
          draggableHandle=".widget-drag-handle"
          isDraggable={editMode}
          isResizable={editMode}
        >
          {dashboard.layout.map((widget) => (
            <div
              key={widget.id}
                            className={`
                bg-[#1a1a1a] border rounded-xl overflow-hidden flex flex-col
                transition-colors duration-150
                ${editMode ? 'border-[#2a2a2a] hover:border-emerald-500/50' : 'border-[#2a2a2a]'}
              `}
            >
              <div className={`
                px-4 py-2 border-b border-[#2a2a2a] flex items-center justify-between gap-2
                ${editMode ? 'widget-drag-handle cursor-move' : ''}
              `}>
                {renamingWidgetId === widget.id ? (
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && submitRenameWidget(widget.id)}
                    autoFocus
                    className="
                      flex-1 min-w-0
                      bg-transparent
                      border-b border-emerald-500
                      text-xs text-white
                      outline-none
                    "
                  />
                ) : (
                                    <span className="text-sm text-white uppercase tracking-widest truncate">
                    {widget.title || widget.type.replace('_', ' ')}
                  </span>
                )}

                {editMode && (
                  <div className="flex items-center gap-2 shrink-0">
                    {renamingWidgetId === widget.id ? (
                      <>
                        <button
                          onClick={() => submitRenameWidget(widget.id)}
                          className="text-emerald-400 hover:text-emerald-300 text-xs"
                        >
                          Save
                        </button>
                        <button
                          onClick={cancelRenameWidget}
                          className="text-gray-500 hover:text-white text-xs"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => startRenameWidget(widget)}
                          className="text-gray-600 hover:text-emerald-400 text-xs"
                          title="Rename widget"
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => handleRemoveWidget(widget.id)}
                          className="text-gray-600 hover:text-red-400 text-sm leading-none"
                          title="Remove widget"
                        >
                          ×
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
              <div className="flex-1 min-h-0">
                {widget.type === 'metric_chart' ? (
                  <MetricChartWidget
                    hostId={widget.config.host_id}
                    metric={widget.config.metric}
                    hostName={hostName(widget.config.host_id)}
                    timeRange={timeRange}
                  />
                ) : widget.type === 'monitor_status' ? (
                  <MonitorStatusWidget monitorId={widget.config.monitor_id} />
                ) : widget.type === 'log_count' ? (
                  <LogCountWidget severity={widget.config.severity} timeRange={timeRange} />
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-600 text-sm">
                    Unknown widget type
                  </div>
                )}
              </div>
            </div>
          ))}
        </ResponsiveGridLayout>
      )}

      {showAddWidget && (
        <AddWidgetModal
          hosts={hosts}
          onClose={() => setShowAddWidget(false)}
          onAdd={handleAddWidget}
        />
      )}

    </div>
  )
}