import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { apiFetch } from '../utils/apiFetch';
import HostDetails from './HostDetails';

vi.mock('../utils/apiFetch', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('../components/metrics/MetricsChart', () => ({
  default: ({ selectedMetrics, timeRange }) => (
    <div data-testid="metrics-chart">
      {selectedMetrics.join(',')}:{timeRange}
    </div>
  ),
}));

const host = {
  id: 1,
  name: 'production-server',
  hostname: 'prod-node-01',
  status: 'online',
  last_seen_at: '2026-11-01T05:00:00Z',
  tags: ['env:prod', 'region:ap-south'],
  ip_address: '192.168.1.10',
  os: 'Windows 11',
  platform: 'win32',
  arch: 'x64',
  cpu_model: 'Intel Core i7',
  cpu_cores: 8,
  total_memory_mb: 8192,
  agent_version: '1.0.0',
  boot_time: '2026-10-31T05:00:00Z',
  created_at: '2026-10-01T05:00:00Z',
  cpu_usage: 45.5,
  memory_usage: 62.3,
  disk_usage: 70.1,
  network_in: 512,
  network_out: 2048,
};

function response(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  };
}

function renderPage(id = '1') {
  return render(
    <MemoryRouter initialEntries={[`/hosts/${id}`]}>
      <Routes>
        <Route path="/hosts/:id" element={<HostDetails />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();

  apiFetch.mockImplementation((url) => {
    if (url.includes('/api/hosts/')) {
      return Promise.resolve(response(host));
    }

    if (url.includes('/api/metrics')) {
      return Promise.resolve(response([]));
    }

    if (url.includes('/api/alerts')) {
      return Promise.resolve(response([]));
    }

    throw new Error(`Unexpected API request: ${url}`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HostDetails page', () => {
  test('shows loading state before host data is available', () => {
    apiFetch.mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(screen.getByText('Loading host...')).toBeInTheDocument();
  });

  test('loads host details, metrics, and alerts', async () => {
    renderPage();

    expect(await screen.findByText('System info')).toBeInTheDocument();
    expect(screen.getByText('prod-node-01')).toBeInTheDocument();
    expect(screen.getByText('192.168.1.10')).toBeInTheDocument();
    expect(screen.getByText('Windows 11')).toBeInTheDocument();
    expect(screen.getByText('Intel Core i7')).toBeInTheDocument();
    expect(screen.getByText('env:prod')).toBeInTheDocument();
    expect(screen.getByText('region:ap-south')).toBeInTheDocument();

    expect(apiFetch).toHaveBeenCalledTimes(3);
    expect(screen.getAllByTestId('metrics-chart')).toHaveLength(3);
  });

  test('shows offline state and last-known metrics for an offline host', async () => {
    apiFetch.mockImplementation((url) => {
      if (url.includes('/api/hosts/')) {
        return Promise.resolve(response({ ...host, status: 'offline' }));
      }

      return Promise.resolve(response([]));
    });

    renderPage();

    expect(await screen.findByText('Offline')).toBeInTheDocument();
    expect(screen.getAllByText('Last known')).toHaveLength(5);
    expect(screen.getByText('Uptime').parentElement).toHaveTextContent('Offline');
    expect(screen.queryByText('Waiting for first heartbeat')).not.toBeInTheDocument();
  });

  test('shows pending state while waiting for the first heartbeat', async () => {
    apiFetch.mockImplementation((url) => {
      if (url.includes('/api/hosts/')) {
        return Promise.resolve(
          response({
            ...host,
            status: 'pending',
            last_seen_at: null,
            hostname: null,
            os: null,
          })
        );
      }

      return Promise.resolve(response([]));
    });

    renderPage();

    expect(
      await screen.findByText('Waiting for first heartbeat')
    ).toBeInTheDocument();

    expect(
      screen.getByText('No system info yet. It appears once the agent reports in.')
    ).toBeInTheDocument();
  });

  test('renders offline and recovered alert descriptions', async () => {
    const alerts = [
      {
        id: 10,
        metric_name: 'host_offline',
        severity: 'Critical',
      },
      {
        id: 11,
        metric_name: 'host_recovered',
        severity: 'Info',
      },
      {
        id: 12,
        metric_name: 'cpu_usage',
        current_value: 95,
        threshold_value: 80,
        severity: 'Critical',
      },
    ];

    apiFetch.mockImplementation((url) => {
      if (url.includes('/api/hosts/')) {
        return Promise.resolve(response(host));
      }

      if (url.includes('/api/alerts')) {
        return Promise.resolve(response(alerts));
      }

      return Promise.resolve(response([]));
    });

    renderPage();

    expect(await screen.findByText('HOST OFFLINE')).toBeInTheDocument();
    expect(screen.getByText('HOST RECOVERED')).toBeInTheDocument();
    expect(screen.getByText('cpu_usage')).toBeInTheDocument();
    expect(screen.getByText('3 alerts')).toBeInTheDocument();
    expect(screen.getByText('Recovered')).toBeInTheDocument();
  });

  test('shows an API error and retries successfully', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    apiFetch.mockRejectedValueOnce(new Error('Host not found (404).'));

    renderPage();

    expect(
      await screen.findByText('Host not found (404).')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('System info')).toBeInTheDocument();
    expect(screen.getByText('prod-node-01')).toBeInTheDocument();

    consoleError.mockRestore();
  });

  test('changes the metrics time range and reloads data', async () => {
    renderPage();

    expect(await screen.findByText('System info')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '6H' }));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/metrics?range=6h&host_id=1')
      );
    });

    expect(screen.getAllByTestId('metrics-chart')).toHaveLength(3);
    expect(screen.getAllByText(/:6h$/)).toHaveLength(3);
  });

  test('loads older alerts and removes duplicate alert IDs', async () => {
    const initialAlerts = Array.from({ length: 20 }, (_, index) => ({
      id: index + 1,
      metric_name: `metric_${index + 1}`,
      current_value: 50,
      threshold_value: 80,
      severity: 'Warning',
    }));

    apiFetch.mockImplementation((url) => {
      if (url.includes('/api/hosts/')) {
        return Promise.resolve(response(host));
      }

      if (url.includes('/api/alerts')) {
        return Promise.resolve(response(initialAlerts));
      }

      return Promise.resolve(response([]));
    });

    renderPage();

    expect(await screen.findByText('20 alerts')).toBeInTheDocument();

    apiFetch.mockImplementationOnce((url) => {
      if (url.includes('offset=20')) {
        return Promise.resolve(
          response([
            initialAlerts[19],
            {
              id: 21,
              metric_name: 'older_cpu_alert',
              current_value: 91,
              threshold_value: 80,
              severity: 'Critical',
            },
          ])
        );
      }

      throw new Error(`Unexpected pagination request: ${url}`);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Load More Alerts' }));

    expect(await screen.findByText('21 alerts')).toBeInTheDocument();
    expect(screen.getByText('older_cpu_alert')).toBeInTheDocument();
    expect(screen.getAllByText('metric_20')).toHaveLength(1);
  });
});