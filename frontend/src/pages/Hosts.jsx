import { useState } from 'react'
import { Link } from 'react-router-dom'
import useHosts from '../hooks/useHosts'
import { isOnline, timeAgo } from '../utils/hostStatus'
import InstallInstructions from '../components/hosts/InstallInstructions'

function parseTagsInput(input) {
  return input
    .split(',')
    .map(tag => tag.trim())
    .filter(tag => tag.length > 0)
}

function Modal({ children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-6">
        {children}
      </div>
    </div>
  )
}

// One-time API key display, used after registering and after regenerating
function KeyReveal({ heading, apiKey, onDone }) {
  const [copied, setCopied] = useState(false)
const [copyError, setCopyError] = useState('')

const handleCopy = async () => {
  setCopyError('')

  try {
    await navigator.clipboard.writeText(apiKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  } catch (err) {
    console.error('Clipboard copy failed:', err)
    setCopyError('Could not copy automatically. Please select and copy the key manually.')
  }
}

  return (
    <>
      <h2 className="text-xl font-bold mb-2 text-emerald-400">
        {heading}
      </h2>

      <p className="text-sm text-gray-400 mb-4">
        Copy this API key now — for security, PulseIQ won't show it to you again.
      </p>

      <div className="
        bg-[#0f0f0f]
        border border-[#2a2a2a]
        rounded-lg
        p-3
        flex items-center justify-between
        gap-3
        mb-2
      ">
        <code className="text-xs text-emerald-400 break-all">
          {apiKey}
        </code>
        <button
          onClick={handleCopy}
          className="
            shrink-0
            px-3 py-1.5
            rounded-md
            bg-[#1a1a1a]
            border border-[#2a2a2a]
            text-xs
            hover:border-emerald-500
            transition-colors
          "
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      {copyError && (
        <p className="mb-3 text-sm text-red-400">
          {copyError}
        </p>
      )}

      <div className="mb-6">
        <InstallInstructions apiKey={apiKey} />
      </div>

      <div className="flex justify-end">
        <button
          onClick={onDone}
          className="
            px-4 py-2
            rounded-lg
            bg-emerald-600
            hover:bg-emerald-500
            text-sm
            font-semibold
          "
        >
          Done
        </button>
      </div>
    </>
  )
}

const inputClass = `
  w-full
  bg-[#0f0f0f]
  border border-[#2a2a2a]
  rounded-lg
  px-3 py-2
  text-sm
  outline-none
  focus:border-emerald-500
`

export default function Hosts() {


const {
  hosts,
  loading,
  refreshing,
  refetch,
  registerHost,
  updateHost,
  regenerateKey,
  deleteHost,
  tagFilter,
  setTagFilter
} = useHosts()


  // Add host
  const [showAddModal, setShowAddModal] = useState(false)
  const [name, setName] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [newHost, setNewHost] = useState(null) // registration result (incl. one-time api_key)

  // Tag filter
  const [filterInput, setFilterInput] = useState('')
  const [searchInput, setSearchInput] = useState('')

  // Edit host
  const [hostToEdit, setHostToEdit] = useState(null)
  const [editName, setEditName] = useState('')
  const [editTags, setEditTags] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')

  // Regenerate key
  const [hostToRotate, setHostToRotate] = useState(null)
  const [rotating, setRotating] = useState(false)
  const [rotateError, setRotateError] = useState('')
  const [rotatedKey, setRotatedKey] = useState(null) // { name, apiKey }

  // Delete host
  const [hostToDelete, setHostToDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const openModal = () => {
    setShowAddModal(true)
    setName('')
    setTagsInput('')
    setError('')
    setNewHost(null)
  }

  
const closeModal = () => {
  setShowAddModal(false)
  setName('')
  setTagsInput('')
  setError('')
  setNewHost(null)
}


  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!name.trim()) {
      setError('Host name is required')
      return
    }

    setSubmitting(true)
    setError('')

    try {
      const result = await registerHost(name.trim(), parseTagsInput(tagsInput))
      setNewHost(result)
    } catch (err) {
      console.error('Failed to register host:', err)
      setError(err.response?.data?.error || 'Failed to register host')
    } finally {
      setSubmitting(false)
    }
  }

  const applyFilter = (e) => {
    e.preventDefault()
    setTagFilter(filterInput.trim() || null)
  }

  const clearFilter = () => {
    setFilterInput('')
    setTagFilter(null)
  }

  const openEdit = (host) => {
    setHostToEdit(host)
    setEditName(host.name)
    setEditTags((host.tags || []).join(', '))
    setEditError('')
  }

  const handleEditSubmit = async (e) => {
    e.preventDefault()

    if (!editName.trim()) {
      setEditError('Host name is required')
      return
    }

    setEditSaving(true)
    setEditError('')

    try {
      await updateHost(hostToEdit.id, {
        name: editName.trim(),
        tags: parseTagsInput(editTags)
      })
      setHostToEdit(null)
    } catch (err) {
      console.error('Failed to update host:', err)
      setEditError(err.response?.data?.error || 'Failed to update host')
    } finally {
      setEditSaving(false)
    }
  }

  const openRotate = (host) => {
    setHostToRotate(host)
    setRotateError('')
  }

  const handleRotate = async () => {
    if (!hostToRotate) return

    setRotating(true)
    setRotateError('')

    try {
      const result = await regenerateKey(hostToRotate.id)
      setRotatedKey({ name: result.name, apiKey: result.api_key })
      setHostToRotate(null)
    } catch (err) {
      console.error('Failed to regenerate API key:', err)
      setRotateError(err.response?.data?.error || 'Failed to regenerate API key')
    } finally {
      setRotating(false)
    }
  }

  const openDelete = (host) => {
    setHostToDelete(host)
    setDeleteError('')
  }

  const handleDeleteHost = async () => {
    if (!hostToDelete) return

    setDeleting(true)
    setDeleteError('')

    try {
      await deleteHost(hostToDelete.id)
      setHostToDelete(null)
    } catch (err) {
      console.error('Failed to delete host:', err)
      setDeleteError(err.response?.data?.error || 'Failed to delete host')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-8 text-white">

      {/* HEADER */}
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Hosts</h1>
            <p className="mt-2 text-gray-400">
              Machines reporting metrics to PulseIQ via the agent.
            </p>
          </div>

          <button
            onClick={openModal}
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
            + Add Host
          </button>
        </div>

        {/* HOST SUMMARY */}
        <div className="grid grid-cols-3 gap-4 mt-6">
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-4">
            <p className="text-xs uppercase tracking-widest text-gray-500">
              Total Hosts
            </p>
            <p className="mt-2 text-2xl font-semibold">
              {hosts.length}
            </p>
          </div>

          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-4">
            <p className="text-xs uppercase tracking-widest text-gray-500">
              Online
            </p>
            <p className="mt-2 text-2xl font-semibold text-emerald-400">
              {hosts.filter((host) => isOnline(host.last_seen_at)).length}
            </p>
          </div>

          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-4">
            <p className="text-xs uppercase tracking-widest text-gray-500">
              Offline
            </p>
            <p className="mt-2 text-2xl font-semibold text-gray-400">
              {hosts.filter((host) => !isOnline(host.last_seen_at)).length}
            </p>
          </div>
        </div>
      </div>

      {/* HOST NAME SEARCH */}
<div className="mb-4">
  <input
    type="text"
    value={searchInput}
    onChange={(e) => setSearchInput(e.target.value)}
    placeholder="Search hosts by name..."
    aria-label="Search hosts by name"
    className="
      w-full sm:w-80
      bg-[#1a1a1a]
      border border-[#2a2a2a]
      rounded-lg
      px-3 py-2
      text-sm
      outline-none
      focus:border-emerald-500
    "
  />
</div>

      {/* TAG FILTER */}
      <form onSubmit={applyFilter} className="flex items-center gap-3">
        <input
          type="text"
          value={filterInput}
          onChange={(e) => setFilterInput(e.target.value)}
          placeholder="Filter by tag, e.g. env:prod"
          className="
            bg-[#1a1a1a]
            border border-[#2a2a2a]
            rounded-lg
            px-3 py-2
            text-sm
            outline-none
            focus:border-emerald-500
            w-64
          "
        />
        <button
          type="submit"
          className="
            px-3 py-2
            rounded-lg
            bg-[#1a1a1a]
            border border-[#2a2a2a]
            text-sm
            hover:border-emerald-500
            transition-colors
          "
        >
          Filter
        </button>
        {tagFilter && (
          <button
            type="button"
            onClick={clearFilter}
            className="text-sm text-gray-500 hover:text-white"
          >
            Clear ({tagFilter})
          </button>
        )}
      </form>

      
{/* HOSTS LIST */}
<div className="w-full min-w-0 rounded-xl border border-[#2a2a2a] bg-[#1a1a1a]">

  {error && (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#2a2a2a] bg-red-950/20 px-5 py-4">
      <p className="text-sm text-red-300">{error}</p>
      <button
        type="button"
        onClick={() => refetch(tagFilter)}
        disabled={loading || refreshing}
        className="text-sm font-medium text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
      >
        {loading || refreshing ? "Retrying..." : "Retry"}
      </button>
    </div>
  )}

  {refreshing && !loading && !error && (
    <div className="border-b border-[#2a2a2a] px-5 py-2 text-xs text-gray-500">
      Refreshing host data...
    </div>
  )}

  {loading ? (
    <p className="p-5 text-sm text-gray-500">Loading hosts...</p>
  ) : error && hosts.length === 0 ? (
    <div className="p-5 text-sm text-gray-400">
      Unable to display hosts until the connection is restored.
    </div>
  ) : hosts.length === 0 ? (
    <p className="p-5 text-sm text-gray-500">
      {tagFilter
        ? `No hosts match tag "${tagFilter}".`
        : 'No hosts registered yet. Click "Add Host" to register your first one.'}
    </p>
  ) : (
    <div className="w-full min-w-0 overflow-x-auto">
      <table className="w-full min-w-[1100px] table-fixed text-sm">
        <thead>
          <tr className="border-b border-[#2a2a2a] text-left text-xs uppercase tracking-widest text-gray-500">
            <th className="w-[180px] px-5 py-3">Name</th>
            <th className="w-[120px] px-5 py-3">Status</th>
            <th className="w-[90px] px-5 py-3">CPU</th>
            <th className="w-[100px] px-5 py-3">Memory</th>
            <th className="w-[90px] px-5 py-3">Disk</th>
            <th className="w-[200px] px-5 py-3">Tags</th>
            <th className="w-[130px] px-5 py-3">Last Seen</th>
            <th className="w-[130px] px-5 py-3">Registered</th>
            <th className="w-[220px] px-5 py-3">Actions</th>
          </tr>
        </thead>

       <tbody>
  {hosts.filter((host) =>
    (host.name || '')
      .toLowerCase()
      .includes(searchInput.trim().toLowerCase())
  ).length === 0 ? (
    <tr>
      <td colSpan={9} className="px-5 py-8 text-center text-sm text-gray-500">
        No hosts match your search.
      </td>
    </tr>
  ) : (
    hosts
      .filter((host) =>
        (host.name || '')
          .toLowerCase()
          .includes(searchInput.trim().toLowerCase())
      )
      .map((host) => {
        const online = isOnline(host.last_seen_at);

            return (
              <tr
                key={host.id}
                className="border-b border-[#2a2a2a] last:border-0 hover:bg-white/[0.02]"
              >
                <td className="overflow-hidden px-5 py-4 font-medium">
                  <Link
                    to={`/hosts/${host.id}`}
                    title={host.name}
                    className="block truncate text-white transition-colors hover:text-emerald-400"
                  >
                    {host.name}
                  </Link>
                </td>

                <td className="px-5 py-4">
                  <span
                    className={`inline-flex items-center gap-2 whitespace-nowrap text-xs font-semibold uppercase ${
                      online ? "text-emerald-400" : "text-gray-500"
                    }`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${
                        online ? "bg-emerald-400" : "bg-gray-600"
                      }`}
                    />
                    {online ? "Online" : "Offline"}
                  </span>
                </td>

                <td className="whitespace-nowrap px-5 py-4 text-gray-300">
                  {host.cpu_usage != null
                    ? `${Number(host.cpu_usage).toFixed(1)}%`
                    : "—"}
                </td>

                <td className="whitespace-nowrap px-5 py-4 text-gray-300">
                  {host.memory_usage != null
                    ? `${Number(host.memory_usage).toFixed(1)}%`
                    : "—"}
                </td>

                <td className="whitespace-nowrap px-5 py-4 text-gray-300">
                  {host.disk_usage != null
                    ? `${Number(host.disk_usage).toFixed(1)}%`
                    : "—"}
                </td>

                <td className="overflow-hidden px-5 py-4">
                  {host.tags && host.tags.length > 0 ? (
                    <div className="flex max-w-full flex-wrap gap-1.5 overflow-hidden">
                      {host.tags.map((tag) => (
                        <span
                          key={tag}
                          title={tag}
                          className="inline-block max-w-full truncate overflow-hidden whitespace-nowrap rounded-full border border-[#2a2a2a] bg-[#0f0f0f] px-2 py-0.5 text-xs text-gray-300"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-gray-600">—</span>
                  )}
                </td>

                <td className="whitespace-nowrap px-5 py-4 text-gray-400">
                  {timeAgo(host.last_seen_at)}
                </td>

                <td className="whitespace-nowrap px-5 py-4 text-gray-400">
                  {new Date(host.created_at).toLocaleDateString()}
                </td>

                <td className="px-5 py-4">
                  <div className="flex items-center gap-4 whitespace-nowrap text-sm">
                    <button
                      type="button"
                      onClick={() => openEdit(host)}
                      className="font-medium text-gray-300 transition-colors hover:text-emerald-400"
                    >
                      Edit
                    </button>

                    <button
                      type="button"
                      onClick={() => openRotate(host)}
                      title="Regenerate API key"
                      className="font-medium text-gray-300 transition-colors hover:text-emerald-400"
                    >
                      New key
                    </button>

                    <button
                      type="button"
                      onClick={() => openDelete(host)}
                      className="font-medium text-red-400 transition-colors hover:text-red-300"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            );
                   })
      )}
        </tbody>
      </table>
    </div>
  )}
</div>


      {/* EDIT HOST */}
      {hostToEdit && (
        <Modal>
          <h2 className="text-xl font-bold mb-4">Edit Host</h2>

          <form onSubmit={handleEditSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Host name
              </label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                autoFocus
                className={inputClass}
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Tags <span className="text-gray-600">(comma-separated)</span>
              </label>
              <input
                type="text"
                value={editTags}
                onChange={(e) => setEditTags(e.target.value)}
                placeholder="env:prod, region:us-east"
                className={inputClass}
              />
            </div>

            {editError && (
              <p className="text-sm text-red-400">{editError}</p>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setHostToEdit(null)}
                className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={editSaving}
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
                {editSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* REGENERATE KEY: CONFIRM */}
      {hostToRotate && (
        <Modal>
          <h2 className="text-lg font-semibold text-white">
            Regenerate API key?
          </h2>

          <p className="mt-3 text-sm text-gray-400">
            The current key for{' '}
            <span className="font-medium text-white">{hostToRotate.name}</span>{' '}
            stops working immediately. Its agent will be rejected until you
            restart it with the new key. History is kept.
          </p>

          {rotateError && (
            <p className="mt-3 text-sm text-red-400">{rotateError}</p>
          )}

          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setHostToRotate(null)}
              className="rounded-lg px-4 py-2 text-sm text-gray-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRotate}
              disabled={rotating}
              className="
                rounded-lg
                bg-emerald-600
                hover:bg-emerald-500
                disabled:opacity-50
                px-4 py-2
                text-sm
                font-semibold
              "
            >
              {rotating ? 'Regenerating...' : 'Regenerate'}
            </button>
          </div>
        </Modal>
      )}

      {/* REGENERATE KEY: RESULT */}
      {rotatedKey && (
        <Modal>
          <KeyReveal
            heading={`New key for ${rotatedKey.name}`}
            apiKey={rotatedKey.apiKey}
            onDone={() => setRotatedKey(null)}
          />
        </Modal>
      )}

      {/* DELETE HOST */}
      {hostToDelete && (
        <Modal>
          <h2 className="text-lg font-semibold text-white">Delete host?</h2>

          <p className="mt-3 text-sm text-gray-400">
            Are you sure you want to delete{' '}
            <span className="font-medium text-white">{hostToDelete.name}</span>?
            This permanently removes all of its metrics, alerts, anomalies and
            history. This cannot be undone.
          </p>

          {deleteError && (
            <p className="mt-3 text-sm text-red-400">{deleteError}</p>
          )}

          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setHostToDelete(null)}
              className="rounded-lg px-4 py-2 text-sm text-gray-400 hover:text-white"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleDeleteHost}
              disabled={deleting}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500 disabled:opacity-50"
            >
              {deleting ? 'Deleting...' : 'Delete Host'}
            </button>
          </div>
        </Modal>
      )}

      {/* ADD HOST */}
      {showAddModal && (
        <Modal>
          {!newHost ? (
            <>
              <h2 className="text-xl font-bold mb-4">Add Host</h2>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    Host name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. prod-api-1"
                    autoFocus
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    Tags <span className="text-gray-600">(optional, comma-separated)</span>
                  </label>
                  <input
                    type="text"
                    value={tagsInput}
                    onChange={(e) => setTagsInput(e.target.value)}
                    placeholder="env:prod, region:us-east"
                    className={inputClass}
                  />
                </div>

                {error && (
                  <p className="text-sm text-red-400">{error}</p>
                )}

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={closeModal}
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
                    {submitting ? 'Registering...' : 'Register'}
                  </button>
                </div>
              </form>
            </>
          ) : (
            <KeyReveal
              heading={`${newHost.name} registered`}
              apiKey={newHost.api_key}
              onDone={closeModal}
            />
          )}
        </Modal>
      )}

    </div>
  )
}