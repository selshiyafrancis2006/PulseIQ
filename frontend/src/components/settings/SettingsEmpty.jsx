export default function SettingsEmpty() {
  return (
    <div className="rounded-xl border border-dashed border-gray-700 py-16 text-center">
      <h3 className="text-lg font-semibold text-white">
        No settings found
      </h3>

      <p className="mt-2 text-sm text-gray-400">
        Try searching with a different keyword.
      </p>
    </div>
  );
}