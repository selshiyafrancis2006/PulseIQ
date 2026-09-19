import { useState } from 'react'
import useDashboards from '../hooks/useDashboards'
import { useNavigate } from 'react-router-dom'

export default function Dashboards() {

  const { dashboards, loading, createDashboard, renameDashboard, deleteDashboard } = useDashboards()
  const navigate = useNavigate()

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')

  const [dashboardToDelete, setDashboardToDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const openCreateModal = () => {
    setShowCreateModal(true)
    setName('')
    setError('')
  }

  const closeCreateModal = () => setShowCreateModal(false)

  const handleCreate = async (e) => {
    e.preventDefault()

    if (!name.trim()) {
      setError('Dashboard name is required')
      return
    }

    setSubmitting(true)
    setError('')

    try {
      await createDashboard(name.trim())
      setShowCreateModal(false)
    } catch (err) {
      console.error('Failed to create dashboard:', err)
      setError(err.response?.data?.error || 'Failed to create dashboard')
    } finally {
      setSubmitting(false)
    }
  }

  const startRename = (dashboard) => {
    setRenamingId(dashboard.id)
    setRenameValue(dashboard.name)
  }

  const cancelRename = () => {
    setRenamingId(null)
    setRenameValue('')
  }

  const submitRename = async (id) => {
    if (!renameValue.trim()) return

    try {
      await renameDashboard(id, renameValue.trim())
      cancelRename()
    } catch (err) {
      console.error('Failed to rename dashboard:', err)
    }
  }

  const openDeleteModal = (dashboard) => setDashboardToDelete(dashboard)
  const closeDeleteModal = () => setDashboardToDelete(null)

  const confirmDelete = async () => {
    if (!dashboardToDelete) return

    setDeleting(true)

    try {
      await deleteDashboard(dashboardToDelete.id)
      setDashboardToDelete(null)
    } catch (err) {
      console.error('Failed to delete dashboard:', err)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-8 text-white">

      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboards</h1>
          <p className="mt-2 text-gray-400">
            Build your own views by combining widgets.
          </p>
        </div>

        <button
          onClick={openCreateModal}
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
          + New Dashboard
        </button>
      </div>

      {/* DASHBOARDS LIST */}
      <div className="
        bg-[#1a1a1a]
        border border-[#2a2a2a]
        rounded-xl
        overflow-hidden
      ">

        {loading ? (
          <p className="p-5 text-sm text-gray-500">Loading dashboards...</p>
        ) : dashboards.length === 0 ? (
          <p className="p-5 text-sm text-gray-500">
            No dashboards yet. Click "New Dashboard" to create your first one.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#2a2a2a] text-left text-gray-500 uppercase text-xs tracking-widest">
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Last Updated</th>
                <th className="px-5 py-3">Created</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {dashboards.map((dashboard) => (
                                <tr
  key={dashboard.id}
  onClick={() => renamingId !== dashboard.id && navigate(`/dashboards/${dashboard.id}`)}
  className="border-b border-[#2a2a2a] last:border-0 hover:bg-[#222] cursor-pointer transition-colors"
>
                  <td className="px-5 py-4 font-medium">
                    {renamingId === dashboard.id ? (
                      <input
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && submitRename(dashboard.id)}
                        autoFocus
                        className="
                          bg-[#0f0f0f]
                          border border-[#2a2a2a]
                          rounded-lg
                          px-2 py-1
                          text-sm
                          outline-none
                          focus:border-emerald-500
                        "
                      />
                    ) : (
                      dashboard.name
                    )}
                  </td>
                  <td className="px-5 py-4 text-gray-400">
                    {new Date(dashboard.updated_at).toLocaleString()}
                  </td>
                  <td className="px-5 py-4 text-gray-400">
                    {new Date(dashboard.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-4 text-right space-x-2">
                    {renamingId === dashboard.id ? (
                      <>
                        <button
                          onClick={() => submitRename(dashboard.id)}
                          className="
                            px-3 py-1.5
                            rounded-md
                            text-xs font-semibold
                            bg-emerald-600/20
                            text-emerald-400
                            hover:bg-emerald-600/30
                            transition-colors
                          "
                        >
                          Save
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); cancelRename() }}
                          className="
                            px-3 py-1.5
                            rounded-md
                            text-xs font-semibold
                            bg-[#2a2a2a]
                            text-gray-300
                            hover:bg-[#333]
                            transition-colors
                          "
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={(e) => { e.stopPropagation(); startRename(dashboard) }}
                          className="
                            px-3 py-1.5
                            rounded-md
                            text-xs font-semibold
                            bg-[#2a2a2a]
                            text-gray-300
                            hover:bg-[#333] hover:text-white
                            transition-colors
                          "
                        >
                          Rename
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); openDeleteModal(dashboard) }}
                          className="
                            px-3 py-1.5
                            rounded-md
                            text-xs font-semibold
                            bg-red-600/20
                            text-red-400
                            hover:bg-red-600/30
                            transition-colors
                          "
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      </div>

      {/* CREATE MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-6 w-full max-w-md">

            <h2 className="text-xl font-bold mb-4">New Dashboard</h2>

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">
                  Dashboard name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Prod Overview"
                  autoFocus
                  className="
                    w-full
                    bg-[#0f0f0f]
                    border border-[#2a2a2a]
                    rounded-lg
                    px-3 py-2
                    text-sm
                    outline-none
                    focus:border-emerald-500
                  "
                />
              </div>

              {error && (
                <p className="text-sm text-red-400">{error}</p>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeCreateModal}
                  className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="
                    px-4 py-2
                    rounded-lg
                    bg-emerald-600
                    hover:bg-emerald-500
                    disabled:opacity-50
                    text-sm
                    font-semibold
                  "
                >
                  {submitting ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE CONFIRM MODAL */}
      {dashboardToDelete && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-6 w-full max-w-md">

            <h2 className="text-xl font-bold mb-2">Delete this dashboard?</h2>

            <p className="text-sm text-gray-400 mb-6">
              "{dashboardToDelete.name}" will be permanently deleted. This cannot be undone.
            </p>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={closeDeleteModal}
                disabled={deleting}
                className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleting}
                className="
                  px-4 py-2
                  rounded-lg
                  bg-red-600
                  hover:bg-red-500
                  disabled:opacity-50
                  text-sm
                  font-semibold
                "
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}