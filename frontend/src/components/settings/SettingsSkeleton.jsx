export default function SettingsSkeleton() {
  return (
    <div
      className="
        w-full
        flex
        items-center
        justify-between
        bg-[#111827]
        border
        border-gray-800
        rounded-xl
        px-5
        py-4
        animate-pulse
      "
    >
      <div className="flex items-center gap-4">
        {/* Icon Skeleton */}
        <div className="w-11 h-11 rounded-lg bg-gray-700" />

        {/* Text Skeleton */}
        <div className="space-y-2">
          <div className="h-4 w-40 rounded bg-gray-700" />
          <div className="h-3 w-64 rounded bg-gray-800" />
        </div>
      </div>

      {/* Chevron Skeleton */}
      <div className="w-5 h-5 rounded bg-gray-700" />
    </div>
  );
}