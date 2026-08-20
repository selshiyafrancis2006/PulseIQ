import { Search } from "lucide-react";

export default function SettingsSearch({
  search,
  setSearch,
}) {
  return (
    <div className="relative w-full">
      <Search
        size={18}
        className="
          absolute
          left-4
          top-1/2
          -translate-y-1/2
          text-gray-500
        "
      />

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search settings..."
        className="
          w-full
          bg-[#111827]
          border
          border-gray-800
          rounded-xl
          pl-11
          pr-4
          py-3
          text-sm
          text-white
          placeholder:text-gray-500
          focus:outline-none
          focus:border-emerald-500
          focus:ring-2
          focus:ring-emerald-500/20
          transition
        "
      />
    </div>
  );
}