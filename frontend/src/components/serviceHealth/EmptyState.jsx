import { ServerCrash } from "lucide-react";

export default function EmptyState({
  title = "No Services Found",
  description = "There are no services to display at the moment.",
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center bg-[#161B22] border border-dashed border-gray-700 rounded-xl">
      <ServerCrash className="w-16 h-16 text-gray-500 mb-5" />

      <h2 className="text-2xl font-semibold text-white">
        {title}
      </h2>

      <p className="mt-2 text-gray-400 max-w-md">
        {description}
      </p>
    </div>
  );
}