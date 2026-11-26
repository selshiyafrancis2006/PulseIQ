import { APM_RANGES } from '../../utils/apm'

export default function ApmRangeSelector({ value, onChange }) {

  return (
    <div
      role="group"
      aria-label="Time range"
      className="inline-flex rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] p-1"
    >
      {APM_RANGES.map((range) => {

        const active = range.value === value

        return (
          <button
            key={range.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(range.value)}
            className={`
              rounded-md px-3 py-1.5 text-sm font-medium transition
              ${active
                ? 'bg-[#2a2a2a] text-white'
                : 'text-gray-500 hover:text-gray-300'}
            `}
          >
            {range.label}
          </button>
        )
      })}
    </div>
  )
}