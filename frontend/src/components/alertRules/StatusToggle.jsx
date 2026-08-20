export default function StatusToggle({
  isActive,
  onToggle
}) {
  return (
    <button
      onClick={onToggle}
      className={`
        w-14 h-7
        rounded-full
        relative
        transition-all
        duration-300
        ${
          isActive
            ? "bg-emerald-500"
            : "bg-gray-600"
        }
      `}
    >
      <span
        className={`
          absolute
          top-1
          w-5 h-5
          rounded-full
          bg-white
          transition-all
          duration-300
          ${
            isActive
              ? "left-8"
              : "left-1"
          }
        `}
      />
    </button>
  );
}