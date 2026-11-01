import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import useHosts from '../hooks/useHosts';
import Hosts from './Hosts';

vi.mock('../hooks/useHosts', () => ({
  default: vi.fn(),
}));

vi.mock('../components/hosts/InstallInstructions', () => ({
  default: ({ apiKey }) => (
    <div data-testid="install-instructions">Install with key: {apiKey}</div>
  ),
}));

const host = {
  id: 1,
  name: 'production-server',
  status: 'online',
  last_seen_at: '2026-11-01T05:00:00Z',
  created_at: '2026-10-01T05:00:00Z',
  cpu_usage: 45.5,
  memory_usage: 62.3,
  disk_usage: 70.1,
  tags: ['env:prod', 'region:ap-south'],
};

const secondHost = {
  ...host,
  id: 2,
  name: 'staging-server',
  status: 'offline',
  cpu_usage: null,
  memory_usage: null,
  disk_usage: null,
  tags: [],
};

const registerHost = vi.fn();
const updateHost = vi.fn();
const regenerateKey = vi.fn();
const deleteHost = vi.fn();
const refetch = vi.fn();
const setTagFilter = vi.fn();

function renderPage() {
  return render(
    <MemoryRouter>
      <Hosts />
    </MemoryRouter>
  );
}

describe('Hosts page', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useHosts.mockReturnValue({
      hosts: [host, secondHost],
      loading: false,
      refreshing: false,
      error: '',
      refetch,
      registerHost,
      updateHost,
      regenerateKey,
      deleteHost,
      tagFilter: null,
      setTagFilter,
    });
  });

  test('renders host list and summary counts', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Hosts' })).toBeInTheDocument();
    expect(screen.getByText('Total Hosts').parentElement).toHaveTextContent('2');
    expect(screen.getByText('Online', { selector: 'p' }).parentElement).toHaveTextContent('1');
    expect(screen.getByText('Offline', { selector: 'p' }).parentElement).toHaveTextContent('1');
    expect(screen.getByText('Pending', { selector: 'p' }).parentElement).toHaveTextContent('0');

    expect(screen.getByRole('link', { name: 'production-server' })).toHaveAttribute(
      'href',
      '/hosts/1'
    );
    expect(screen.getByRole('link', { name: 'staging-server' })).toHaveAttribute(
      'href',
      '/hosts/2'
    );
  });

  test('shows the loading state', () => {
    useHosts.mockReturnValue({
      hosts: [],
      loading: true,
      refreshing: false,
      error: '',
      refetch,
      registerHost,
      updateHost,
      regenerateKey,
      deleteHost,
      tagFilter: null,
      setTagFilter,
    });

    renderPage();

    expect(screen.getByText('Loading hosts...')).toBeInTheDocument();
  });

  test('shows the empty state when no hosts exist', () => {
    useHosts.mockReturnValue({
      hosts: [],
      loading: false,
      refreshing: false,
      error: '',
      refetch,
      registerHost,
      updateHost,
      regenerateKey,
      deleteHost,
      tagFilter: null,
      setTagFilter,
    });

    renderPage();

    expect(
      screen.getByText(/No hosts registered yet/i)
    ).toBeInTheDocument();
  });

  test('shows a tag-specific empty state', () => {
    useHosts.mockReturnValue({
      hosts: [],
      loading: false,
      refreshing: false,
      error: '',
      refetch,
      registerHost,
      updateHost,
      regenerateKey,
      deleteHost,
      tagFilter: 'env:prod',
      setTagFilter,
    });

    renderPage();

    expect(screen.getByText('No hosts match tag "env:prod".')).toBeInTheDocument();
  });

  test('shows a load error and retries with the current tag filter', () => {
    useHosts.mockReturnValue({
      hosts: [],
      loading: false,
      refreshing: false,
      error: 'Unable to load hosts',
      refetch,
      registerHost,
      updateHost,
      regenerateKey,
      deleteHost,
      tagFilter: 'env:prod',
      setTagFilter,
    });

    renderPage();

    expect(screen.getByText('Unable to load hosts')).toBeInTheDocument();
    expect(
      screen.getByText(/Unable to display hosts until the connection is restored/i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(refetch).toHaveBeenCalledWith('env:prod');
  });

  test('shows refreshing state', () => {
    useHosts.mockReturnValue({
      hosts: [host],
      loading: false,
      refreshing: true,
      error: '',
      refetch,
      registerHost,
      updateHost,
      regenerateKey,
      deleteHost,
      tagFilter: null,
      setTagFilter,
    });

    renderPage();

    expect(screen.getByText('Refreshing host data...')).toBeInTheDocument();
  });

  test('filters hosts by name without changing the underlying list', () => {
    renderPage();

    fireEvent.change(screen.getByRole('textbox', { name: 'Search hosts by name' }), {
      target: { value: 'PRODUCTION' },
    });

    expect(screen.getByRole('link', { name: 'production-server' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'staging-server' })).not.toBeInTheDocument();
  });

  test('shows a message when the name search has no matches', () => {
    renderPage();

    fireEvent.change(screen.getByRole('textbox', { name: 'Search hosts by name' }), {
      target: { value: 'unknown-host' },
    });

    expect(screen.getByText('No hosts match your search.')).toBeInTheDocument();
  });

  test('applies a trimmed tag filter', () => {
    renderPage();

    fireEvent.change(screen.getByPlaceholderText('Filter by tag, e.g. env:prod'), {
      target: { value: '  env:prod  ' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));

    expect(setTagFilter).toHaveBeenCalledWith('env:prod');
  });

  test('clears the active tag filter', () => {
    useHosts.mockReturnValue({
      hosts: [host],
      loading: false,
      refreshing: false,
      error: '',
      refetch,
      registerHost,
      updateHost,
      regenerateKey,
      deleteHost,
      tagFilter: 'env:prod',
      setTagFilter,
    });

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Clear (env:prod)' }));

    expect(setTagFilter).toHaveBeenCalledWith(null);
  });

  test('validates a required host name before registration', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: '+ Add Host' }));
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    expect(await screen.findByText('Host name is required')).toBeInTheDocument();
    expect(registerHost).not.toHaveBeenCalled();
  });

  test('registers a host with trimmed name and parsed tags', async () => {
    registerHost.mockResolvedValue({
      id: 3,
      name: 'new-api-server',
      api_key: 'new-secret-key',
    });

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: '+ Add Host' }));

    fireEvent.change(screen.getByPlaceholderText('e.g. prod-api-1'), {
      target: { value: '  new-api-server  ' },
    });

    fireEvent.change(screen.getByPlaceholderText('env:prod, region:us-east'), {
      target: { value: ' env:prod, region:us-east, , ' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    await waitFor(() => {
      expect(registerHost).toHaveBeenCalledWith('new-api-server', [
        'env:prod',
        'region:us-east',
      ]);
    });

    expect(await screen.findByText('new-api-server registered')).toBeInTheDocument();
    expect(screen.getByText('new-secret-key')).toBeInTheDocument();
    expect(screen.getByTestId('install-instructions')).toHaveTextContent(
      'new-secret-key'
    );
  });

  test('shows a registration API error', async () => {
    registerHost.mockRejectedValue({
      response: { data: { error: 'Host name already exists' } },
    });

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: '+ Add Host' }));
    fireEvent.change(screen.getByPlaceholderText('e.g. prod-api-1'), {
      target: { value: 'production-server' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    expect(
      await screen.findByText('Host name already exists')
    ).toBeInTheDocument();
  });

  test('closes the registration result when Done is clicked', async () => {
    registerHost.mockResolvedValue({
      id: 3,
      name: 'new-api-server',
      api_key: 'new-secret-key',
    });

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: '+ Add Host' }));
    fireEvent.change(screen.getByPlaceholderText('e.g. prod-api-1'), {
      target: { value: 'new-api-server' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Done' }));

    expect(screen.queryByText('new-api-server registered')).not.toBeInTheDocument();
  });

  test('validates the host name in the edit form', async () => {
    renderPage();

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);

    fireEvent.change(screen.getByDisplayValue('production-server'), {
      target: { value: '   ' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Host name is required')).toBeInTheDocument();
    expect(updateHost).not.toHaveBeenCalled();
  });

  test('updates a host with trimmed name and parsed tags', async () => {
    updateHost.mockResolvedValue({});

    renderPage();

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);

    fireEvent.change(screen.getByDisplayValue('production-server'), {
      target: { value: '  renamed-server  ' },
    });

    fireEvent.change(screen.getByDisplayValue('env:prod, region:ap-south'), {
      target: { value: ' env:staging, region:eu-west, ' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateHost).toHaveBeenCalledWith(1, {
        name: 'renamed-server',
        tags: ['env:staging', 'region:eu-west'],
      });
    });

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Edit Host' })).not.toBeInTheDocument();
    });
  });

  test('shows an edit API error', async () => {
    updateHost.mockRejectedValue({
      response: { data: { error: 'Host update rejected' } },
    });

    renderPage();

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Host update rejected')).toBeInTheDocument();
  });

  test('cancels API-key regeneration without calling the hook', () => {
    renderPage();

    fireEvent.click(screen.getAllByRole('button', { name: 'New key' })[0]);

    expect(screen.getByText('Regenerate API key?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('Regenerate API key?')).not.toBeInTheDocument();
    expect(regenerateKey).not.toHaveBeenCalled();
  });

  test('regenerates an API key and displays the one-time result', async () => {
    regenerateKey.mockResolvedValue({
      name: 'production-server',
      api_key: 'rotated-secret-key',
    });

    renderPage();

    fireEvent.click(screen.getAllByRole('button', { name: 'New key' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));

    await waitFor(() => {
      expect(regenerateKey).toHaveBeenCalledWith(1);
    });

    expect(
      await screen.findByText('New key for production-server')
    ).toBeInTheDocument();
    expect(screen.getByText('rotated-secret-key')).toBeInTheDocument();
  });

  test('shows an API-key regeneration error', async () => {
    regenerateKey.mockRejectedValue({
      response: { data: { error: 'Key rotation failed' } },
    });

    renderPage();

    fireEvent.click(screen.getAllByRole('button', { name: 'New key' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));

    expect(await screen.findByText('Key rotation failed')).toBeInTheDocument();
  });

  test('cancels host deletion without calling the hook', () => {
    renderPage();

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);

    expect(screen.getByText('Delete host?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('Delete host?')).not.toBeInTheDocument();
    expect(deleteHost).not.toHaveBeenCalled();
  });

  test('deletes the selected host after confirmation', async () => {
    deleteHost.mockResolvedValue(undefined);

    renderPage();

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Host' }));

    await waitFor(() => {
      expect(deleteHost).toHaveBeenCalledWith(1);
    });

    await waitFor(() => {
      expect(screen.queryByText('Delete host?')).not.toBeInTheDocument();
    });
  });

  test('shows a host deletion error', async () => {
    deleteHost.mockRejectedValue({
      response: { data: { error: 'Host deletion failed' } },
    });

    renderPage();

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Host' }));

    expect(await screen.findByText('Host deletion failed')).toBeInTheDocument();
  });
});
