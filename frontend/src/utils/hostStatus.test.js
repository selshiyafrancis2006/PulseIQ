import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  STATUS_META,
  getHostStatus,
  timeAgo,
  formatUptime,
  formatMemory,
  formatRate,
} from './hostStatus';

const NOW = new Date('2026-11-01T05:00:00Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getHostStatus', () => {
  test.each(['online', 'offline', 'pending'])(
    'returns the backend-provided %s status',
    (status) => expect(getHostStatus({ status })).toBe(status)
  );

  test.each([undefined, null, {}, { status: 'unknown' }, { status: 'ONLINE' }])(
    'defaults invalid or missing status to pending',
    (host) => expect(getHostStatus(host)).toBe('pending')
  );

  test('provides metadata for all supported statuses', () => {
    expect(Object.keys(STATUS_META)).toEqual(['online', 'offline', 'pending']);
    expect(STATUS_META.online.label).toBe('Online');
    expect(STATUS_META.offline.label).toBe('Offline');
    expect(STATUS_META.pending.label).toBe('Pending');
  });
});

describe('timeAgo', () => {
  test('returns Never for missing timestamps', () => {
    expect(timeAgo(null)).toBe('Never');
    expect(timeAgo(undefined)).toBe('Never');
  });

  test.each([
    [0, '0s ago'],
    [59, '59s ago'],
    [60, '1m ago'],
    [3599, '59m ago'],
    [3600, '1h ago'],
    [86399, '23h ago'],
    [86400, '1d ago'],
    [172800, '2d ago'],
  ])('formats %i elapsed seconds', (seconds, expected) => {
    const date = new Date(NOW.getTime() - seconds * 1000).toISOString();
    expect(timeAgo(date)).toBe(expected);
  });

  test('does not return negative elapsed time for future timestamps', () => {
    const future = new Date(NOW.getTime() + 60000).toISOString();
    expect(timeAgo(future)).toBe('0s ago');
  });
});

describe('formatUptime', () => {
  test('returns an em dash for missing boot times', () => {
    expect(formatUptime(null)).toBe('—');
    expect(formatUptime(undefined)).toBe('—');
  });

  test.each([
    [300, '5m'],
    [3600, '1h 0m'],
    [5400, '1h 30m'],
    [86400, '1d 0h'],
    [90000, '1d 1h'],
  ])('formats %i seconds of uptime', (seconds, expected) => {
    const bootTime = new Date(NOW.getTime() - seconds * 1000).toISOString();
    expect(formatUptime(bootTime)).toBe(expected);
  });

  test('returns an em dash for invalid and future boot times', () => {
    expect(formatUptime('not-a-date')).toBe('—');
    const future = new Date(NOW.getTime() + 60000).toISOString();
    expect(formatUptime(future)).toBe('—');
  });
});

describe('formatMemory', () => {
  test('returns an em dash for missing values', () => {
    expect(formatMemory(null)).toBe('—');
    expect(formatMemory(undefined)).toBe('—');
  });

  test.each([
    [512, '512 MB'],
    [1023, '1023 MB'],
    [1024, '1.0 GB'],
    [1536, '1.5 GB'],
    [2048, '2.0 GB'],
  ])('formats %i MB', (value, expected) => {
    expect(formatMemory(value)).toBe(expected);
  });
});

describe('formatRate', () => {
  test('returns an em dash for missing values', () => {
    expect(formatRate(null)).toBe('—');
    expect(formatRate(undefined)).toBe('—');
  });

  test.each([
    [12, '12.0 KB/s'],
    [1023, '1023.0 KB/s'],
    [1024, '1.0 MB/s'],
    [1536, '1.5 MB/s'],
    [2048, '2.0 MB/s'],
    ['2048', '2.0 MB/s'],
  ])('formats rate %s', (value, expected) => {
    expect(formatRate(value)).toBe(expected);
  });
});