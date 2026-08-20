import { ChevronRight } from "lucide-react";

export default function SettingCard({
  title,
  description,
  onClick,
}) {
  return (
    <button
      onClick={onClick}
      className="
        w-full
        flex
        items-center
        justify-between
        rounded-xl
        border
        border-gray-800
        bg-[#111827]
        px-5
        py-4
        text-left
        transition-all
        duration-200
        hover:border-emerald-500
        hover:bg-[#18212f]
      "
    >
      <div>
        <h3 className="text-base font-semibold text-white">
          {title}
        </h3>

        <p className="mt-1 text-sm text-gray-400">
          {description}
        </p>
      </div>

      <ChevronRight
        size={18}
        className="text-gray-500"
      />
    </button>
  );
}