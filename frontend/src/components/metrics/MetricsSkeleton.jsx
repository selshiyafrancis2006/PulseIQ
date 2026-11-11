// Placeholder shown while the first data for a host and range is loading
export default function MetricsSkeleton() {

  return (

    <div
      role="status"
      aria-busy="true"
      aria-label="Loading metrics"
      className="animate-pulse"
    >

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">

        {[0, 1, 2, 3].map(index => (
          <div
            key={index}
            className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-5"
          >
            <div className="h-3 w-16 bg-[#2a2a2a] rounded mb-4" />
            <div className="h-7 w-24 bg-[#2a2a2a] rounded" />
          </div>
        ))}

      </div>

      <div className="bg-[#0d0d0d] border border-[#2a2a2a] rounded-xl p-6 mb-8">
        <div className="h-5 w-40 bg-[#2a2a2a] rounded mb-6" />
        <div className="h-[420px] bg-[#1a1a1a] rounded-lg" />
      </div>

      <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-6">

        <div className="h-9 bg-[#2a2a2a] rounded-lg mb-6" />

        {[0, 1, 2, 3, 4].map(index => (
          <div
            key={index}
            className="h-4 bg-[#2a2a2a] rounded mb-4 last:mb-0"
          />
        ))}

      </div>

      <span className="sr-only">Loading metrics…</span>

    </div>

  )

}