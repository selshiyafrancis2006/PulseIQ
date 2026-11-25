import METRICS from '../../../shared/metrics.json'

export { METRICS }
export const METRIC_NAMES = Object.freeze(Object.keys(METRICS))
export const BUILT_IN_METRICS = Object.freeze(
  METRIC_NAMES.map(name => Object.freeze({
    ...METRICS[name],
    name,
    label: METRICS[name].name
  }))
)