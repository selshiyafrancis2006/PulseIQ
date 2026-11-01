import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AlertHistory from './AlertHistory';

const { apiFetch } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}));

vi.mock('../utils/apiFetch', () => ({
  apiFetch,
}));

const alerts = [
  {
    id: 1,
    severity: 'critical',
    metric_name: 'cpu_usage',
    current_value: 95,
    threshold_value: 80,
    timestamp: '2026-11-01T05:00:00.000Z',
  },
  {
    id: 2,
    severity: 'warning',
    metric_name: 'memory_usage',
    current_value: 88,
    threshold_value: 85,
    timestamp: '2026-11-01T05:01:00.000Z',
  },
  {
    id: 3,
    severity: 'info',
    metric_name: 'disk_usage',
    current_value: 40,
    threshold_value: 90,
    timestamp: '2026-11-01T05:02:00.000Z',
  },
  {
    id: 4,
    severity: 'critical',
    metric_name: 'host_offline',
    current_value: null,
    threshold_value: null,
    timestamp: '2026-11-01T05:03:00.000Z',
  },
];

function mockAlertsResponse(data = alerts) {
  apiFetch.mockResolvedValue({
    json: vi.fn().mockResolvedValue(data),
  });
}

describe('AlertHistory page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAlertsResponse();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('renders the Alert History heading and description', () => {
    render(<AlertHistory />);

    expect(
      screen.getByRole('heading', { name: 'Alert History' })
    ).toBeInTheDocument();

    expect(
      screen.getByText('Monitor system anomalies and triggered alerts')
    ).toBeInTheDocument();
  });

  test('fetches alerts from the API on mount', async () => {
    render(<AlertHistory />);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/alerts'
      );
    });
  });

  test('renders alerts returned by the API', async () => {
    render(<AlertHistory />);

    expect(await screen.findByText('CPU USAGE')).toBeInTheDocument();
    expect(screen.getByText('MEMORY USAGE')).toBeInTheDocument();
    expect(screen.getByText('DISK USAGE')).toBeInTheDocument();
    expect(screen.getByText('HOST OFFLINE')).toBeInTheDocument();
  });

  test('displays summary counts calculated from all alerts', async () => {
    render(<AlertHistory />);

    await screen.findByText('HOST OFFLINE');

    expect(screen.getByText('Total Alerts').parentElement).toHaveTextContent('4');
    expect(screen.getByText('Active Alerts').parentElement).toHaveTextContent('2');
    expect(screen.getByText('Warnings').parentElement).toHaveTextContent('1');
    expect(screen.getByText('Critical', { selector: 'p' }).parentElement).toHaveTextContent('2');
  });

  test('shows triggered and resolved statuses for regular alerts', async () => {
    render(<AlertHistory />);

    await screen.findByText('CPU USAGE');

    expect(screen.getAllByText('Triggered')).toHaveLength(2);
    expect(screen.getByText('Resolved')).toBeInTheDocument();
  });

  test('shows the host-offline explanation for offline alerts', async () => {
    render(<AlertHistory />);

    expect(await screen.findByText('HOST OFFLINE')).toBeInTheDocument();
    expect(screen.getByText('Host went offline')).toBeInTheDocument();
    expect(
      screen.getByText('No heartbeat received for more than 30 seconds.')
    ).toBeInTheDocument();
  });

  test('filters alerts by critical severity', async () => {
    render(<AlertHistory />);

    await screen.findByText('HOST OFFLINE');
    fireEvent.click(screen.getByRole('button', { name: 'critical' }));

    expect(screen.getByText('CPU USAGE')).toBeInTheDocument();
    expect(screen.getByText('HOST OFFLINE')).toBeInTheDocument();
    expect(screen.queryByText('MEMORY USAGE')).not.toBeInTheDocument();
    expect(screen.queryByText('DISK USAGE')).not.toBeInTheDocument();
  });

  test('filters alerts by warning severity', async () => {
    render(<AlertHistory />);

    await screen.findByText('HOST OFFLINE');
    fireEvent.click(screen.getByRole('button', { name: 'warning' }));

    expect(screen.getByText('MEMORY USAGE')).toBeInTheDocument();
    expect(screen.queryByText('CPU USAGE')).not.toBeInTheDocument();
    expect(screen.queryByText('DISK USAGE')).not.toBeInTheDocument();
    expect(screen.queryByText('HOST OFFLINE')).not.toBeInTheDocument();
  });

  test('filters alerts by info severity', async () => {
    render(<AlertHistory />);

    await screen.findByText('HOST OFFLINE');
    fireEvent.click(screen.getByRole('button', { name: 'info' }));

    expect(screen.getByText('DISK USAGE')).toBeInTheDocument();
    expect(screen.queryByText('CPU USAGE')).not.toBeInTheDocument();
    expect(screen.queryByText('MEMORY USAGE')).not.toBeInTheDocument();
  });

  test('restores all alerts when the all filter is selected', async () => {
    render(<AlertHistory />);

    await screen.findByText('HOST OFFLINE');
    fireEvent.click(screen.getByRole('button', { name: 'critical' }));

    expect(screen.queryByText('MEMORY USAGE')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'all' }));

    expect(screen.getByText('CPU USAGE')).toBeInTheDocument();
    expect(screen.getByText('MEMORY USAGE')).toBeInTheDocument();
    expect(screen.getByText('DISK USAGE')).toBeInTheDocument();
    expect(screen.getByText('HOST OFFLINE')).toBeInTheDocument();
  });

  test('keeps summary counts based on all alerts when a filter is applied', async () => {
    render(<AlertHistory />);

    await screen.findByText('HOST OFFLINE');
    fireEvent.click(screen.getByRole('button', { name: 'warning' }));

    expect(screen.getByText('MEMORY USAGE')).toBeInTheDocument();
    expect(screen.queryByText('CPU USAGE')).not.toBeInTheDocument();

    expect(screen.getByText('Total Alerts').parentElement).toHaveTextContent('4');
    expect(screen.getByText('Warnings').parentElement).toHaveTextContent('1');
    expect(screen.getByText('Critical', { selector: 'p' }).parentElement).toHaveTextContent('2');
  });

  test('shows no alert cards when the API returns an empty array', async () => {
    mockAlertsResponse([]);

    render(<AlertHistory />);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalled();
    });

    expect(screen.getByText('Total Alerts').parentElement).toHaveTextContent('0');
    expect(screen.queryByText('CPU USAGE')).not.toBeInTheDocument();
  });

  test('logs an API error without crashing the page', async () => {
    const error = new Error('Network unavailable');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    apiFetch.mockRejectedValue(error);

    render(<AlertHistory />);

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to fetch alerts',
        error
      );
    });

    expect(
      screen.getByRole('heading', { name: 'Alert History' })
    ).toBeInTheDocument();
  });

  test('refreshes alerts every 10 seconds', async () => {
    vi.useFakeTimers();

    render(<AlertHistory />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(apiFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });

    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  test('stops polling after the page unmounts', async () => {
    vi.useFakeTimers();

    const { unmount } = render(<AlertHistory />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(apiFetch).toHaveBeenCalledTimes(1);

    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });

    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});