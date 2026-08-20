export default function ServiceSkeleton() {
  return (
    <div className="bg-[#161B22] border border-gray-800 rounded-xl p-6 animate-pulse">

      {/* Header */}
      <div className="flex justify-between items-start">

        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gray-700" />

          <div>
            <div className="h-5 w-48 bg-gray-700 rounded" />
            <div className="h-4 w-32 bg-gray-800 rounded mt-2" />
          </div>
        </div>

        <div className="h-8 w-24 bg-gray-700 rounded-full" />

      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">

        {[...Array(4)].map((_, index) => (
          <div
            key={index}
            className="bg-[#0D1117] rounded-lg p-4"
          >
            <div className="h-4 w-20 bg-gray-700 rounded" />
            <div className="h-6 w-16 bg-gray-600 rounded mt-3" />
          </div>
        ))}

      </div>

      {/* Footer */}
      <div className="flex justify-between items-center mt-6 pt-4 border-t border-gray-800">

        <div>
          <div className="h-4 w-24 bg-gray-700 rounded" />
          <div className="h-6 w-16 bg-gray-600 rounded mt-2" />
        </div>

        <div className="h-10 w-28 bg-gray-700 rounded-lg" />

      </div>

    </div>
  );
}