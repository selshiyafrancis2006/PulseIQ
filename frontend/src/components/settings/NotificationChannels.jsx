import { useEffect, useRef, useState } from "react";
import useNotificationChannels, {
  getErrorMessage,
} from "../../hooks/useNotificationChannels";

const TYPE_LABELS = {
  slack: "Slack",
  webhook: "Webhook",
  email: "Email",
};

const URL_PLACEHOLDERS = {
  slack: "https://hooks.slack.com/services/...",
  webhook: "https://your-service.example.com/pulseiq",
};

export default function NotificationChannels() {
  const {
    channels,
    loading,
    error,
    createChannel,
    setChannelActive,
    deleteChannel,
    testChannel,
  } = useNotificationChannels();

  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState("slack");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const [testingId, setTestingId] = useState(null);
  const [testResults, setTestResults] = useState({});
  const resultTimeouts = useRef({});

useEffect(() => {
  const timeouts = resultTimeouts.current;
  return () => {
    Object.values(timeouts).forEach(clearTimeout);
  };
}, []);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState("");

  const openForm = () => {
    setShowForm(true);
    setType("slack");
    setName("");
    setUrl("");
    setEmail("");
    setFormError("");
  };

  const handleCreate = async (e) => {
    e.preventDefault();

    if (!name.trim()) {
      setFormError("Name is required");
      return;
    }
    if (type === "email" && !email.trim()) {
      setFormError("Recipient email is required");
      return;
    }
    if (type !== "email" && !url.trim()) {
      setFormError(
        type === "slack"
          ? "Slack incoming webhook URL is required"
          : "Webhook URL is required"
      );
      return;
    }

    setSubmitting(true);
    setFormError("");

    try {
      await createChannel({
        type,
        name: name.trim(),
        url: type === "email" ? null : url.trim(),
        email: type === "email" ? email.trim() : null,
      });
      setShowForm(false);
      setUrl("");
      setEmail("");
    } catch (err) {
      console.error("Failed to create channel:", err);
      setFormError(getErrorMessage(err, "Failed to create channel"));
    } finally {
      setSubmitting(false);
    }
  };


const handleTest = async (id) => {
  if (resultTimeouts.current[id]) {
    clearTimeout(resultTimeouts.current[id]);
    delete resultTimeouts.current[id];
  }

  setTestingId(id);
  setTestResults((prev) => {
    const next = { ...prev };
    delete next[id];
    return next;
  });

  try {
    const result = await testChannel(id);

    setTestResults((prev) => ({ ...prev, [id]: result }));

    // Clear successful messages after 5 seconds.
    // Keep errors visible so they can be read.
    if (result?.ok) {
      resultTimeouts.current[id] = setTimeout(() => {
        setTestResults((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });

        delete resultTimeouts.current[id];
      }, 5000);
    }
  } finally {
    setTestingId(null);
  }
};

  const handleToggle = async (channel) => {
    setBusyId(channel.id);
    setActionError("");

    try {
      await setChannelActive(channel.id, !channel.is_active);
    } catch (err) {
      console.error("Failed to update notification channel:", err);
      setActionError(getErrorMessage(err, "Failed to update channel status"));
    } finally {
      setBusyId(null);
    }
  };
  const handleDelete = async (id) => {
    setBusyId(id);
    setActionError("");

    try {
      await deleteChannel(id);
      setConfirmDeleteId(null);
    } catch (err) {
      console.error("Failed to delete channel:", err);
      setActionError(getErrorMessage(err, "Failed to delete channel"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between border-b border-gray-800 pb-2">
        <div>
          <h2 className="text-lg font-semibold text-white">
            Notification Channels
          </h2>
          <p className="mt-1 text-sm text-gray-400">
            Where PulseIQ sends monitor DOWN and recovery alerts.
          </p>
        </div>

        {!showForm && (
          <button
            onClick={openForm}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
          >
            + Add Channel
          </button>
        )}
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="space-y-4 rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-5"
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs uppercase tracking-widest text-gray-500">
                Type
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full rounded-lg border border-[#2a2a2a] bg-[#0f0f0f] px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
              >
                <option value="slack">Slack</option>
                <option value="webhook">Generic webhook</option>
                <option value="email">Email</option>
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs uppercase tracking-widest text-gray-500">
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. #ops-alerts"
                maxLength={100}
                autoFocus
                className="w-full rounded-lg border border-[#2a2a2a] bg-[#0f0f0f] px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div>
            {type === "email" ? (
              <>
                <label className="mb-1 block text-xs uppercase tracking-widest text-gray-500">
                  Recipient email address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="alerts@example.com"
                  maxLength={254}
                  autoComplete="email"
                  required
                  className="w-full rounded-lg border border-[#2a2a2a] bg-[#0f0f0f] px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Alerts are sent to this address using the server SMTP configuration.
                </p>
              </>
            ) : (
              <>
                <label className="mb-1 block text-xs uppercase tracking-widest text-gray-500">
                  {type === "slack" ? "Slack incoming webhook URL" : "Webhook URL"}
                </label>
                <input
                  type="password"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={URL_PLACEHOLDERS[type]}
                  autoComplete="off"
                  required
                  className="w-full rounded-lg border border-[#2a2a2a] bg-[#0f0f0f] px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  The URL is stored on the server and is never shown again after
                  saving.
                </p>
              </>
            )}
          </div>

          {formError && (
            <p className="text-sm text-red-400">{formError}</p>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
            >
              {submitting ? "Saving..." : "Save Channel"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg bg-[#2a2a2a] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#333]"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {actionError && (
        <p className="text-sm text-red-400">{actionError}</p>
      )}

      <div className="overflow-hidden rounded-xl border border-[#2a2a2a] bg-[#1a1a1a]">
        {loading ? (
          <p className="p-5 text-sm text-gray-500">Loading channels...</p>
        ) : error ? (
          <p className="p-5 text-sm text-red-400">{error}</p>
        ) : channels.length === 0 ? (
          <p className="p-5 text-sm text-gray-500">
            No channels yet. Add a Slack, webhook, or email channel to get notified
            when a monitor goes down.
          </p>
        ) : (
          <ul>
            {channels.map((channel) => {
              const result = testResults[channel.id];
              const isConfirming = confirmDeleteId === channel.id;
              const isBusy = busyId === channel.id;

              return (
                <li
                  key={channel.id}
                  className="space-y-2 border-b border-[#2a2a2a] px-5 py-4 last:border-0"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white">
                          {channel.name}
                        </span>
                        <span className="rounded-md bg-[#2a2a2a] px-2 py-0.5 text-xs text-gray-300">
                          {TYPE_LABELS[channel.type] || channel.type}
                        </span>
                        <span
                          className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                            channel.is_active
                              ? "bg-emerald-600/20 text-emerald-400"
                              : "bg-yellow-600/20 text-yellow-400"
                          }`}
                        >
                          {channel.is_active ? "Active" : "Paused"}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-gray-500">
                        {channel.type === "email" ? channel.email_hint : channel.url_hint}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {isConfirming ? (
                        <>
                          <span className="text-xs text-gray-400">
                            Delete this channel?
                          </span>
                          <button
                            onClick={() => handleDelete(channel.id)}
                            disabled={isBusy}
                            className="rounded-md bg-red-600/20 px-3 py-1.5 text-xs font-semibold text-red-400 transition-colors hover:bg-red-600/30 disabled:opacity-50"
                          >
                            {isBusy ? "Deleting..." : "Confirm"}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="rounded-md bg-[#2a2a2a] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#333]"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => handleTest(channel.id)}
                            disabled={testingId === channel.id}
                            className="rounded-md bg-emerald-600/20 px-3 py-1.5 text-xs font-semibold text-emerald-400 transition-colors hover:bg-emerald-600/30 disabled:opacity-50"
                          >
                            {testingId === channel.id ? "Sending..." : "Send test"}
                          </button>
                          <button
                            onClick={() => handleToggle(channel)}
                            disabled={isBusy}
                            className="rounded-md bg-[#2a2a2a] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#333] disabled:opacity-50"
                          >
                            {channel.is_active ? "Pause" : "Resume"}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(channel.id)}
                            className="rounded-md bg-red-600/10 px-3 py-1.5 text-xs font-semibold text-red-400 transition-colors hover:bg-red-600/20"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {result && (
                    <p
                      className={`text-xs ${
                        result.ok ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {result.message}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
