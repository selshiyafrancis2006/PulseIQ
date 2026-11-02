import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import MonitorDetails from './MonitorDetails';

const { apiFetch } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}));

vi.mock('../utils/apiFetch', () => ({
  apiFetch,
}));

vi.mock('recharts', () => ({
  Area: () => null,
  AreaChart: ({ children }) => <div>{children}</div>,
  CartesianGrid: () => null,
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

vi.mock('../components/uptime/MonitorLocationsPanel', () => ({
  default: () => <div>Monitor locations panel</div>,
}));

vi.mock('../components/uptime/MonitorNotificationRouting', () => ({
  default: () => <div>Notification routing panel</div>,
}));

const downEvent = {
  id: 41,
  type: 'DOWN',
  message: 'Health check failed',
  created_at: '2026-11-02T05:00:00.000Z',
  acknowledged_at: null,
  acknowledged_by: null,
};

const monitor = {
  id: 1,
  name: 'API Monitor',
  monitor_type: 'HTTP',
  url: 'https://example.com',
  is_active: true,
  status: 'DOWN',
  tags: [],
};

const acknowledgement = {
  message: 'Monitor event acknowledged',
  id: 41,
  monitor_id: 1,
  acknowledged_at: '2026-11-02T05:10:00.000Z',
  acknowledged_by: 7,
};

function response(data, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: vi.fn().mockResolvedValue(data),
  };
}

function setupApi({ events = [downEvent], patchResponse } = {}) {
  apiFetch.mockImplementation((url, options = {}) => {
    if (options.method === 'PATCH') {
      return patchResponse
        ? patchResponse()
        : Promise.resolve(response(acknowledgement));
    }

    if (url.endsWith('/api/monitors/1')) {
      return Promise.resolve(response(monitor));
    }

    if (url.endsWith('/api/monitors/status')) {
      return Promise.resolve(response([{ id: 1, status: 'DOWN' }]));
    }

    if (url.includes('/api/monitors/1/history?')) {
      return Promise.resolve(response([]));
    }

    if (url.includes('/api/monitors/1/uptime?')) {
      return Promise.resolve(response({
        uptime: 99.9,
        total_checks: 10,
        up_checks: 9,
      }));
    }

    if (url.endsWith('/api/monitors/1/events')) {
      return Promise.resolve(response(events));
    }

    throw new Error(`Unexpected API request: ${url}`);
  });
}

function renderMonitorDetails() {
  return render(
    <MemoryRouter initialEntries={['/uptime/1']}>
      <Routes>
        <Route path="/uptime/:id" element={<MonitorDetails />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('MonitorDetails event acknowledgement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupApi();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('acknowledges an incident and displays its acknowledgement timestamp', async () => {
    renderMonitorDetails();

    const acknowledgeButton = await screen.findByRole('button', {
      name: 'Acknowledge',
    });

    fireEvent.click(acknowledgeButton);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/monitors/1/events/41/acknowledge'),
        { method: 'PATCH' }
      );
    });

    expect(
      await screen.findByText(/Acknowledged/)
    ).toBeInTheDocument();

    expect(
      screen.queryByRole('button', { name: 'Acknowledge' })
    ).not.toBeInTheDocument();
  });

  test('shows a disabled pending state while acknowledgement is processing', async () => {
    let resolvePatch;

    setupApi({
      patchResponse: () => new Promise((resolve) => {
        resolvePatch = resolve;
      }),
    });

    renderMonitorDetails();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Acknowledge' })
    );

    const pendingButton = await screen.findByRole('button', {
      name: 'Acknowledging...',
    });

    expect(pendingButton).toBeDisabled();

    await act(async () => {
      resolvePatch(response(acknowledgement));
    });

    expect(
      await screen.findByText(/Acknowledged/)
    ).toBeInTheDocument();
  });

  test('displays an API error and keeps the incident unacknowledged', async () => {
    setupApi({
      patchResponse: () => Promise.resolve(
        response(
          { message: 'You cannot acknowledge this incident.' },
          { ok: false, status: 403 }
        )
      ),
    });

    renderMonitorDetails();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Acknowledge' })
    );

    expect(
      await screen.findByRole('alert')
    ).toHaveTextContent('You cannot acknowledge this incident.');

    expect(
      screen.getByRole('button', { name: 'Acknowledge' })
    ).toBeInTheDocument();
  });

  test('shows the timestamp without an acknowledgement button for an acknowledged incident', async () => {
    setupApi({
      events: [{
        ...downEvent,
        acknowledged_at: '2026-11-02T05:10:00.000Z',
        acknowledged_by: 7,
      }],
    });

    renderMonitorDetails();

    expect(
      await screen.findByText(/Acknowledged/)
    ).toBeInTheDocument();

    expect(
      screen.queryByRole('button', { name: 'Acknowledge' })
    ).not.toBeInTheDocument();
  });
});
