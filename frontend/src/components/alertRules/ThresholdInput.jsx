export default function ThresholdInput({
  value,
  onChange,
  min = 0,
  max = 100
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => onChange(Number(e.target.value))}
      className="
        w-24
        bg-[#0f0f0f]
        border border-[#2a2a2a]
        rounded-lg
        px-3 py-2
        text-white
        outline-none
        focus:border-emerald-400
        transition-colors
      "
    />
  );
}