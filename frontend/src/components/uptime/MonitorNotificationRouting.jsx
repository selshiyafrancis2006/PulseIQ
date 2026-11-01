import { useEffect, useState } from 'react';
import api from '../../services/api';
import useNotificationChannels, {
  getErrorMessage,
} from '../../hooks/useNotificationChannels';

const TYPE_LABELS = {
  slack: 'Slack',
  webhook: 'Webhook',
  email: 'Email',
};

export default function MonitorNotificationRouting({ monitorId }) {
  const {
    channels,
    loading: channelsLoading,
    error: channelsError,
  } = useNotificationChannels();

  const [routingMode, setRoutingMode] = useState('ALL');
  const [selectedChannelIds, setSelectedChannelIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [routingLoaded, setRoutingLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;

    const loadRouting = async () => {
      setLoading(true);
      setRoutingLoaded(false);
      setError('');

      try {
        const { data } = await api.get(
          `/monitors/${monitorId}/notification-channels`
        );

        if (!active) return;

        setRoutingMode(data.routing_mode === 'SELECTED' ? 'SELECTED' : 'ALL');
        setSelectedChannelIds(
          Array.isArray(data.channel_ids)
            ? data.channel_ids.map(Number)
            : []
        );
        setRoutingLoaded(true);
      } catch (err) {
        if (active) {
          setError(getErrorMessage(err, 'Unable to load notification routing.'));
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadRouting();

    return () => {
      active = false;
    };
  }, [monitorId]);

  const toggleChannel = (channelId) => {
    setSelectedChannelIds((current) =>
      current.includes(Number(channelId))
        ? current.filter((id) => id !== Number(channelId))
        : [...current, Number(channelId)]
    );
    setMessage('');
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setMessage('');

    try {
      await api.put(`/monitors/${monitorId}/notification-channels`, {
        routing_mode: routingMode,
        channel_ids: routingMode === 'SELECTED' ? selectedChannelIds : [],
      });

      setMessage('Notification routing saved.');
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to save notification routing.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-xl border border-[#2a2a2a] bg-[#111]">
      <div className="border-b border-[#252525] px-5 py-4">
        <h2 className="font-semibold text-white">Notification routing</h2>
        <p className="mt-1 text-xs text-gray-500">
          Choose which notification channels receive alerts for this monitor.
        </p>
      </div>

      <div className="space-y-5 p-5">
        {loading ? (
          <p className="text-sm text-gray-500">Loading notification routing...</p>
        ) : (
          <>
            <div className="space-y-3">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="radio"
                  name={`routing-mode-${monitorId}`}
                  value="ALL"
                  checked={routingMode === 'ALL'}
                  onChange={() => {
                    setRoutingMode('ALL');
                    setMessage('');
                  }}
                  className="mt-1 accent-emerald-500"
                />
                <span>
                  <span className="block text-sm font-medium text-white">
                    All active channels
                  </span>
                  <span className="mt-1 block text-xs text-gray-500">
                    Send this monitor's notifications to every active channel
                    in your account.
                  </span>
                </span>
              </label>

              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="radio"
                  name={`routing-mode-${monitorId}`}
                  value="SELECTED"
                  checked={routingMode === 'SELECTED'}
                  onChange={() => {
                    setRoutingMode('SELECTED');
                    setMessage('');
                  }}
                  className="mt-1 accent-emerald-500"
                />
                <span>
                  <span className="block text-sm font-medium text-white">
                    Only selected channels
                  </span>
                  <span className="mt-1 block text-xs text-gray-500">
                    Send notifications only to the channels checked below.
                  </span>
                </span>
              </label>
            </div>

            {routingMode === 'SELECTED' && (
              <div className="rounded-lg border border-[#292929] bg-[#0c0c0c]">
                <div className="border-b border-[#252525] px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                    Select channels
                  </p>
                </div>

                {channelsLoading ? (
                  <p className="p-4 text-sm text-gray-500">Loading channels...</p>
                ) : channelsError ? (
                  <p role="alert" className="p-4 text-sm text-red-400">
                    {channelsError}
                  </p>
                ) : channels.length === 0 ? (
                  <p className="p-4 text-sm text-gray-500">
                    No notification channels exist yet. Create one in Settings
                    before selecting channels here.
                  </p>
                ) : (
                  <ul>
                    {channels.map((channel) => (
                      <li
                        key={channel.id}
                        className="border-b border-[#222] px-4 py-3 last:border-0"
                      >
                        <label className="flex cursor-pointer items-center justify-between gap-3">
                          <span className="flex min-w-0 items-center gap-3">
                            <input
                              type="checkbox"
                              checked={selectedChannelIds.includes(Number(channel.id))}
                              onChange={() => toggleChannel(channel.id)}
                              className="accent-emerald-500"
                            />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-white">
                                {channel.name}
                              </span>
                              <span className="mt-0.5 block text-xs text-gray-500">
                                {TYPE_LABELS[channel.type] || channel.type}
                              </span>
                            </span>
                          </span>

                          <span
                            className={`shrink-0 rounded-md px-2 py-1 text-xs ${
                              channel.is_active
                                ? 'bg-emerald-600/15 text-emerald-400'
                                : 'bg-yellow-600/15 text-yellow-400'
                            }`}
                          >
                            {channel.is_active ? 'Active' : 'Paused'}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}

                {!channelsLoading && !channelsError && channels.length > 0 && (
                  <p className="border-t border-[#252525] px-4 py-3 text-xs text-gray-500">
                    {selectedChannelIds.length} channel
                    {selectedChannelIds.length === 1 ? '' : 's'} selected.
                    Paused channels will not receive notifications until resumed.
                  </p>
                )}
              </div>
            )}

            {routingMode === 'SELECTED' && selectedChannelIds.length === 0 && (
              <p className="rounded-lg border border-amber-900/60 bg-amber-950/20 p-3 text-xs text-amber-300">
                No channels are selected. Saving this setting will suppress
                notifications for this monitor.
              </p>
            )}
          </>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        {message && (
          <p role="status" className="text-sm text-emerald-400">
            {message}
          </p>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={!routingLoaded || loading || saving || (routingMode === 'SELECTED' && (channelsLoading || Boolean(channelsError)))}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save routing'}
          </button>
        </div>
      </div>
    </section>
  );
}
