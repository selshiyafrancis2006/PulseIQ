import { useMemo, useState } from "react";

import SettingsQuickActions from "../components/settings/SettingsQuickActions";
import SettingsSearch from "../components/settings/SettingsSearch";
import SettingsSection from "../components/settings/SettingsSection";
import SettingsSkeleton from "../components/settings/SettingsSkeleton";

export default function Settings() {
  const [loading] = useState(false);
  const [search, setSearch] = useState("");

  const sections = [
    {
      title: "General",
      settings: [
        {
          id: 1,
          title: "Workspace",
          description: "Manage workspace preferences",
        },
        {
          id: 2,
          title: "Appearance",
          description: "Customize dashboard theme",
        },
        {
          id: 3,
          title: "Localization",
          description: "Language and timezone settings",
        },
      ],
    },
    {
      title: "Monitoring",
      settings: [
        {
          id: 4,
          title: "Alert Rules",
          description: "Configure monitoring alerts",
        },
        {
          id: 5,
          title: "Collection Interval",
          description: "Set metric collection frequency",
        },
        {
          id: 6,
          title: "Data Retention",
          description: "Manage metrics and log retention",
        },
      ],
    },
    {
      title: "Integrations",
      settings: [
        {
          id: 7,
          title: "Connected Services",
          description: "Manage third-party integrations",
        },
        {
          id: 8,
          title: "API Keys",
          description: "Create and manage API keys",
        },
      ],
    },
    {
      title: "Security",
      settings: [
        {
          id: 9,
          title: "Authentication",
          description: "Manage authentication settings",
        },
        {
          id: 10,
          title: "Notifications",
          description: "Configure alert notifications",
        },
      ],
    },
  ];

  const filteredSections = useMemo(() => {
    if (!search.trim()) return sections;

    return sections
      .map((section) => ({
        ...section,
        settings: section.settings.filter((setting) =>
          `${setting.title} ${setting.description}`
            .toLowerCase()
            .includes(search.toLowerCase())
        ),
      }))
      .filter((section) => section.settings.length > 0);
  }, [search]);

  return (
    <div className="space-y-8 text-white">
      {/* Header */}

      <div>
        <h1 className="text-3xl font-bold">
          Settings
        </h1>

        <p className="mt-2 text-gray-400">
          Configure your PulseIQ workspace, monitoring, integrations,
          and security settings.
        </p>
      </div>

      {/* Quick Actions */}

      <SettingsQuickActions />

      {/* Search */}

      <SettingsSearch
        search={search}
        setSearch={setSearch}
      />

      {/* Settings */}

  {loading ? (
  <div className="space-y-4">
    {[...Array(6)].map((_, index) => (
      <SettingsSkeleton key={index} />
    ))}
  </div>
) : filteredSections.length === 0 ? (
  <SettingsEmpty />
) : (
  <div className="space-y-10">
    {filteredSections.map((section) => (
      <SettingsSection
        key={section.title}
        title={section.title}
        settings={section.settings}
      />
    ))}
  </div>
)}
    </div>
  );
}