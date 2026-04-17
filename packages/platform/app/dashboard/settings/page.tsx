export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-navy-800">Settings</h1>
        <p className="mt-1 text-sm text-navy-500">
          Profile, notifications, security, and team management.
        </p>
      </div>
      <div className="card">
        <p className="text-sm text-navy-500">
          Settings UI is scaffolded. Profile edit, notification toggles, OAuth
          connections, session management, and team invites ship in a follow-up.
        </p>
      </div>
    </div>
  );
}
