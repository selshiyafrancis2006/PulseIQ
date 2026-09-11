import { useState } from 'react'
import useHosts from '../hooks/useHosts'

function timeAgo(dateString) {
  if (!dateString) return 'Never'

  const diffSec = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000)

  if (diffSec < 60) return `${diffSec}s ago`
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  return `${Math.floor(diffSec / 86400)}d ago`
}

function isOnline(lastSeenAt) {
  if (!lastSeenAt) return false
  return Date.now() - new Date(lastSeenAt).getTime() < 30000
}

function parseTagsInput(input) {
  return input
    .split(',')
    .map(tag => tag.trim())
    .filter(tag => tag.length > 0)
}

export default function Hosts() {

  const { hosts, loading, registerHost, tagFilter, setTagFilter } = useHosts()

  const [showAddModal, setShowAddModal] = useState(false)
  const [name, setName] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [newHost, setNewHost] = useState(null) // holds registration result (incl. one-time api_key)
  const [copied, setCopied] = useState(false)

  const [filterInput, setFilterInput] = useState('')

  const openModal = () => {
    setShowAddModal(true)
    setName('')
    setTagsInput('')
    setError('')
    setNewHost(null)
    setCopied(false)
  }

  const closeModal = () => setShowAddModal(false)

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

  const handleCopy = async () => {
    if (!newHost?.api_key) return

    try {
      await navigator.clipboard.writeText(newHost.api_key)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Clipboard copy failed:', err)
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

  return (
    <div className="space-y-8 text-white">

      {/* HEADER */}
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
      <div className="
        bg-[#1a1a1a]
        border border-[#2a2a2a]
        rounded-xl
        overflow-hidden
      ">

        {loading ? (
          <p className="p-5 text-sm text-gray-500">Loading hosts...</p>
        ) : hosts.length === 0 ? (
          <p className="p-5 text-sm text-gray-500">
            {tagFilter
              ? `No hosts match tag "${tagFilter}".`
              : 'No hosts registered yet. Click "Add Host" to register your first one.'}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#2a2a2a] text-left text-gray-500 uppercase text-xs tracking-widest">
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Tags</th>
                <th className="px-5 py-3">Last Seen</th>
                <th className="px-5 py-3">Registered</th>
              </tr>
            </thead>
            <tbody>
              {hosts.map((host) => {
                const online = isOnline(host.last_seen_at)
                return (
                  <tr key={host.id} className="border-b border-[#2a2a2a] last:border-0">
                    <td className="px-5 py-4 font-medium">{host.name}</td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center gap-2 text-xs font-semibold uppercase ${online ? 'text-emerald-400' : 'text-gray-500'}`}>
                        <span className={`w-2 h-2 rounded-full ${online ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                        {online ? 'Online' : 'Offline'}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      {host.tags && host.tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {host.tags.map((tag) => (
                            <span
                              key={tag}
                              className="
                                px-2 py-0.5
                                rounded-full
                                bg-[#0f0f0f]
                                border border-[#2a2a2a]
                                text-xs
                                text-gray-300
                              "
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-600">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-gray-400">{timeAgo(host.last_seen_at)}</td>
                    <td className="px-5 py-4 text-gray-400">
                      {new Date(host.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

      </div>

      {/* ADD HOST MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-6 w-full max-w-md">

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

                  <div>
                    <label className="block text-sm text-gray-400 mb-1">
                      Tags <span className="text-gray-600">(optional, comma-separated)</span>
                    </label>
                    <input
                      type="text"
                      value={tagsInput}
                      onChange={(e) => setTagsInput(e.target.value)}
                      placeholder="env:prod, region:us-east"
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
              <>
                <h2 className="text-xl font-bold mb-2 text-emerald-400">
                  {newHost.name} registered
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
                    {newHost.api_key}
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

                <p className="text-xs text-gray-500 mb-6">
                  Run the agent against this host with:{' '}
                  <code className="text-gray-400">
                    API_KEY=&lt;key above&gt; node agent/collector.js
                  </code>
                </p>

                <div className="flex justify-end">
                  <button
                    onClick={closeModal}
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
            )}

          </div>
        </div>
      )}

    </div>
  )
}