import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MonitorForm from './MonitorForm';

function fillHttpForm() {
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'Production API' },
  });
  fireEvent.change(screen.getByLabelText('URL'), {
    target: { value: 'https://example.com/health' },
  });
}

function submitForm(buttonName) {
  fireEvent.submit(
    screen.getByRole('button', { name: buttonName }).closest('form')
  );
}

describe('MonitorForm - G5.1', () => {
  it('submits HTTP defaults and failure threshold', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<MonitorForm saving={false} onSubmit={onSubmit} onCancel={vi.fn()} />);

    fillHttpForm();
    submitForm('Create Monitor');

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Production API',
      monitor_type: 'HTTP',
      url: 'https://example.com/health',
      failure_threshold: 3,
      method: 'GET',
      headers: {},
      body: null,
      timeout_ms: 10000,
      expected_status_codes: null,
      expected_keyword: null,
      max_response_time_ms: null,
    }));
  });

  it('submits custom HTTP configuration', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<MonitorForm saving={false} onSubmit={onSubmit} onCancel={vi.fn()} />);

    fillHttpForm();

    fireEvent.change(screen.getByLabelText('HTTP method'), {
      target: { value: 'POST' },
    });
    fireEvent.change(screen.getByLabelText('Request headers (JSON)'), {
      target: { value: '{"Authorization":"Bearer test","Content-Type":"application/json"}' },
    });
    fireEvent.change(screen.getByLabelText('Request body'), {
      target: { value: '{"check":true}' },
    });
    fireEvent.change(screen.getByLabelText('Request timeout (milliseconds)'), {
      target: { value: '5000' },
    });
    fireEvent.change(screen.getByLabelText('Expected status codes'), {
      target: { value: '200, 201' },
    });
    fireEvent.change(screen.getByLabelText('Expected response keyword'), {
      target: { value: 'healthy' },
    });
    fireEvent.change(screen.getByLabelText('Maximum response time (milliseconds)'), {
      target: { value: '1200' },
    });
    fireEvent.change(screen.getByLabelText('Consecutive failures before DOWN'), {
      target: { value: '2' },
    });

    submitForm('Create Monitor');

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      headers: {
        Authorization: 'Bearer test',
        'Content-Type': 'application/json',
      },
      body: '{"check":true}',
      timeout_ms: 5000,
      expected_status_codes: [200, 201],
      expected_keyword: 'healthy',
      max_response_time_ms: 1200,
      failure_threshold: 2,
    }));
  });

  it('rejects invalid headers JSON', async () => {
    const onSubmit = vi.fn();

    render(<MonitorForm saving={false} onSubmit={onSubmit} onCancel={vi.fn()} />);

    fillHttpForm();

    fireEvent.change(screen.getByLabelText('Request headers (JSON)'), {
      target: { value: 'not-json' },
    });

    submitForm('Create Monitor');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Headers must contain valid JSON.'
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects invalid expected status codes', async () => {
    const onSubmit = vi.fn();

    render(<MonitorForm saving={false} onSubmit={onSubmit} onCancel={vi.fn()} />);

    fillHttpForm();

    fireEvent.change(screen.getByLabelText('Expected status codes'), {
      target: { value: '200, 700' },
    });

    submitForm('Create Monitor');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Expected status codes must be 1–20 unique codes between 100 and 599.'
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits failure threshold for TCP without HTTP settings', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<MonitorForm saving={false} onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Database TCP' },
    });
    fireEvent.change(screen.getByLabelText('Monitor type'), {
      target: { value: 'TCP' },
    });
    fireEvent.change(screen.getByLabelText('Hostname or IP address'), {
      target: { value: 'db.example.com' },
    });
    fireEvent.change(screen.getByLabelText('TCP port'), {
      target: { value: '5432' },
    });
    fireEvent.change(screen.getByLabelText('Consecutive failures before DOWN'), {
      target: { value: '4' },
    });

    submitForm('Create Monitor');

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    const payload = onSubmit.mock.calls[0][0];

    expect(payload).toEqual(expect.objectContaining({
      monitor_type: 'TCP',
      tcp_host: 'db.example.com',
      tcp_port: 5432,
      failure_threshold: 4,
    }));

    expect(payload).not.toHaveProperty('method');
    expect(payload).not.toHaveProperty('headers');
    expect(payload).not.toHaveProperty('timeout_ms');
  });

  it('loads existing HTTP settings when editing', () => {
    render(
      <MonitorForm
        monitor={{
          id: 10,
          name: 'Existing API',
          monitor_type: 'HTTP',
          url: 'https://example.com/status',
          failure_threshold: 5,
          method: 'PATCH',
          headers: { Authorization: 'Bearer existing' },
          body: '{"active":true}',
          timeout_ms: 8000,
          expected_status_codes: [200, 204],
          expected_keyword: 'active',
          max_response_time_ms: 2500,
        }}
        saving={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByLabelText('HTTP method')).toHaveValue('PATCH');
    expect(screen.getByLabelText('Request headers (JSON)')).toHaveValue(
      JSON.stringify({ Authorization: 'Bearer existing' }, null, 2)
    );
    expect(screen.getByLabelText('Request body')).toHaveValue('{"active":true}');
    expect(screen.getByLabelText('Request timeout (milliseconds)')).toHaveValue(8000);
    expect(screen.getByLabelText('Expected status codes')).toHaveValue('200, 204');
    expect(screen.getByLabelText('Expected response keyword')).toHaveValue('active');
    expect(screen.getByLabelText('Maximum response time (milliseconds)')).toHaveValue(2500);
    expect(screen.getByLabelText('Consecutive failures before DOWN')).toHaveValue(5);
  });
});

