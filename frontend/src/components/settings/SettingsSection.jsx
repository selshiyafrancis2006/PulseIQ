import SettingCard from "./SettingCard";

export default function SettingsSection({
  title,
  settings,
}) {
  return (
    <section className="space-y-4">
      <div className="border-b border-gray-800 pb-2">
        <h2 className="text-lg font-semibold text-white">
          {title}
        </h2>
      </div>

      <div className="space-y-3">
        {settings.map((setting) => (
          <SettingCard
            key={setting.id}
            icon={setting.icon}
            title={setting.title}
            description={setting.description}
            onClick={setting.onClick}
          />
        ))}
      </div>
    </section>
  );
}