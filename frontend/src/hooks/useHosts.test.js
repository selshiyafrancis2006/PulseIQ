import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import api from '../services/api';
import useHosts from './useHosts';

vi.mock('../services/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const hostOne = {
  id: 1,
  name: 'production-server',
  tags: ['env:prod'],
  status: 'online',
};

const hostTwo = {
  id: 2,
  name: 'staging-server',
  tags: ['env:staging'],
  status: 'offline',
};

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({ data: [hostOne, hostTwo] });
  api.post.mockResolvedValue({ data: {} });
  api.patch.mockResolvedValue({ data: {} });
  api.delete.mockResolvedValue({ data: {} });
});

describe('useHosts initial loading', () => {
  test('loads hosts and selects the first host by default', async () => {
    const { result } = renderHook(() => useHosts());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(api.get).toHaveBeenCalledWith('/hosts', { params: {} });
    expect(result.current.hosts).toEqual([hostOne, hostTwo]);
    expect(result.current.selectedHostId).toBe(1);
    expect(result.current.error).toBe('');
  });

  test('keeps the selected host when it exists in refreshed data', async () => {
    const { result } = renderHook(() => useHosts());

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setSelectedHostId(2);
    });

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.selectedHostId).toBe(2);
  });

  test('selects the first available host when the previous selection disappears', async () => {
    const { result } = renderHook(() => useHosts());

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setSelectedHostId(2);
    });

    api.get.mockResolvedValueOnce({ data: [hostOne] });

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.selectedHostId).toBe(1);
    expect(result.current.hosts).toEqual([hostOne]);
  });

  test('clears the selected host when the response is empty', async () => {
    api.get.mockResolvedValue({ data: [] });

    const { result } = renderHook(() => useHosts());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.hosts).toEqual([]);
    expect(result.current.selectedHostId).toBeNull();
  });

  test('reports an API error returned by the backend', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    api.get.mockRejectedValue({
      response: { data: { error: 'Access denied' } },
    });

    const { result } = renderHook(() => useHosts());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Access denied');
    expect(result.current.hosts).toEqual([]);

    consoleError.mockRestore();
  });

  test('rejects a non-array hosts response and exposes a fallback error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    api.get.mockResolvedValue({ data: { hosts: [hostOne] } });

    const { result } = renderHook(() => useHosts());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe(
      'Unable to load hosts. Check your connection and try again.'
    );
    expect(result.current.hosts).toEqual([]);

    consoleError.mockRestore();
  });
});

describe('useHosts filtering', () => {
  test('requests hosts using the selected tag filter', async () => {
    const { result } = renderHook(() => useHosts());

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setTagFilter('env:prod');
    });

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledTimes(2);
    });

    expect(api.get).toHaveBeenLastCalledWith('/hosts', {
      params: { tag: 'env:prod' },
    });
    expect(result.current.tagFilter).toBe('env:prod');
  });
});

describe('useHosts host management', () => {
  test('registers a host and marks it pending until its first heartbeat', async () => {
    api.post.mockResolvedValue({
      data: {
        id: 3,
        name: 'new-server',
        tags: ['env:test'],
        created_at: '2026-11-01T05:00:00Z',
      },
    });

    const { result } = renderHook(() => useHosts());

    await waitFor(() => expect(result.current.loading).toBe(false));

    let registered;

    await act(async () => {
      registered = await result.current.registerHost('new-server', ['env:test']);
    });

    expect(api.post).toHaveBeenCalledWith('/hosts/register', {
      name: 'new-server',
      tags: ['env:test'],
    });

    expect(registered.id).toBe(3);
    expect(result.current.hosts).toContainEqual(
      expect.objectContaining({
        id: 3,
        name: 'new-server',
        status: 'pending',
        last_seen_at: null,
      })
    );
  });

  test('selects the registered host when no host is currently selected', async () => {
    api.get.mockResolvedValue({ data: [] });
    api.post.mockResolvedValue({
      data: { id: 3, name: 'new-server', tags: [] },
    });

    const { result } = renderHook(() => useHosts());

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.registerHost('new-server');
    });

    expect(result.current.selectedHostId).toBe(3);
  });

  test('updates a host and refreshes the host list', async () => {
    const updatedHost = { ...hostOne, name: 'renamed-server' };
    api.get
      .mockResolvedValueOnce({ data: [hostOne, hostTwo] })
      .mockResolvedValueOnce({ data: [updatedHost, hostTwo] });
    api.patch.mockResolvedValue({ data: updatedHost });

    const { result } = renderHook(() => useHosts());

    await waitFor(() => expect(result.current.loading).toBe(false));

    let response;

    await act(async () => {
      response = await result.current.updateHost(1, {
        name: 'renamed-server',
        tags: ['env:prod'],
      });
    });

    expect(api.patch).toHaveBeenCalledWith('/hosts/1', {
      name: 'renamed-server',
      tags: ['env:prod'],
    });
    expect(response).toEqual(updatedHost);
    expect(result.current.hosts[0].name).toBe('renamed-server');
  });

  test('regenerates a host key using the host-specific endpoint', async () => {
    const keyResponse = { api_key: 'new-test-key' };
    api.post.mockResolvedValue({ data: keyResponse });

    const { result } = renderHook(() => useHosts());

    await waitFor(() => expect(result.current.loading).toBe(false));

    let response;

    await act(async () => {
      response = await result.current.regenerateKey(1);
    });

    expect(api.post).toHaveBeenCalledWith('/hosts/1/regenerate-key');
    expect(response).toEqual(keyResponse);
  });

  test('deletes a host, clears its selection, and refreshes the list', async () => {
    api.get
      .mockResolvedValueOnce({ data: [hostOne, hostTwo] })
      .mockResolvedValueOnce({ data: [hostTwo] });

    const { result } = renderHook(() => useHosts());

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.deleteHost(1);
    });

    expect(api.delete).toHaveBeenCalledWith('/hosts/1');
    expect(result.current.hosts).toEqual([hostTwo]);
    expect(result.current.selectedHostId).toBe(2);
  });
});
