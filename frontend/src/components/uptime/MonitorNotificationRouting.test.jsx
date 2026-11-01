import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockUseNotificationChannels = vi.hoisted(() => vi.fn());

vi.mock('../../services/api', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
  },
}));

vi.mock('../../hooks/useNotificationChannels', () => ({
  default: mockUseNotificationChannels,
  getErrorMessage: (err, fallback) =>
    err?.response?.data?.message || fallback,
}));

import api from '../../services/api';
import MonitorNotificationRouting from './MonitorNotificationRouting';

const CHANNELS = [
  { id: 11, name: 'Production email', type: 'email', is_active: true },
  { id: 12, name: 'Build alerts', type: 'webhook', is_active: true },
];

describe('MonitorNotificationRouting', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    api.get.mockResolvedValue({
      data: {
        monitor_id: 7,
        routing_mode: 'ALL',
        channel_ids: [],
      },
    });
    api.put.mockResolvedValue({ data: { message: 'Saved' } });

    mockUseNotificationChannels.mockReturnValue({
      channels: CHANNELS,
      loading: false,
      error: '',
    });
  });

  test('loads the default ALL mode without displaying the channel list', async () => {
    render(<MonitorNotificationRouting monitorId={7} />);

    expect(
      await screen.findByRole('radio', { name: /All active channels/i })
    ).toBeChecked();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();

    expect(api.get).toHaveBeenCalledWith(
      '/monitors/7/notification-channels'
    );
  });

  test('shows selected channels and allows changing the selection', async () => {
    const user = userEvent.setup();

    api.get.mockResolvedValue({
      data: {
        monitor_id: 7,
        routing_mode: 'SELECTED',
        channel_ids: [11],
      },
    });

    render(<MonitorNotificationRouting monitorId={7} />);

    const emailCheckbox = await screen.findByRole('checkbox', {
      name: /Production email/i,
    });
    const webhookCheckbox = screen.getByRole('checkbox', {
      name: /Build alerts/i,
    });

    expect(emailCheckbox).toBeChecked();
    expect(webhookCheckbox).not.toBeChecked();

    await user.click(webhookCheckbox);
    expect(webhookCheckbox).toBeChecked();
  });

  test('saves the selected channel IDs', async () => {
    const user = userEvent.setup();

    api.get.mockResolvedValue({
      data: {
        monitor_id: 7,
        routing_mode: 'SELECTED',
        channel_ids: [11],
      },
    });

    render(<MonitorNotificationRouting monitorId={7} />);

    const webhookCheckbox = await screen.findByRole('checkbox', {
      name: /Build alerts/i,
    });
    await user.click(webhookCheckbox);
    await user.click(screen.getByRole('button', { name: 'Save routing' }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith(
        '/monitors/7/notification-channels',
        {
          routing_mode: 'SELECTED',
          channel_ids: [11, 12],
        }
      );
    });

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Notification routing saved.'
    );
  });

  test('allows intentionally saving SELECTED mode with no channels', async () => {
    const user = userEvent.setup();

    api.get.mockResolvedValue({
      data: {
        monitor_id: 7,
        routing_mode: 'SELECTED',
        channel_ids: [],
      },
    });

    render(<MonitorNotificationRouting monitorId={7} />);

    expect(
      await screen.findByText(/Saving this setting will suppress notifications/i)
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save routing' }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith(
        '/monitors/7/notification-channels',
        {
          routing_mode: 'SELECTED',
          channel_ids: [],
        }
      );
    });
  });

  test('prevents saving SELECTED mode when channels fail to load', async () => {
    mockUseNotificationChannels.mockReturnValue({
      channels: [],
      loading: false,
      error: 'Unable to load notification channels.',
    });

    api.get.mockResolvedValue({
      data: {
        monitor_id: 7,
        routing_mode: 'SELECTED',
        channel_ids: [],
      },
    });

    render(<MonitorNotificationRouting monitorId={7} />);

    const saveButton = await screen.findByRole('button', {
      name: 'Save routing',
    });

    expect(saveButton).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Unable to load notification channels.'
    );
    expect(api.put).not.toHaveBeenCalled();
  });

  test('prevents saving when monitor routing settings fail to load', async () => {
    api.get.mockRejectedValue(new Error('Network error'));

    render(<MonitorNotificationRouting monitorId={7} />);

    const saveButton = await screen.findByRole('button', {
      name: 'Save routing',
    });

    await waitFor(() => expect(saveButton).toBeDisabled());
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Unable to load notification routing.'
    );
    expect(api.put).not.toHaveBeenCalled();
  });
});