import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../utils/apiFetch', () => ({ apiFetch: vi.fn() }));
vi.mock('../../hooks/useHosts', () => ({ default: vi.fn() }));

import { apiFetch } from '../../utils/apiFetch';
import useHosts from '../../hooks/useHosts';
import MonitorLocationsPanel from './MonitorLocationsPanel';

function jsonResponse(data, ok = true) {
  return { ok, json: async () => data };
}

function location(overrides = {}) {
  return {
    host_id: 1,
    host_name: 'tokyo-agent',
    agent_status: 'online',
    last_status: 'UP',
    result_is_fresh: true,
    last_checked_at: '2026-11-01T02:00:00Z',
    last_seen_at: '2026-11-01T02:00:05Z',
    ...overrides,
  };
}

function mockLocations(locations, quorum = 1) {
  apiFetch.mockResolvedValue(jsonResponse({ locations, quorum }));
}

describe('MonitorLocationsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useHosts.mockReturnValue({
      hosts: [
        { id: 1, name: 'tokyo-agent', status: 'online' },
        { id: 2, name: 'berlin-agent', status: 'offline' },
      ],
      loading: false,
      error: '',
    });
  });

  test('shows the latest UP result of a fresh online agent', async () => {
    mockLocations([location()]);

    render(<MonitorLocationsPanel monitorId={7} />);

    expect(await screen.findByText('Latest result:')).toBeInTheDocument();
    expect(screen.getByText('UP')).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/monitors/7/locations')
    );
  });

  test('flags a stale result so a dead agent cannot look UP', async () => {
    mockLocations([location({ result_is_fresh: false })]);

    render(<MonitorLocationsPanel monitorId={7} />);

    expect(await screen.findByText('Stale - not counted')).toBeInTheDocument();
    expect(screen.queryByText('UP')).not.toBeInTheDocument();
  });

  test('shows an offline agent as offline instead of its last status', async () => {
    mockLocations([location({ agent_status: 'offline' })]);

    render(<MonitorLocationsPanel monitorId={7} />);

    expect(await screen.findByText('Agent offline')).toBeInTheDocument();
    expect(screen.queryByText('UP')).not.toBeInTheDocument();
  });

  test('shows an agent that never reported as awaiting its heartbeat', async () => {
    mockLocations([
      location({ agent_status: 'pending', last_status: null, result_is_fresh: false }),
    ]);

    render(<MonitorLocationsPanel monitorId={7} />);

    expect(await screen.findByText('Awaiting heartbeat')).toBeInTheDocument();
  });

  test('saves the selected agents and quorum with a PUT', async () => {
    const user = userEvent.setup();
    mockLocations([]);

    render(<MonitorLocationsPanel monitorId={7} />);
    await screen.findByText(/No agents are currently assigned/);

    await user.click(screen.getByRole('checkbox', { name: /tokyo-agent/ }));
    await user.selectOptions(screen.getByLabelText('Required quorum'), '2');
    await user.click(screen.getByRole('button', { name: 'Save locations' }));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/monitors/7/locations'),
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ host_ids: [1], quorum: 2 }),
        })
      );
    });

    expect(
      await screen.findByText('Check locations saved successfully.')
    ).toBeInTheDocument();
  });

  test('lowers the quorum when an agent is unselected', async () => {
    const user = userEvent.setup();
    mockLocations([location()], 2);

    render(<MonitorLocationsPanel monitorId={7} />);
    await screen.findByText('Latest result:');

    const select = screen.getByLabelText('Required quorum');
    expect(select).toHaveValue('2');

    await user.click(screen.getByRole('checkbox', { name: /tokyo-agent/ }));

    expect(select).toHaveValue('1');
  });

  test('shows the server message when saving fails', async () => {
    const user = userEvent.setup();
    apiFetch
      .mockResolvedValueOnce(jsonResponse({ locations: [], quorum: 1 }))
      .mockResolvedValueOnce(
        jsonResponse({ message: 'Every host must belong to your account' }, false)
      );

    render(<MonitorLocationsPanel monitorId={7} />);
    await screen.findByText(/No agents are currently assigned/);

    await user.click(screen.getByRole('button', { name: 'Save locations' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Every host must belong to your account'
    );
  });

  test('shows an error when the locations cannot be loaded', async () => {
    apiFetch.mockResolvedValue(jsonResponse({ message: 'Monitor not found' }, false));

    render(<MonitorLocationsPanel monitorId={7} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Monitor not found');
  });
});