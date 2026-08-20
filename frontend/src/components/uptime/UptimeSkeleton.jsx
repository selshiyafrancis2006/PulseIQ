function UptimeSkeleton() {
  return (
    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl overflow-hidden animate-pulse">

      {/* Header */}
      <div className="px-6 py-4 border-b border-[#2a2a2a]">
        <div className="h-6 w-48 bg-[#2a2a2a] rounded"></div>
      </div>

      {[1, 2, 3, 4].map((item) => (
        <div
          key={item}
          className="flex items-center justify-between px-6 py-5 border-b border-[#2a2a2a] last:border-b-0"
        >
          {/* Left */}
          <div className="space-y-3">
            <div className="h-5 w-44 bg-[#2a2a2a] rounded"></div>
            <div className="h-4 w-72 bg-[#2a2a2a] rounded"></div>
          </div>

          {/* Right */}
          <div className="flex items-center gap-8">

            <div className="text-right space-y-2">
              <div className="h-3 w-20 bg-[#2a2a2a] rounded"></div>
              <div className="h-5 w-16 bg-[#2a2a2a] rounded"></div>
            </div>

            <div className="h-10 w-24 bg-[#2a2a2a] rounded-full"></div>

          </div>
        </div>
      ))}

    </div>
  );
}

export default UptimeSkeleton;