// G5.3 - Heartbeat grace period
describe('MonitorForm - G5.3 heartbeat grace period', () => {
  function selectHeartbeatMonitor() {
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Payment Worker Heartbeat' },
    });
    fireEvent.change(screen.getByLabelText('Monitor type'), {
      target: { value: 'HEARTBEAT' },
    });
  }

  it('submits the default 60-second heartbeat grace period', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<MonitorForm saving={false} onSubmit={onSubmit} onCancel={vi.fn()} />);

    selectHeartbeatMonitor();

    expect(screen.getByLabelText('Heartbeat grace period (seconds)')).toHaveValue(60);

    submitForm('Create Monitor');

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    const payload = onSubmit.mock.calls[0][0];

    expect(payload).toEqual(expect.objectContaining({
      name: 'Payment Worker Heartbeat',
      monitor_type: 'HEARTBEAT',
      heartbeat_grace_seconds: 60,
    }));
    expect(payload).not.toHaveProperty('url');
    expect(payload).not.toHaveProperty('method');
    expect(payload).not.toHaveProperty('tcp_host');
    expect(payload).not.toHaveProperty('dns_hostname');
  });

  it('submits a custom heartbeat grace period', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<MonitorForm saving={false} onSubmit={onSubmit} onCancel={vi.fn()} />);

    selectHeartbeatMonitor();

    fireEvent.change(screen.getByLabelText('Heartbeat grace period (seconds)'), {
      target: { value: '180' },
    });

    submitForm('Create Monitor');

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      monitor_type: 'HEARTBEAT',
      heartbeat_grace_seconds: 180,
    }));
  });

  it.each([-1, 86401, 1.5])(
    'rejects invalid heartbeat grace period %s',
    async (graceSeconds) => {
      const onSubmit = vi.fn();

      render(<MonitorForm saving={false} onSubmit={onSubmit} onCancel={vi.fn()} />);

      selectHeartbeatMonitor();

      fireEvent.change(screen.getByLabelText('Heartbeat grace period (seconds)'), {
        target: { value: String(graceSeconds) },
      });

      submitForm('Create Monitor');

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Heartbeat grace period must be an integer between 0 and 86400 seconds.'
      );
      expect(onSubmit).not.toHaveBeenCalled();
    }
  );

  it('loads the saved heartbeat grace period when editing', () => {
    render(
      <MonitorForm
        monitor={{
          id: 25,
          name: 'Existing Worker',
          monitor_type: 'HEARTBEAT',
          heartbeat_grace_seconds: 240,
          interval_seconds: 60,
          failure_threshold: 3,
        }}
        saving={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Heartbeat grace period (seconds)')).toHaveValue(240);
  });
});
// G5.4 - DNS expected-value configuration
describe('MonitorForm - G5.4 DNS expected values', () => {
  function selectDnsMonitor() {
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Production DNS' },
    });
    fireEvent.change(screen.getByLabelText('Monitor type'), {
      target: { value: 'DNS' },
    });
    fireEvent.change(screen.getByLabelText('DNS hostname'), {
      target: { value: 'example.com' },
    });
  }

  it('submits trimmed DNS expected values and ignores blank lines', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<MonitorForm saving={false} onSubmit={onSubmit} onCancel={vi.fn()} />);

    selectDnsMonitor();

    fireEvent.change(screen.getByLabelText('Expected DNS values (optional)'), {
      target: { value: '  203.0.113.10  \n\n203.0.113.20\n  ' },
    });

    submitForm('Create Monitor');

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      monitor_type: 'DNS',
      dns_hostname: 'example.com',
      dns_record_type: 'A',
      dns_expected_values: ['203.0.113.10', '203.0.113.20'],
    }));
  });

  it('submits an empty array when no DNS expected values are configured', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<MonitorForm saving={false} onSubmit={onSubmit} onCancel={vi.fn()} />);

    selectDnsMonitor();
    submitForm('Create Monitor');

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    expect(onSubmit.mock.calls[0][0].dns_expected_values).toEqual([]);
  });

  it('loads saved DNS expected values when editing', () => {
    render(
      <MonitorForm
        monitor={{
          id: 30,
          name: 'Existing DNS',
          monitor_type: 'DNS',
          dns_hostname: 'example.com',
          dns_record_type: 'MX',
          dns_expected_values: ['10 mail.example.com', '20 backup.example.com'],
          interval_seconds: 60,
          failure_threshold: 3,
        }}
        saving={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Expected DNS values (optional)')).toHaveValue(
      '10 mail.example.com\n20 backup.example.com'
    );
  });
});

