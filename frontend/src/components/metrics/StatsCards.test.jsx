import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatsCards from './StatsCards';

// The value shown in the card with the given label
const valueOf = (label) => screen.getByText(label).nextElementSibling.textContent;

describe('StatsCards', () => {
  test('renders nothing when there are no metrics', () => {
    const { container } = render(
      <StatsCards metrics={[]} selectedMetric="cpu_usage" />
    );

    expect(container).toBeEmptyDOMElement();
  });

  test('renders nothing when no row has a value for the metric', () => {
    const { container } = render(
      <StatsCards
        metrics={[{ cpu_usage: null }, { memory_usage: 40 }]}
        selectedMetric="cpu_usage"
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  test('raw rows: shows latest, average, maximum and minimum of the values', () => {
    render(
      <StatsCards
        metrics={[
          { cpu_usage: 10 },
          { cpu_usage: 40 },
          { cpu_usage: 20 },
        ]}
        selectedMetric="cpu_usage"
      />
    );

    expect(valueOf('Latest')).toBe('20.00');
    expect(valueOf('Average')).toBe('23.33');
    expect(valueOf('Maximum')).toBe('40.00');
    expect(valueOf('Minimum')).toBe('10.00');
  });

  test('rollup rows: maximum and minimum use the true peaks, not the highest and lowest average', () => {
    render(
      <StatsCards
        metrics={[
          { cpu_usage: 10, cpu_usage_min: 2, cpu_usage_max: 50, sample_count: 1 },
          { cpu_usage: 40, cpu_usage_min: 30, cpu_usage_max: 45, sample_count: 3 },
        ]}
        selectedMetric="cpu_usage"
      />
    );

    expect(valueOf('Maximum')).toBe('50.00');
    expect(valueOf('Minimum')).toBe('2.00');
    expect(valueOf('Latest')).toBe('40.00');
  });

  test('rollup rows: the average is weighted by sample count', () => {
    render(
      <StatsCards
        metrics={[
          { cpu_usage: 10, cpu_usage_min: 2, cpu_usage_max: 50, sample_count: 1 },
          { cpu_usage: 40, cpu_usage_min: 30, cpu_usage_max: 45, sample_count: 3 },
        ]}
        selectedMetric="cpu_usage"
      />
    );

    // (10 * 1 + 40 * 3) / 4 = 32.5. A plain average of the two would be 25.
    expect(valueOf('Average')).toBe('32.50');
  });

  test('skips rows with a missing value instead of showing NaN', () => {
    render(
      <StatsCards
        metrics={[{ cpu_usage: null }, { cpu_usage: 50 }, { cpu_usage: undefined }]}
        selectedMetric="cpu_usage"
      />
    );

    expect(valueOf('Latest')).toBe('50.00');
    expect(valueOf('Average')).toBe('50.00');
    expect(valueOf('Maximum')).toBe('50.00');
    expect(valueOf('Minimum')).toBe('50.00');
  });

  test('reads the selected metric, not another one', () => {
    render(
      <StatsCards
        metrics={[{ cpu_usage: 10, memory_usage: 80 }]}
        selectedMetric="memory_usage"
      />
    );

    expect(valueOf('Latest')).toBe('80.00');
  });
});