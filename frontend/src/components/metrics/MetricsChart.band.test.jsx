import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import MetricsChart from './MetricsChart';

// Capture what the chart is given instead of drawing it (jsdom has no canvas)
const chart = vi.hoisted(() => ({ props: null }));

vi.mock('react-chartjs-2', () => ({
  Line: (props) => {
    chart.props = props;
    return <div data-testid="line-chart" />;
  },
}));

vi.mock('chart.js', () => ({
  Chart: { register: vi.fn() },
  CategoryScale: {},
  LinearScale: {},
  PointElement: {},
  LineElement: {},
  Tooltip: {},
  Filler: {},
  Legend: {},
}));

const hoursAgo = (hours) =>
  new Date(Date.now() - hours * 3600 * 1000).toISOString();

const secondsAgo = (seconds) =>
  new Date(Date.now() - seconds * 1000).toISOString();

// An hourly rollup row: average plus min and max for CPU and memory
function rollupRow(id, hours, cpu, cpuMin, cpuMax) {
  return {
    id,
    timestamp: hoursAgo(hours),
    cpu_usage: cpu,
    cpu_usage_min: cpuMin,
    cpu_usage_max: cpuMax,
    memory_usage: cpu + 10,
    memory_usage_min: cpuMin + 10,
    memory_usage_max: cpuMax + 10,
    sample_count: 12,
  };
}

const datasets = () => chart.props.data.datasets;

beforeEach(() => {
  chart.props = null;
});

describe('MetricsChart min-max band', () => {
  test('draws the average line with an invisible max line and a filled min line', () => {
    const rows = [
      rollupRow(1, 3, 40, 10, 90),
      rollupRow(2, 2, 50, 20, 80),
      rollupRow(3, 1, 60, 30, 70),
    ];

    render(
      <MetricsChart metrics={rows} selectedMetrics={['cpu_usage']} timeRange="7d" />
    );

    expect(datasets().map((dataset) => dataset.label)).toEqual([
      'CPU USAGE (AVG)',
      'Max',
      'Min',
    ]);
    expect(datasets()[0].data).toEqual([40, 50, 60]);
    expect(datasets()[1].data).toEqual([90, 80, 70]);
    expect(datasets()[2].data).toEqual([10, 20, 30]);

    // The min line fills up to the dataset before it (the max line)
    expect(datasets()[2].fill).toBe('-1');
    expect(datasets()[1].borderWidth).toBe(0);
  });

  test('hides the band datasets from the legend and lists all values on hover', () => {
    const rows = [rollupRow(1, 2, 40, 10, 90), rollupRow(2, 1, 50, 20, 80)];

    render(
      <MetricsChart metrics={rows} selectedMetrics={['cpu_usage']} timeRange="7d" />
    );

    const { filter } = chart.props.options.plugins.legend.labels;

    expect(filter({ text: 'CPU USAGE (AVG)' })).toBe(true);
    expect(filter({ text: 'Max' })).toBe(false);
    expect(filter({ text: 'Min' })).toBe(false);
    expect(chart.props.options.interaction).toEqual({
      mode: 'index',
      intersect: false,
    });
  });

  test('explains the band in the subtitle', () => {
    const rows = [rollupRow(1, 2, 40, 10, 90), rollupRow(2, 1, 50, 20, 80)];

    render(
      <MetricsChart metrics={rows} selectedMetrics={['cpu_usage']} timeRange="7d" />
    );

    expect(screen.getByText(/Last 7 days/)).toHaveTextContent(/min.max/);
  });

  test('labels 30-day and 90-day ranges', () => {
    const rows = [rollupRow(1, 2, 40, 10, 90), rollupRow(2, 1, 50, 20, 80)];

    const { unmount } = render(
      <MetricsChart metrics={rows} selectedMetrics={['cpu_usage']} timeRange="30d" />
    );
    expect(screen.getByText(/Last 30 days/)).toBeInTheDocument();
    unmount();

    render(
      <MetricsChart metrics={rows} selectedMetrics={['cpu_usage']} timeRange="90d" />
    );
    expect(screen.getByText(/Last 90 days/)).toBeInTheDocument();
  });

  test('draws no band for raw rows, which have no min or max', () => {
    const rows = [20, 15, 10, 5].map((seconds, index) => ({
      id: index + 1,
      timestamp: secondsAgo(seconds),
      cpu_usage: 30 + index,
    }));

    render(
      <MetricsChart metrics={rows} selectedMetrics={['cpu_usage']} timeRange="5m" />
    );

    expect(datasets()).toHaveLength(1);
    expect(datasets()[0].label).toBe('CPU USAGE');
    expect(chart.props.options.interaction).toBeUndefined();
    expect(screen.getByText(/Last 5 minutes/)).not.toHaveTextContent(/min.max/);
  });

  test('draws no band when more than one metric is selected', () => {
    const rows = [rollupRow(1, 2, 40, 10, 90), rollupRow(2, 1, 50, 20, 80)];

    render(
      <MetricsChart
        metrics={rows}
        selectedMetrics={['cpu_usage', 'memory_usage']}
        timeRange="7d"
      />
    );

    expect(datasets().map((dataset) => dataset.label)).toEqual([
      'CPU USAGE',
      'MEMORY USAGE',
    ]);
  });

  test('breaks the line and the band across a gap in the data', () => {
    // Samples at 6h, 5h, then nothing until 2h, 1h: two hourly buckets are missing
    const rows = [
      rollupRow(1, 6, 40, 10, 90),
      rollupRow(2, 5, 41, 11, 91),
      rollupRow(3, 2, 42, 12, 92),
      rollupRow(4, 1, 43, 13, 93),
    ];

    render(
      <MetricsChart metrics={rows} selectedMetrics={['cpu_usage']} timeRange="7d" />
    );

    expect(datasets()[0].data).toEqual([40, 41, null, null, 42, 43]);
    expect(datasets()[1].data).toEqual([90, 91, null, null, 92, 93]);
    expect(datasets()[2].data).toEqual([10, 11, null, null, 12, 13]);
    expect(datasets().every((dataset) => dataset.spanGaps === false)).toBe(true);
  });

  test('renders nothing when there are no metrics', () => {
    const { container } = render(
      <MetricsChart metrics={[]} selectedMetrics={['cpu_usage']} timeRange="7d" />
    );

    expect(container).toBeEmptyDOMElement();
    expect(chart.props).toBeNull();
  });
});