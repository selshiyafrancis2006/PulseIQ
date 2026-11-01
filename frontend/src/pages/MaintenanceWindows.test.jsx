import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../utils/apiFetch', () => ({ apiFetch: vi.fn() }));

import { apiFetch } from '../utils/apiFetch';
import MaintenanceWindows from './MaintenanceWindows';

const MONITORS = [
  { id: 1, name: 'api-prod' },
  { id: 2, name: 'web-prod' },
];

function windowRow(overrides = {}) {
  return {
    id: 10,
    monitor_id: 1,
    monitor_name: 'api-prod',
    reason: 'DB upgrade',
    starts_at: '2026-11-01T10:00:00Z',
    ends_at: '2026-11-01T12:00:00Z',
    state: 'active',
    ...overrides,
  };
}

function reply(data, ok = true) {
  return { ok, json: async () => data };
}

// Routes apiFetch calls by URL and method, like a tiny fake server.
function mockApi({ windows = [], createResult, endResult, deleteResult } = {}) {
  apiFetch.mockImplementation(async (url, options = {}) => {
    const method = options.method || 'GET';

    if (url.endsWith('/api/monitors')) return reply(MONITORS);
    if (url.endsWith('/api/maintenance-windows') && method === 'GET') {
      return reply(windows);
    }
    if (url.endsWith('/api/maintenance-windows') && method === 'POST') {
      return createResult || reply(windowRow({ id: 99 }), true);
    }
    if (url.endsWith('/end') && method === 'POST') {
      return endResult || reply(windowRow({ state: 'ended' }));
    }
    if (method === 'DELETE') {
      return deleteResult || reply({ message: 'Maintenance window deleted' });
    }

    throw new Error(`Unexpected request: ${method} ${url}`);
  });
}

function callsWhere(method, suffix = '') {
  return apiFetch.mock.calls.filter(
    ([url, options = {}]) =>
      (options.method || 'GET') === method && url.endsWith(suffix)
  );
}

function renderPage() {
  return render(
    <MemoryRouter>
      <MaintenanceWindows />
    </MemoryRouter>
  );
}

describe('MaintenanceWindows page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('shows tab counts and only the windows of the selected tab', async () => {
    const user = userEvent.setup();
    mockApi({
      windows: [
        windowRow({ id: 1, state: 'active', reason: 'Active job' }),
        windowRow({ id: 2, state: 'upcoming', reason: 'Planned job' }),
        windowRow({ id: 3, state: 'ended', reason: 'Old job' }),
      ],
    });

    renderPage();

    expect(await screen.findByRole('tab', { name: 'Active (1)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Upcoming (1)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Ended (1)' })).toBeInTheDocument();
    expect(screen.getByText('Active job')).toBeInTheDocument();
    expect(screen.queryByText('Planned job')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Upcoming (1)' }));

    expect(screen.getByText('Planned job')).toBeInTheDocument();
    expect(screen.queryByText('Active job')).not.toBeInTheDocument();
  });

  test('shows All monitors for a window without a monitor', async () => {
    mockApi({
      windows: [windowRow({ monitor_id: null, monitor_name: null })],
    });

    renderPage();

    expect(await screen.findByText('All monitors', { selector: 'span.text-sm' }))
      .toBeInTheDocument();
  });

  test('creates an immediate one-hour window for all monitors', async () => {
    const user = userEvent.setup();
    mockApi();

    renderPage();
    await screen.findByText('Schedule a window');

    await user.click(screen.getByRole('button', { name: 'Create window' }));

    await waitFor(() => expect(callsWhere('POST', '/maintenance-windows')).toHaveLength(1));

    const [, options] = callsWhere('POST', '/maintenance-windows')[0];
    expect(JSON.parse(options.body)).toEqual({
      monitor_id: null,
      duration_minutes: 60,
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Maintenance window created.'
    );
  });

  test('schedules a custom-length window for one monitor', async () => {
    const user = userEvent.setup();
    mockApi();

    renderPage();
    await screen.findByText('Schedule a window');

    await user.selectOptions(screen.getByLabelText('Applies to'), 'web-prod');
    await user.type(screen.getByLabelText(/Reason/), 'Certificate swap');
    await user.click(screen.getByLabelText('Schedule for later'));
    fireEvent.change(screen.getByLabelText('Start date and time'), {
      target: { value: '2099-01-01T10:00' },
    });
    await user.selectOptions(screen.getByLabelText('Duration'), 'custom');
    await user.type(screen.getByLabelText('Custom duration (minutes)'), '90');
    await user.click(screen.getByRole('button', { name: 'Create window' }));

    await waitFor(() => expect(callsWhere('POST', '/maintenance-windows')).toHaveLength(1));

    const [, options] = callsWhere('POST', '/maintenance-windows')[0];
    expect(JSON.parse(options.body)).toEqual({
      monitor_id: 2,
      reason: 'Certificate swap',
      duration_minutes: 90,
      starts_at: new Date('2099-01-01T10:00').toISOString(),
    });
  });

  test('does not call the API when the form is invalid', async () => {
    const user = userEvent.setup();
    mockApi();

    renderPage();
    await screen.findByText('Schedule a window');

    await user.click(screen.getByLabelText('Schedule for later'));
    await user.click(screen.getByRole('button', { name: 'Create window' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Choose a start date and time.'
    );
    expect(callsWhere('POST', '/maintenance-windows')).toHaveLength(0);
  });

  test('shows the server message when creating fails', async () => {
    const user = userEvent.setup();
    mockApi({
      createResult: reply({ message: 'Monitor not found' }, false),
    });

    renderPage();
    await screen.findByText('Schedule a window');

    await user.click(screen.getByRole('button', { name: 'Create window' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Monitor not found');
  });

  test('ends an active window right now', async () => {
    const user = userEvent.setup();
    mockApi({ windows: [windowRow({ id: 10, state: 'active' })] });

    renderPage();
    await user.click(await screen.findByRole('button', { name: 'End now' }));

    await waitFor(() => expect(callsWhere('POST', '/10/end')).toHaveLength(1));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Alerts are active again.'
    );
  });

  test('offers End now only for active windows', async () => {
    const user = userEvent.setup();
    mockApi({ windows: [windowRow({ id: 11, state: 'upcoming' })] });

    renderPage();
    await user.click(await screen.findByRole('tab', { name: 'Upcoming (1)' }));

    expect(screen.queryByRole('button', { name: 'End now' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  test('deletes a window only after confirmation', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm');
    mockApi({ windows: [windowRow({ id: 10, state: 'active' })] });

    renderPage();
    const deleteButton = await screen.findByRole('button', { name: 'Delete' });

    confirmSpy.mockReturnValueOnce(false);
    await user.click(deleteButton);
    expect(callsWhere('DELETE')).toHaveLength(0);

    confirmSpy.mockReturnValueOnce(true);
    await user.click(deleteButton);
    await waitFor(() => expect(callsWhere('DELETE', '/10')).toHaveLength(1));

    confirmSpy.mockRestore();
  });

  test('shows an error when the windows cannot be loaded', async () => {
    apiFetch.mockImplementation(async (url) =>
      url.endsWith('/api/monitors')
        ? reply(MONITORS)
        : reply({ message: 'Failed to fetch maintenance windows' }, false)
    );

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to fetch maintenance windows'
    );
  });
});