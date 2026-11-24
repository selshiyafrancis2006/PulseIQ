import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatsCards from './StatsCards';

const rows = [
  { cpu_usage: 10, memory_usage: 40 },
  { cpu_usage: 30, memory_usage: 60 }
];

describe('StatsCards title', () => {
  test('shows a heading when a title is given', () => {
    render(<StatsCards metrics={rows} selectedMetric="memory_usage" title="Memory Usage" />);

    expect(screen.getByRole('heading', { name: 'Memory Usage' })).toBeInTheDocument();
  });

  test('shows no heading without a title', () => {
    render(<StatsCards metrics={rows} selectedMetric="cpu_usage" />);

    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
  });

  test('one set of cards per metric shows each metric\'s own values', () => {
    render(
      <>
        <StatsCards metrics={rows} selectedMetric="cpu_usage" title="CPU Usage" />
        <StatsCards metrics={rows} selectedMetric="memory_usage" title="Memory Usage" />
      </>
    );

    const cpu = screen.getByRole('region', { name: 'CPU Usage' });
    const memory = screen.getByRole('region', { name: 'Memory Usage' });

    expect(cpu).toHaveTextContent('30.00%');
    expect(memory).toHaveTextContent('60.00%');
  });
});
