import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AlertRuleForm from './AlertRuleForm';

function submitForm(buttonName = 'Create Rule') {
  fireEvent.submit(
    screen.getByRole('button', { name: buttonName }).closest('form')
  );
}

const hosts = [
  { id: 1, name: 'production-server' },
  { id: 2, name: 'staging-server' },
];

describe('AlertRuleForm', () => {
  it('creates a global rule with default values', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <AlertRuleForm
        hosts={hosts}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    );

    submitForm();

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    expect(onSave).toHaveBeenCalledWith({
      metric_name: 'cpu_usage',
      operator: '>',
      threshold: 80,
      duration: 1,
      is_active: true,
      host_id: null,
    });
  });

  it('creates a host-specific rule', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <AlertRuleForm
        hosts={hosts}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText('Apply rule to'), {
      target: { value: 'host' },
    });

    fireEvent.change(screen.getByLabelText('Host'), {
      target: { value: '2' },
    });

    fireEvent.change(screen.getByLabelText('Metric'), {
      target: { value: 'memory_usage' },
    });

    fireEvent.change(screen.getByLabelText('Threshold (%)'), {
      target: { value: '85' },
    });

    fireEvent.change(screen.getByLabelText('Consecutive samples'), {
      target: { value: '3' },
    });

    submitForm();

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    expect(onSave).toHaveBeenCalledWith({
      metric_name: 'memory_usage',
      operator: '>',
      threshold: 85,
      duration: 3,
      is_active: true,
      host_id: 2,
    });
  });

  it('rejects percentage thresholds above 100', async () => {
    const onSave = vi.fn();

    render(
      <AlertRuleForm
        hosts={hosts}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText('Threshold (%)'), {
      target: { value: '101' },
    });

    submitForm();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Percentage thresholds must be between 0 and 100.'
    );

    expect(onSave).not.toHaveBeenCalled();
  });

  it('rejects negative network thresholds', async () => {
    const onSave = vi.fn();

    render(
      <AlertRuleForm
        hosts={hosts}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText('Metric'), {
      target: { value: 'network_in' },
    });

    fireEvent.change(screen.getByLabelText('Threshold (KB/s)'), {
      target: { value: '-1' },
    });

    submitForm();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Threshold cannot be negative.'
    );

    expect(onSave).not.toHaveBeenCalled();
  });

  it('requires a host when host-specific scope is selected', async () => {
    const onSave = vi.fn();

    render(
      <AlertRuleForm
        hosts={hosts}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText('Apply rule to'), {
      target: { value: 'host' },
    });

    submitForm();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Select a host for this rule.'
    );

    expect(onSave).not.toHaveBeenCalled();
  });

  it.each([0, -1, 3601, 1.5])(
    'rejects invalid consecutive sample count %s',
    async (duration) => {
      const onSave = vi.fn();

      render(
        <AlertRuleForm
          hosts={hosts}
          onSave={onSave}
          onCancel={vi.fn()}
        />
      );

      fireEvent.change(screen.getByLabelText('Consecutive samples'), {
        target: { value: String(duration) },
      });

      submitForm();

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Duration must be a whole number between 1 and 3600.'
      );

      expect(onSave).not.toHaveBeenCalled();
    }
  );

  it('exposes only the four supported backend operators', () => {
    render(
      <AlertRuleForm
        hosts={hosts}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const operatorSelect = screen.getByLabelText('Operator');

    const values = Array.from(operatorSelect.options).map(
      (option) => option.value
    );

    expect(values).toEqual(['>', '<', '>=', '<=']);
  });

  it('loads existing rule values when editing', () => {
    render(
      <AlertRuleForm
        rule={{
          id: 10,
          metric_name: 'memory_usage',
          operator: '>=',
          threshold: 90,
          duration: 4,
          is_active: false,
          host_id: 2,
        }}
        hosts={hosts}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Metric')).toHaveValue('memory_usage');
    expect(screen.getByLabelText('Operator')).toHaveValue('>=');
    expect(screen.getByLabelText('Threshold (%)')).toHaveValue(90);
    expect(screen.getByLabelText('Consecutive samples')).toHaveValue(4);
    expect(screen.getByLabelText('Apply rule to')).toHaveValue('host');
    expect(screen.getByLabelText('Host')).toHaveValue('2');
    expect(screen.getByLabelText('Enable this rule')).not.toBeChecked();
  });
});