// G5 - Service Level Objective configuration
describe('MonitorForm - SLO configuration', () => {
  it('submits the default SLO target and window', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<MonitorForm saving={false} onSubmit={onSubmit} onCancel={vi.fn()} />);

    fillHttpForm();
    submitForm('Create Monitor');

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      slo_target_percent: 99.9,
      slo_window_days: 30,
    }));
  });

  it('submits custom SLO settings', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<MonitorForm saving={false} onSubmit={onSubmit} onCancel={vi.fn()} />);

    fillHttpForm();

    fireEvent.change(screen.getByLabelText('SLO target (%)'), {
      target: { value: '99.95' },
    });
    fireEvent.change(screen.getByLabelText('SLO window (days)'), {
      target: { value: '90' },
    });

    submitForm('Create Monitor');

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      slo_target_percent: 99.95,
      slo_window_days: 90,
    }));
  });

  it.each([89, 100.01, 99.999])(
    'rejects invalid SLO target %s',
    async (targetPercent) => {
      const onSubmit = vi.fn();

      render(<MonitorForm saving={false} onSubmit={onSubmit} onCancel={vi.fn()} />);

      fillHttpForm();

      fireEvent.change(screen.getByLabelText('SLO target (%)'), {
        target: { value: String(targetPercent) },
      });

      submitForm('Create Monitor');

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'SLO target must be between 90 and 100 with at most 2 decimal places.'
      );
      expect(onSubmit).not.toHaveBeenCalled();
    }
  );

  it.each([0, 366, 1.5])(
    'rejects invalid SLO window %s',
    async (windowDays) => {
      const onSubmit = vi.fn();

      render(<MonitorForm saving={false} onSubmit={onSubmit} onCancel={vi.fn()} />);

      fillHttpForm();

      fireEvent.change(screen.getByLabelText('SLO window (days)'), {
        target: { value: String(windowDays) },
      });

      submitForm('Create Monitor');

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'SLO window must be an integer between 1 and 365 days.'
      );
      expect(onSubmit).not.toHaveBeenCalled();
    }
  );

  it('loads saved SLO settings when editing', () => {
    render(
      <MonitorForm
        monitor={{
          id: 40,
          name: 'Existing API',
          monitor_type: 'HTTP',
          url: 'https://example.com/health',
          slo_target_percent: 99.95,
          slo_window_days: 90,
        }}
        saving={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByLabelText('SLO target (%)')).toHaveValue(99.95);
    expect(screen.getByLabelText('SLO window (days)')).toHaveValue(90);
  });
});
