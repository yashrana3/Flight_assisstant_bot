"use client";

import { useEffect, useState } from "react";
import {
  Bell,
  Database,
  FileText,
  KeyRound,
  Lock,
  Power,
  RefreshCw,
  Settings as SettingsIcon,
  Shield,
  UserCog,
  Users,
} from "lucide-react";

import { PageLoader } from "@/components/PageLoader";
import type {
  AdminAuthMeResponse,
  AdminOverviewResponse,
  AdminUsersListResponse,
  AdminUsersPageResponse,
} from "@/lib/admin-types";
import { clearAdminClientCache } from "@/lib/admin-session";
import { useAdminData } from "@/lib/use-admin-data";

export function Settings() {
  const overview = useAdminData<AdminOverviewResponse>("/api/admin/overview");
  const users = useAdminData<AdminUsersPageResponse>("/api/admin/users");
  const currentAdmin = useAdminData<AdminAuthMeResponse>("/api/admin/auth/me", { staleMs: 60_000 });
  const adminAccounts = useAdminData<AdminUsersListResponse>("/api/admin/admin-users");
  const apiMonitoring = useAdminData<{
    apiKeys?: Array<{
      provider: string;
      keyName: string;
      status: string;
      keyLast4?: string | null;
      requests24h: number;
      remainingToday?: number;
      lastUsed: string | null;
    }>;
    generatedLabel?: string;
  }>("/api/admin/api-monitoring");

  const [featureFlags, setFeatureFlags] = useState({
    aiChat: true,
    flightSearch: true,
    routeAnalytics: true,
    redirectTracking: true,
    feedbackSystem: true,
    priceAlerts: false,
  });
  const [notifications, setNotifications] = useState({
    email: true,
    dashboard: true,
    performanceAlerts: true,
    securityAlerts: true,
  });
  const [accountForm, setAccountForm] = useState({
    username: "",
    fullName: "",
    email: "",
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [newAdminForm, setNewAdminForm] = useState({
    username: "",
    fullName: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [settingsNote, setSettingsNote] = useState<string | null>(null);
  const [savingAccount, setSavingAccount] = useState(false);
  const [creatingAdmin, setCreatingAdmin] = useState(false);

  const loading =
    (overview.loading || users.loading || apiMonitoring.loading || currentAdmin.loading || adminAccounts.loading) &&
    !overview.data &&
    !users.data &&
    !apiMonitoring.data &&
    !currentAdmin.data &&
    !adminAccounts.data;

  useEffect(() => {
    const admin = currentAdmin.data?.admin;
    if (!admin) return;

    setAccountForm((prev) => ({
      ...prev,
      username: admin.username || "",
      fullName: admin.fullName || "",
      email: admin.email || "",
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    }));
  }, [currentAdmin.data?.admin?.id]);

  const toggleFeature = (key: keyof typeof featureFlags) => {
    setFeatureFlags((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleNotification = (key: keyof typeof notifications) => {
    setNotifications((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const error =
    overview.error ??
    users.error ??
    apiMonitoring.error ??
    currentAdmin.error ??
    adminAccounts.error;
  const admins = adminAccounts.data?.admins ?? [];

  const handleSaveAccount = async () => {
    try {
      setSavingAccount(true);
      setSettingsNote(null);

      if (!accountForm.username.trim() || !accountForm.fullName.trim() || !accountForm.email.trim()) {
        throw new Error("Username, full name, and email are required.");
      }
      if ((accountForm.currentPassword || accountForm.newPassword || accountForm.confirmPassword) && !accountForm.currentPassword) {
        throw new Error("Enter your current password to set a new password.");
      }
      if (accountForm.newPassword !== accountForm.confirmPassword) {
        throw new Error("New password and confirm password must match.");
      }

      const response = await fetch("/api/admin/account", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: accountForm.username,
          fullName: accountForm.fullName,
          email: accountForm.email,
          currentPassword: accountForm.currentPassword || undefined,
          newPassword: accountForm.newPassword || undefined,
        }),
      });
      const payload = (await response.json()) as { detail?: string; admin?: AdminAuthMeResponse["admin"] };
      if (!response.ok) {
        throw new Error(payload.detail || "Could not save account changes.");
      }

      await currentAdmin.refresh();
      await adminAccounts.refresh();
      setAccountForm((prev) => ({
        ...prev,
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      }));
      setSettingsNote("Super admin account details updated successfully.");
    } catch (err) {
      setSettingsNote(err instanceof Error ? err.message : "Could not save account changes.");
    } finally {
      setSavingAccount(false);
    }
  };

  const handleCreateAdmin = async () => {
    try {
      setCreatingAdmin(true);
      setSettingsNote(null);

      if (!newAdminForm.username.trim() || !newAdminForm.fullName.trim() || !newAdminForm.email.trim()) {
        throw new Error("Username, full name, and email are required.");
      }
      if (!newAdminForm.password.trim()) {
        throw new Error("Password is required for the new super admin.");
      }
      if (newAdminForm.password !== newAdminForm.confirmPassword) {
        throw new Error("New super admin passwords do not match.");
      }

      const response = await fetch("/api/admin/admin-users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: newAdminForm.username,
          fullName: newAdminForm.fullName,
          email: newAdminForm.email,
          password: newAdminForm.password,
        }),
      });
      const payload = (await response.json()) as { detail?: string };
      if (!response.ok) {
        throw new Error(payload.detail || "Could not create the super admin.");
      }

      await adminAccounts.refresh();
      setNewAdminForm({
        username: "",
        fullName: "",
        email: "",
        password: "",
        confirmPassword: "",
      });
      setSettingsNote("New super admin created successfully.");
    } catch (err) {
      setSettingsNote(err instanceof Error ? err.message : "Could not create the super admin.");
    } finally {
      setCreatingAdmin(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await fetch("/api/admin/auth/sign-out", { method: "POST" });
    } finally {
      clearAdminClientCache();
      window.location.assign("/sign-in");
    }
  };

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Super Admin Settings</h1>
          <p className="mt-1 text-sm text-gray-600">
            Live admin summaries with truthful read-only fallbacks for settings that do not yet have
            persistence.
          </p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {(overview.data?.metrics?.slice(0, 2) ?? []).map((metric) => (
          <div key={metric.id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-gray-600">{metric.label}</p>
            <p className="mt-2 text-3xl font-semibold text-gray-900">{metric.value}</p>
            <p className="mt-2 text-sm text-gray-500">{metric.description}</p>
          </div>
        ))}
        {(users.data?.metrics?.slice(0, 2) ?? []).map((metric) => (
          <div key={metric.id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-gray-600">{metric.label}</p>
            <p className="mt-2 text-3xl font-semibold text-gray-900">{metric.value}</p>
            <p className="mt-2 text-sm text-gray-500">{metric.description}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <UserCog className="h-5 w-5 text-blue-600" />
            <h2 className="text-lg font-semibold text-gray-900">Account Settings</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="text-sm text-gray-700">
              Username
              <input
                value={accountForm.username}
                onChange={(e) => setAccountForm((p) => ({ ...p, username: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm text-gray-700">
              Full Name
              <input
                value={accountForm.fullName}
                onChange={(e) => setAccountForm((p) => ({ ...p, fullName: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm text-gray-700">
              Email
              <input
                type="email"
                value={accountForm.email}
                onChange={(e) => setAccountForm((p) => ({ ...p, email: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm text-gray-700">
              Current Password
              <input
                type="password"
                value={accountForm.currentPassword}
                onChange={(e) => setAccountForm((p) => ({ ...p, currentPassword: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm text-gray-700">
              New Password
              <input
                type="password"
                value={accountForm.newPassword}
                onChange={(e) => setAccountForm((p) => ({ ...p, newPassword: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm text-gray-700 sm:col-span-2">
              Confirm New Password
              <input
                type="password"
                value={accountForm.confirmPassword}
                onChange={(e) => setAccountForm((p) => ({ ...p, confirmPassword: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={() => void handleSaveAccount()}
              disabled={savingAccount}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              {savingAccount ? "Saving..." : "Save Account Changes"}
            </button>
            <button
              onClick={() => void handleSignOut()}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Sign Out
            </button>
            <span className="text-xs text-gray-500">Role: Super Admin</span>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Shield className="h-5 w-5 text-purple-600" />
            <h2 className="text-lg font-semibold text-gray-900">Role Access</h2>
          </div>
          <div className="mb-4 rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-xs text-indigo-700">
            Current primary role: <span className="font-semibold">Super Admin</span>
          </div>
          <div className="space-y-3">
            {admins.slice(0, 6).map((admin) => (
              <div key={admin.id} className="rounded-lg border border-gray-200 p-3">
                <p className="text-sm font-medium text-gray-900">{admin.fullName}</p>
                <p className="mt-1 text-xs text-gray-500">
                  @{admin.username} {admin.email ? `• ${admin.email}` : ""}
                </p>
              </div>
            ))}
            {!admins.length ? (
              <div className="rounded-lg border border-gray-200 p-3 text-sm text-gray-600">
                No super admin accounts have been created yet.
              </div>
            ) : null}
          </div>

          <div className="mt-5 rounded-lg border border-gray-200 p-4">
            <p className="mb-1 text-sm font-semibold text-gray-900">Create New Super Admin</p>
            <p className="mb-3 text-xs text-gray-500">Every admin account currently gets full super admin access.</p>
            <div className="grid grid-cols-1 gap-3">
              <input
                placeholder="Username"
                value={newAdminForm.username}
                onChange={(e) => setNewAdminForm((p) => ({ ...p, username: e.target.value }))}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <input
                placeholder="Full Name"
                value={newAdminForm.fullName}
                onChange={(e) => setNewAdminForm((p) => ({ ...p, fullName: e.target.value }))}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <input
                placeholder="Email"
                type="email"
                value={newAdminForm.email}
                onChange={(e) => setNewAdminForm((p) => ({ ...p, email: e.target.value }))}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <input
                placeholder="Password"
                type="password"
                value={newAdminForm.password}
                onChange={(e) => setNewAdminForm((p) => ({ ...p, password: e.target.value }))}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <input
                placeholder="Confirm Password"
                type="password"
                value={newAdminForm.confirmPassword}
                onChange={(e) => setNewAdminForm((p) => ({ ...p, confirmPassword: e.target.value }))}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <button
              onClick={() => void handleCreateAdmin()}
              disabled={creatingAdmin}
              className="mt-3 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700"
            >
              {creatingAdmin ? "Creating..." : "Create Super Admin"}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <SettingsIcon className="h-5 w-5 text-blue-600" />
            <h2 className="text-lg font-semibold text-gray-900">Feature Toggles</h2>
          </div>
          <div className="space-y-3">
            {Object.entries(featureFlags).map(([key, enabled]) => (
              <label key={key} className="flex items-center justify-between rounded-lg border border-gray-100 p-4">
                <div>
                  <p className="text-sm font-medium text-gray-900">{key}</p>
                  <p className="mt-1 text-xs text-gray-500">Local UI only until backend config storage exists.</p>
                </div>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={() => toggleFeature(key as keyof typeof featureFlags)}
                  className="h-4 w-4"
                />
              </label>
            ))}
          </div>
          <div className="mt-4 rounded-lg border border-amber-100 bg-amber-50 p-4 text-sm text-amber-800">
            These toggles intentionally do not persist yet because there is no admin settings model
            or write API behind them.
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Users className="h-5 w-5 text-purple-600" />
            <h2 className="text-lg font-semibold text-gray-900">Most Active Users</h2>
          </div>
          <div className="space-y-3">
            {(users.data?.powerUsers?.length ? users.data.powerUsers : users.data?.users ?? [])
              .slice(0, 8)
              .map((user) => (
                <div key={user.id} className="rounded-lg border border-gray-100 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{user.email}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        {user.sessionCount} sessions • {user.searchCount} searches •{" "}
                        {user.lastActiveLabel}
                      </p>
                    </div>
                    <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700">
                      {user.role}
                    </span>
                  </div>
                </div>
              ))}
          </div>
          <div className="mt-4 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-700">
            Live user activity comes from the admin analytics endpoints already backing the dashboard.
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Bell className="h-5 w-5 text-orange-600" />
            <h2 className="text-lg font-semibold text-gray-900">Notification & Alert Settings</h2>
          </div>
          <div className="space-y-3">
            {Object.entries(notifications).map(([key, enabled]) => (
              <label key={key} className="flex items-center justify-between rounded-lg border border-gray-100 p-4">
                <div>
                  <p className="text-sm font-medium text-gray-900">{key}</p>
                  <p className="mt-1 text-xs text-gray-500">Read-only UI state for now.</p>
                </div>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={() => toggleNotification(key as keyof typeof notifications)}
                  className="h-4 w-4"
                />
              </label>
            ))}
          </div>
          <p className="mt-4 text-xs text-gray-500">
            Notification channels are not persisted because admin preference storage has not been
            added yet.
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Shield className="h-5 w-5 text-red-600" />
            <h2 className="text-lg font-semibold text-gray-900">Security & Access Notes</h2>
          </div>
          <div className="space-y-3">
            <div className="rounded-lg border border-gray-200 p-4">
              <p className="text-sm font-medium text-gray-900">Admin access model</p>
              <p className="mt-1 text-sm text-gray-600">
                This page currently surfaces read-only analytics. Role management, IP allowlists,
                and session timeout settings require dedicated backend support.
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 p-4">
              <p className="text-sm font-medium text-gray-900">Last overview refresh</p>
              <p className="mt-1 text-sm text-gray-600">{overview.data?.generatedLabel ?? "Unavailable"}</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-4">
              <p className="text-sm font-medium text-gray-900">Last user analytics refresh</p>
              <p className="mt-1 text-sm text-gray-600">{users.data?.generatedLabel ?? "Unavailable"}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <FileText className="h-5 w-5 text-cyan-600" />
            <h2 className="text-lg font-semibold text-gray-900">Recent Feedback</h2>
          </div>
          <div className="space-y-3">
            {(overview.data?.recentFeedback?.slice(0, 6) ?? []).map((item) => (
              <div key={item.id} className="rounded-lg border border-gray-100 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-gray-900">{item.category}</p>
                  <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700">
                    {item.status}
                  </span>
                </div>
                <p className="mt-2 text-sm text-gray-600">{item.messagePreview}</p>
                <p className="mt-2 text-xs text-gray-500">
                  {item.email} • {item.relativeSubmitted}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Database className="h-5 w-5 text-indigo-600" />
            <h2 className="text-lg font-semibold text-gray-900">System Snapshot</h2>
          </div>
          <div className="space-y-3">
            <div className="rounded-lg border border-gray-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-gray-900">Registered users</p>
                <span className="text-sm text-gray-700">{users.data?.totalUserCount ?? 0}</span>
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-gray-900">Power users surfaced</p>
                <span className="text-sm text-gray-700">{users.data?.powerUsers?.length ?? 0}</span>
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-gray-900">Recent sessions sampled</p>
                <span className="text-sm text-gray-700">{overview.data?.recentSessions?.length ?? 0}</span>
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <div className="flex items-center gap-2">
                <Power className="h-4 w-4 text-gray-600" />
                <p className="text-sm text-gray-700">
                  Cache management, backups, and role editing remain intentionally read-only until
                  dedicated admin write APIs are implemented.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-emerald-600" />
          <h2 className="text-lg font-semibold text-gray-900">API Keys (Live)</h2>
        </div>
        <div className="mb-3 text-xs text-gray-500">
          Last updated: {apiMonitoring.data?.generatedLabel ?? "Unavailable"}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-sm text-gray-600">
              <tr>
                <th className="px-3 py-2 font-medium">Provider</th>
                <th className="px-3 py-2 font-medium">Key</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Used (24h)</th>
                <th className="px-3 py-2 font-medium">Remaining</th>
                <th className="px-3 py-2 font-medium">Last Used</th>
              </tr>
            </thead>
            <tbody>
              {(apiMonitoring.data?.apiKeys ?? []).map((keyRow) => (
                <tr key={`${keyRow.provider}-${keyRow.keyName}`} className="border-b border-gray-100">
                  <td className="px-3 py-3 text-sm text-gray-900">{keyRow.provider}</td>
                  <td className="px-3 py-3 text-sm text-gray-700">
                    {keyRow.keyName}
                    {keyRow.keyLast4 ? ` (****${keyRow.keyLast4})` : ""}
                  </td>
                  <td className="px-3 py-3 text-sm">
                    <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-700">
                      {keyRow.status}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-700">{keyRow.requests24h}</td>
                  <td className="px-3 py-3 text-sm text-gray-700">{keyRow.remainingToday ?? 0}</td>
                  <td className="px-3 py-3 text-sm text-gray-700">{keyRow.lastUsed ?? "Never"}</td>
                </tr>
              ))}
              {!apiMonitoring.data?.apiKeys?.length ? (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-sm text-gray-500">
                    No API key usage records found yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        <div className="mb-1 flex items-center gap-2 font-medium">
          <Lock className="h-4 w-4" />
          Settings write operations status
        </div>
        <p>
          Super admin account settings now update the new admin auth table directly, including
          username, email, password changes, and super admin creation.
        </p>
        {settingsNote ? <p className="mt-2 text-xs text-blue-700">Note: {settingsNote}</p> : null}
      </div>
    </div>
  );
}
