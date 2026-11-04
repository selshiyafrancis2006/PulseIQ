import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { apiFetch } from '../utils/apiFetch';
import useHosts from '../hooks/useHosts';
import Metrics from './Metrics';

vi.mock('../utils/apiFetch', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('../hooks/useHosts', () => ({
  default: vi.fn(),
}));

// The children are checked on their own; here we only look at what the page gives them
vi.mock('../components/shared/hostSelector', () => ({
  default: ({ selectedHostId }) => (
    <div data-testid="host-selector">{selectedHostId}</div>
  ),
}));

vi.mock('../components/metrics/StatsCards', () => ({
  default: ({ selectedMetric }) => (
    <div data-testid="stats">{selectedMetric}</div>
  ),
}));

vi.mock('../components/metrics/MetricsChart', () => ({
  default: ({ metrics, timeRange }) => (
    <div data-testid="chart">
      {timeRange}:{metrics.map((metric) => metric.cpu_usage).join(',')}
    </div>
  ),
}));

vi.mock('../components/metrics/MetricsTable', () => ({
  default: ({ selectedMetric }) => (
    <div data-testid="table">{selectedMetric}</div>
  ),
}));

function response(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  };
}

const TIMESTAMP = '2026-11-01T10:00:00.000Z';

function renderPage() {
  return render(<Metrics />);
}

beforeEach(() => {
  vi.clearAllMocks();

  useHosts.mockReturnValue({
    hosts: [{ id: 1, name: 'prod-server' }],
    selectedHostId: 1,
    setSelectedHostId: vi.fn(),
  });

  apiFetch.mockResolvedValue(response([]));

  // jsdom has no object URLs
  window.URL.createObjectURL = vi.fn(() => 'blob:test');
  window.URL.revokeObjectURL = vi.fn();

  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Metrics page - loading data', () => {
  test('requests the last minute for the selected host', async () => {
    renderPage();

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/metrics?range=1m&host_id=1')
      )
    );
  });

  test('does not request anything until a host is selected', () => {
    useHosts.mockReturnValue({
      hosts: [],
      selectedHostId: null,
      setSelectedHostId: vi.fn(),
    });

    renderPage();

    expect(apiFetch).not.toHaveBeenCalled();
  });

  test('changing the time range reloads the data and tells the chart', async () => {
    apiFetch.mockResolvedValue(
      response([{ id: 1, timestamp: TIMESTAMP, cpu_usage: 5 }])
    );

    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('chart')).toHaveTextContent('1m:5')
    );

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: '7d' },
    });

    await waitFor(() =>
      expect(apiFetch).toHaveBeenLastCalledWith(
        expect.stringContaining('/api/metrics?range=7d&host_id=1')
      )
    );
    await waitFor(() =>
      expect(screen.getByTestId('chart')).toHaveTextContent('7d:5')
    );
  });

  test('gives the stats and the table the selected metric', async () => {
    renderPage();

    expect(screen.getByTestId('stats')).toHaveTextContent('cpu_usage');
    expect(screen.getByTestId('table')).toHaveTextContent('cpu_usage');
  });

  test('ignores a slow response for a range that is no longer selected', async () => {
    let resolveSlow;
    const slow = new Promise((resolve) => {
      resolveSlow = resolve;
    });

    apiFetch.mockImplementation((url) =>
      url.includes('range=1m')
        ? slow
        : Promise.resolve(
            response([{ id: 2, timestamp: TIMESTAMP, cpu_usage: 222 }])
          )
    );

    renderPage();

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: '7d' },
    });

    await waitFor(() =>
      expect(screen.getByTestId('chart')).toHaveTextContent('7d:222')
    );

    // The old 1-minute request finally answers
    await act(async () => {
      resolveSlow(
        response([{ id: 1, timestamp: TIMESTAMP, cpu_usage: 111 }])
      );
    });

    expect(screen.getByTestId('chart')).toHaveTextContent('7d:222');
  });
});

describe('Metrics page - errors', () => {
  test('shows the error message sent by the server', async () => {
    apiFetch.mockResolvedValue(response({ error: 'Host not found' }, 404));

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Host not found');
    // The error body is never handed to the chart as data
    expect(screen.getByTestId('chart')).toHaveTextContent(/^1m:$/);
  });

  test('shows a generic message when the error body is not JSON', async () => {
    apiFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('not json');
      },
    });

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to load metrics (HTTP 500)'
    );
  });

  test('shows a message when the server cannot be reached', async () => {
    apiFetch.mockRejectedValue(new Error('network down'));

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not reach the server'
    );
  });

  test('rejects a response that is not a list of rows', async () => {
    apiFetch.mockResolvedValue(response({ unexpected: true }));

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unexpected response from the server'
    );
    expect(screen.getByTestId('chart')).toHaveTextContent(/^1m:$/);
  });

  test('shows no error when the request succeeds', async () => {
    apiFetch.mockResolvedValue(
      response([{ id: 1, timestamp: TIMESTAMP, cpu_usage: 5 }])
    );

    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('chart')).toHaveTextContent('1m:5')
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('Metrics page - CSV export', () => {
  test('the export button is disabled while there is no data', async () => {
    renderPage();

    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
  });

  test('exports min and max columns for rollup rows and names the file after the host and range', async () => {
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    apiFetch.mockResolvedValue(
      response([
        {
          id: 1,
          timestamp: TIMESTAMP,
          cpu_usage: 40,
          cpu_usage_min: 10,
          cpu_usage_max: 90,
          sample_count: 12,
        },
      ])
    );

    renderPage();

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: '7d' },
    });

    const button = screen.getByRole('button', { name: 'Export CSV' });
    await waitFor(() => expect(button).toBeEnabled());

    fireEvent.click(button);

    const blob = window.URL.createObjectURL.mock.calls[0][0];

    expect(await blob.text()).toBe(
      ['timestamp,host_id,host_name,cpu_usage (%),cpu_usage_min (%),cpu_usage_max (%),sample_count', `${TIMESTAMP},1,prod-server,40,10,90,12`].join('\n')
    );
    expect(clickSpy.mock.contexts[0].download).toBe('prod-server_7d_metrics.csv');
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });

  test('raw rows export only the value, using the agent collection time when there is one', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    apiFetch.mockResolvedValue(
      response([
        {
          id: 1,
          timestamp: '2026-11-01T10:00:09.000Z',
          collected_at: TIMESTAMP,
          cpu_usage: 5,
        },
      ])
    );

    renderPage();

    const button = screen.getByRole('button', { name: 'Export CSV' });
    await waitFor(() => expect(button).toBeEnabled());

    fireEvent.click(button);

    const blob = window.URL.createObjectURL.mock.calls[0][0];

    expect(await blob.text()).toBe(['timestamp,host_id,host_name,cpu_usage (%)', `${TIMESTAMP},1,prod-server,5`].join('\n'));
  });
});

