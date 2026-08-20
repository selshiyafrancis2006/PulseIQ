export default function SettingsQuickActions() {
  const actions = [
    {
      id: 1,
      label: "Create API Key",
    },
    {
      id: 2,
      label: "Invite User",
    },
    {
      id: 3,
      label: "Test Notifications",
    },
    {
      id: 4,
      label: "Export Settings",
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {actions.map((action) => (
        <button
          key={action.id}
          className="
            rounded-xl
            border
            border-gray-800
            bg-[#111827]
            px-5
            py-4
            text-left
            text-sm
            font-medium
            text-white
            transition-all
            duration-200
            hover:border-emerald-500
            hover:bg-[#18212f]
          "
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}