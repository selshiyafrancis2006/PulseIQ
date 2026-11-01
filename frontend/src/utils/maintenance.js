// Helpers for the maintenance windows page.
// The API wants exactly one of ends_at or duration_minutes; this UI always
// sends duration_minutes, plus starts_at only for a scheduled window.

export const DURATION_PRESETS = [
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: 480, label: '8 hours' },
  { value: 1440, label: '24 hours' },
];

export const MAX_DURATION_MINUTES = 30 * 24 * 60;
export const MAX_REASON_LENGTH = 200;

// Returns { ok: true, payload } or { ok: false, error }.
export function buildWindowPayload(form, now = Date.now()) {
  const minutes =
    form.durationChoice === 'custom'
      ? Number(form.customMinutes)
      : Number(form.durationChoice);

  if (
    !Number.isInteger(minutes) ||
    minutes < 1 ||
    minutes > MAX_DURATION_MINUTES
  ) {
    return {
      ok: false,
      error: `Duration must be a whole number of minutes between 1 and ${MAX_DURATION_MINUTES}.`,
    };
  }

  const reason = (form.reason || '').trim();

  if (reason.length > MAX_REASON_LENGTH) {
    return {
      ok: false,
      error: `Reason can be at most ${MAX_REASON_LENGTH} characters.`,
    };
  }

  const payload = {
    monitor_id: form.monitorId === '' ? null : Number(form.monitorId),
    duration_minutes: minutes,
  };

  if (reason) payload.reason = reason;

  if (form.startMode === 'later') {
    const start = new Date(form.startsAt);

    if (!form.startsAt || Number.isNaN(start.getTime())) {
      return { ok: false, error: 'Choose a start date and time.' };
    }

    if (start.getTime() <= now) {
      return { ok: false, error: 'The start time must be in the future.' };
    }

    payload.starts_at = start.toISOString();
  }

  return { ok: true, payload };
}

export function formatWindowDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
}