import { describe, expect, test } from 'vitest';
import { buildWindowPayload } from './maintenance';

const NOW = new Date('2026-11-01T10:00:00Z').getTime();

function form(overrides = {}) {
  return {
    monitorId: '',
    reason: '',
    startMode: 'now',
    startsAt: '',
    durationChoice: '60',
    customMinutes: '',
    ...overrides,
  };
}

describe('buildWindowPayload', () => {
  test('builds an immediate window for all monitors', () => {
    expect(buildWindowPayload(form(), NOW)).toEqual({
      ok: true,
      payload: { monitor_id: null, duration_minutes: 60 },
    });
  });

  test('sends the monitor id as a number and trims the reason', () => {
    const result = buildWindowPayload(
      form({ monitorId: '7', reason: '  DB upgrade  ' }),
      NOW
    );

    expect(result.payload).toEqual({
      monitor_id: 7,
      duration_minutes: 60,
      reason: 'DB upgrade',
    });
  });

  test('omits an empty reason', () => {
    const result = buildWindowPayload(form({ reason: '   ' }), NOW);
    expect(result.payload).not.toHaveProperty('reason');
  });

  test('uses the custom duration when chosen', () => {
    const result = buildWindowPayload(
      form({ durationChoice: 'custom', customMinutes: '90' }),
      NOW
    );
    expect(result.payload.duration_minutes).toBe(90);
  });

  test.each(['', '0', '-5', '2.5', 'abc', '43201'])(
    'rejects an invalid custom duration: "%s"',
    (customMinutes) => {
      const result = buildWindowPayload(
        form({ durationChoice: 'custom', customMinutes }),
        NOW
      );
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/Duration/);
    }
  );

  test('accepts the maximum duration of 30 days', () => {
    const result = buildWindowPayload(
      form({ durationChoice: 'custom', customMinutes: '43200' }),
      NOW
    );
    expect(result.ok).toBe(true);
  });

  test('rejects a reason longer than 200 characters', () => {
    const result = buildWindowPayload(form({ reason: 'x'.repeat(201) }), NOW);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/200/);
  });

  test('sends starts_at as an ISO string for a scheduled window', () => {
    const result = buildWindowPayload(
      form({ startMode: 'later', startsAt: '2099-01-01T10:00' }),
      NOW
    );

    expect(result.ok).toBe(true);
    expect(result.payload.starts_at).toBe(
      new Date('2099-01-01T10:00').toISOString()
    );
  });

  test('requires a start time for a scheduled window', () => {
    const result = buildWindowPayload(form({ startMode: 'later' }), NOW);
    expect(result).toEqual({ ok: false, error: 'Choose a start date and time.' });
  });

  test('rejects a scheduled start in the past', () => {
    const result = buildWindowPayload(
      form({ startMode: 'later', startsAt: '2000-01-01T10:00' }),
      NOW
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/future/);
  });

  test('ignores a leftover start time in "right now" mode', () => {
    const result = buildWindowPayload(
      form({ startMode: 'now', startsAt: '2099-01-01T10:00' }),
      NOW
    );
    expect(result.payload).not.toHaveProperty('starts_at');
  });
});