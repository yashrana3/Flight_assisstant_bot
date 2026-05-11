"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Award,
  Calendar,
  Clock,
  Download,
  Filter,
  Mail,
  MapPin,
  MessageSquare,
  MousePointer,
  Plane,
  RefreshCw,
  Search,
  Smartphone,
  TrendingDown,
  TrendingUp,
  UserCheck,
  UserPlus,
  UserX,
  Users as UsersIcon,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PageLoader } from "@/components/PageLoader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import type { AdminUsersPageResponse, AdminUsersTableItem } from "@/lib/admin-types";
import { useAdminData } from "@/lib/use-admin-data";

const COUNTRY_COLORS = [
  "#3B82F6",
  "#8B5CF6",
  "#10B981",
  "#F59E0B",
  "#EC4899",
  "#06B6D4",
  "#6B7280",
];

const CLASS_PIE_COLORS = ["#10B981", "#3B82F6", "#8B5CF6", "#F59E0B", "#94a3b8"];

function TrendMini({
  trend,
  change,
}: {
  trend: "up" | "down" | "flat";
  change: string;
}) {
  const color =
    trend === "up" ? "text-green-600" : trend === "down" ? "text-red-600" : "text-gray-500";
  const Icon = trend === "down" ? TrendingDown : TrendingUp;
  return (
    <div className={`flex items-center gap-1 mt-2 ${color}`}>
      {trend === "flat" ? null : <Icon className="w-3 h-3" />}
      <span className="text-xs font-medium">{change}</span>
    </div>
  );
}

export function Users() {
  const [dateRange, setDateRange] = useState("7d");
  const { data, loading, error } = useAdminData<AdminUsersPageResponse>(
    `/api/admin/users?range=${dateRange}`,
  );
  const [query, setQuery] = useState("");
  const [countryFilter, setCountryFilter] = useState("all");
  const [ageFilter, setAgeFilter] = useState("all");
  const [deviceFilter, setDeviceFilter] = useState("all");
  const [classFilter, setClassFilter] = useState("all");
  const [activityFilter, setActivityFilter] = useState("all");
  const [selectedUser, setSelectedUser] = useState<AdminUsersTableItem | null>(null);

  const filteredUsers = useMemo(() => {
    let rows = data?.users ?? [];
    const normalized = query.trim().toLowerCase();
    if (normalized) {
      rows = rows.filter((user) =>
        [user.displayId, user.name, user.email, user.country, user.cabinClass, user.status]
          .join(" ")
          .toLowerCase()
          .includes(normalized),
      );
    }
    if (countryFilter !== "all") {
      rows = rows.filter((u) => u.country === countryFilter);
    }
    if (activityFilter === "active") {
      rows = rows.filter((u) => u.statusTone === "active");
    } else if (activityFilter === "inactive") {
      rows = rows.filter((u) => u.statusTone === "inactive");
    }
    if (ageFilter !== "all" && ageFilter !== "unknown") {
      rows = rows.filter((u) => {
        const a = u.age;
        if (a == null) return false;
        if (ageFilter === "18-24") return a >= 18 && a <= 24;
        if (ageFilter === "25-34") return a >= 25 && a <= 34;
        if (ageFilter === "35-44") return a >= 35 && a <= 44;
        if (ageFilter === "45-54") return a >= 45 && a <= 54;
        if (ageFilter === "55+") return a >= 55;
        return true;
      });
    } else if (ageFilter === "unknown") {
      rows = rows.filter((u) => u.age == null);
    }
    if (classFilter !== "all") {
      rows = rows.filter((u) => {
        const slug = u.preferredClass.toLowerCase().replace(/\s+/g, "-");
        return slug === classFilter;
      });
    }
    // Device telemetry is not stored yet; keep rows unchanged.
    return rows;
  }, [
    data?.users,
    query,
    countryFilter,
    ageFilter,
    deviceFilter,
    classFilter,
    activityFilter,
  ]);

  const countryChartData = useMemo(() => {
    const byCountry = new Map<string, number>();
    for (const user of filteredUsers) {
      const key = user.country || "Unknown";
      byCountry.set(key, (byCountry.get(key) ?? 0) + 1);
    }
    return Array.from(byCountry.entries()).map(([country, users], i) => ({
      country,
      users,
      color: COUNTRY_COLORS[i % COUNTRY_COLORS.length],
    }));
  }, [filteredUsers]);

  const genderPieData = useMemo(() => {
    const byGender = new Map<string, number>();
    for (const user of filteredUsers) {
      const key = user.gender || "Unknown";
      byGender.set(key, (byGender.get(key) ?? 0) + 1);
    }
    return Array.from(byGender.entries()).map(([name, value], i) => ({
      name,
      value,
      color: i % 2 === 0 ? "#3B82F6" : "#EC4899",
    }));
  }, [filteredUsers]);

  const devicePieData = useMemo(() => {
    const n = filteredUsers.length;
    return [{ name: "Unknown", value: Math.max(n, 1), color: "#6B7280" }];
  }, [filteredUsers.length]);

  const classPieData = useMemo(() => {
    const byClass = new Map<string, number>();
    for (const user of filteredUsers) {
      const key = user.preferredClass || "Unknown";
      byClass.set(key, (byClass.get(key) ?? 0) + 1);
    }
    return Array.from(byClass.entries()).map(([name, value], i) => ({
      name,
      value,
      color: CLASS_PIE_COLORS[i % CLASS_PIE_COLORS.length],
    }));
  }, [filteredUsers]);

  const seatBars = useMemo(() => {
    const bySeat = new Map<string, number>();
    for (const user of filteredUsers) {
      const key = user.seatPreference || "Unknown";
      bySeat.set(key, (bySeat.get(key) ?? 0) + 1);
    }
    return Array.from(bySeat.entries()).map(([label, count]) => ({ label, count }));
  }, [filteredUsers]);
  const totalForSeat = seatBars.reduce((s, x) => s + x.count, 0) || 1;

  const departureBars = useMemo(() => {
    const byTiming = new Map<string, number>();
    for (const user of filteredUsers) {
      const key = user.flightTiming || "Unknown";
      byTiming.set(key, (byTiming.get(key) ?? 0) + 1);
    }
    return Array.from(byTiming.entries()).map(([time, count]) => ({ time, count }));
  }, [filteredUsers]);

  const ageDistribution = useMemo(() => {
    const buckets = new Map<string, number>([
      ["18-24", 0],
      ["25-34", 0],
      ["35-44", 0],
      ["45-54", 0],
      ["55+", 0],
      ["Unknown", 0],
    ]);
    for (const user of filteredUsers) {
      const age = user.age;
      if (age == null || age < 18) buckets.set("Unknown", (buckets.get("Unknown") ?? 0) + 1);
      else if (age <= 24) buckets.set("18-24", (buckets.get("18-24") ?? 0) + 1);
      else if (age <= 34) buckets.set("25-34", (buckets.get("25-34") ?? 0) + 1);
      else if (age <= 44) buckets.set("35-44", (buckets.get("35-44") ?? 0) + 1);
      else if (age <= 54) buckets.set("45-54", (buckets.get("45-54") ?? 0) + 1);
      else buckets.set("55+", (buckets.get("55+") ?? 0) + 1);
    }
    return Array.from(buckets.entries()).map(([range, count]) => ({ range, count }));
  }, [filteredUsers]);

  const filteredPowerUsers = useMemo(
    () => [...filteredUsers].sort((a, b) => b.engagementScore - a.engagementScore).slice(0, 10),
    [filteredUsers],
  );

  const totalUsers = data?.totalUserCount ?? 0;

  if (loading && !data) {
    return <PageLoader />;
  }

  return (
    <div className="space-y-6 p-1">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">User Management & Analytics</h1>
          <p className="mt-1 text-sm text-gray-600">
            Manage user accounts and analyze platform engagement — live data from user and chat
            databases.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
            Last updated: {data?.generatedLabel ?? "—"}
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
          >
            <option value="7d">Last 7 days</option>
            <option value="15d">Last 15 days</option>
            <option value="30d">Last 30 days</option>
          </select>
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, email, or ID..."
              className="pl-10"
            />
          </div>
          <select
            value={countryFilter}
            onChange={(e) => setCountryFilter(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
          >
            <option value="all">All Countries</option>
            {countryChartData.map((c) => (
              <option key={c.country} value={c.country}>
                {c.country}
              </option>
            ))}
          </select>
          <select
            value={ageFilter}
            onChange={(e) => setAgeFilter(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
          >
            <option value="all">All Ages</option>
            <option value="18-24">18-24</option>
            <option value="25-34">25-34</option>
            <option value="35-44">35-44</option>
            <option value="45-54">45-54</option>
            <option value="55+">55+</option>
            <option value="unknown">Unknown</option>
          </select>
          {/* <select
            value={deviceFilter}
            onChange={(e) => setDeviceFilter(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
          >
            <option value="all">All Devices</option>
            <option value="mobile">Mobile</option>
            <option value="desktop">Desktop</option>
            <option value="tablet">Tablet</option>
          </select> */}
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
          >
            <option value="all">All Classes</option>
            <option value="economy">Economy</option>
            <option value="premium-economy">Premium Economy</option>
            <option value="business">Business</option>
            <option value="first-class">First Class</option>
          </select>
          <select
            value={activityFilter}
            onChange={(e) => setActivityFilter(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
          >
            <option value="all">All Users</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <Button variant="outline" size="sm" className="gap-2" disabled>
            <Download className="h-4 w-4" />
            Export
          </Button>
          <span className="flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] text-blue-700">
            <Filter className="h-3 w-3" />
            Device filter N/A (no device data)
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {(data?.kpiCards ?? []).map((card) => (
          <div
            key={card.id}
            className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm text-gray-600">{card.title}</div>
              {card.id === "total-users" ? (
                <UsersIcon className="h-5 w-5 text-blue-600" />
              ) : card.id === "active-users" ? (
                <UserCheck className="h-5 w-5 text-green-600" />
              ) : card.id === "inactive-users" ? (
                <UserX className="h-5 w-5 text-gray-600" />
              ) : card.id === "new-week" ? (
                <UserPlus className="h-5 w-5 text-purple-600" />
              ) : card.id === "avg-searches" ? (
                <Search className="h-5 w-5 text-orange-600" />
              ) : (
                <MessageSquare className="h-5 w-5 text-cyan-600" />
              )}
            </div>
            <div className="text-2xl font-semibold text-gray-900">{card.value}</div>
            <TrendMini trend={card.trend} change={card.change} />
            <div className="mt-3 h-8">
              <ResponsiveContainer width="100%" height={32}>
                <LineChart data={card.sparkline}>
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke={card.stroke}
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-gray-900">Age Distribution</h3>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ageDistribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="range" stroke="#9CA3AF" style={{ fontSize: 12 }} />
                <YAxis stroke="#9CA3AF" style={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    borderRadius: 8,
                    border: "1px solid #E5E7EB",
                  }}
                />
                <Bar dataKey="count" fill="#3B82F6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-gray-900">Country Distribution</h3>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={countryChartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis type="number" stroke="#9CA3AF" style={{ fontSize: 12 }} />
                <YAxis
                  dataKey="country"
                  type="category"
                  stroke="#9CA3AF"
                  style={{ fontSize: 12 }}
                  width={80}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: 8,
                    border: "1px solid #E5E7EB",
                  }}
                />
                <Bar dataKey="users" radius={[0, 4, 4, 0]}>
                  {countryChartData.map((entry, index) => (
                    <Cell key={`c-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-gray-900">Gender Distribution</h3>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={genderPieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {genderPieData.map((entry, index) => (
                    <Cell key={`g-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-gray-900">Device Usage</h3>
          <p className="mb-2 text-xs text-gray-500">{data?.deviceNote}</p>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={devicePieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {devicePieData.map((entry, index) => (
                    <Cell key={`d-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-lg font-semibold text-gray-900">Profile Completion Analytics</h3>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">Profile completion (avg)</span>
              <span className="text-sm font-semibold text-gray-900">
                {data?.profileSummary.avgCompletionPct.toFixed(1) ?? "0"}%
              </span>
            </div>
            <Progress
              value={Math.min(100, data?.profileSummary.avgCompletionPct ?? 0)}
              className="h-3 [&>div]:bg-blue-600"
            />
            <p className="mt-2 text-xs text-gray-600">
              {data?.profileSummary.completedProfilesCount ?? 0} users at 80%+ completion
            </p>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">Travel preferences set</span>
              <span className="text-sm font-semibold text-gray-900">
                {data?.profileSummary.travelPrefsPct.toFixed(1) ?? "0"}%
              </span>
            </div>
            <Progress
              value={Math.min(100, data?.profileSummary.travelPrefsPct ?? 0)}
              className="h-3 [&>div]:bg-green-600"
            />
            <p className="mt-2 text-xs text-gray-600">
              {data?.profileSummary.travelPrefsUsers ?? 0} users with cabin or seat preference
            </p>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">Avg onboarding time</span>
              <span className="text-sm font-semibold text-gray-900">—</span>
            </div>
            <Progress value={0} className="h-3 [&>div]:bg-purple-600" />
            <p className="mt-2 text-xs text-gray-600">{data?.profileSummary.onboardingNote}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-gray-900">Preferred Class of Service</h3>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={classPieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={5}
                  dataKey="value"
                  label={(e: { name?: string }) => e.name}
                >
                  {classPieData.map((entry, index) => (
                    <Cell key={`cl-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-gray-900">Seat & Time Preferences</h3>
          <div className="space-y-6">
            <div>
              <h4 className="mb-3 text-sm font-medium text-gray-700">Seat preference</h4>
              <div className="space-y-3">
                {seatBars.map((pref) => (
                  <div key={pref.label}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="text-gray-700">{pref.label}</span>
                      <span className="font-semibold text-gray-900">{pref.count}</span>
                    </div>
                    <Progress
                      value={Math.max(4, (pref.count / totalForSeat) * 100)}
                      className="h-2"
                    />
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h4 className="mb-3 text-sm font-medium text-gray-700">Departure time preference</h4>
              <div className="h-[120px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={departureBars}>
                    <XAxis dataKey="time" stroke="#9CA3AF" style={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="mb-1 text-lg font-semibold text-gray-900">Engagement Over Time</h3>
          <p className="mb-4 text-sm text-gray-600">
            Searches and chat sessions per active user by day (7-day window).
          </p>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data?.engagementOverTime ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="label" stroke="#9CA3AF" style={{ fontSize: 12 }} />
                <YAxis stroke="#9CA3AF" style={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    borderRadius: 8,
                    border: "1px solid #E5E7EB",
                  }}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="searches"
                  stroke="#3B82F6"
                  strokeWidth={3}
                  name="Searches / user"
                />
                <Line
                  type="monotone"
                  dataKey="chats"
                  stroke="#8B5CF6"
                  strokeWidth={3}
                  name="Sessions / user"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="mb-1 text-lg font-semibold text-gray-900">Session Duration Distribution</h3>
          <p className="mb-4 text-sm text-gray-600">Authenticated chat session lengths (bucketed).</p>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.sessionDuration ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="duration" stroke="#9CA3AF" style={{ fontSize: 12 }} />
                <YAxis stroke="#9CA3AF" style={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    borderRadius: 8,
                    border: "1px solid #E5E7EB",
                  }}
                />
                <Bar dataKey="users" fill="#10B981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-lg font-semibold text-gray-900">User Conversion Analytics</h3>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
            <div className="mb-2 flex items-center justify-between">
              <MousePointer className="h-5 w-5 text-blue-600" />
              <ArrowUpRight className="h-4 w-4 text-blue-600" />
            </div>
            <div className="text-2xl font-semibold text-gray-900">
              {data?.conversionSummary.redirectRatePct.toFixed(1) ?? "0"}%
            </div>
            <div className="mt-1 text-sm text-gray-700">Redirect rate</div>
            <div className="mt-2 text-xs text-blue-600">From chat search → redirect messages</div>
          </div>
          <div className="rounded-lg border border-green-200 bg-green-50 p-4">
            <div className="mb-2 flex items-center justify-between">
              <Plane className="h-5 w-5 text-green-600" />
              <ArrowUpRight className="h-4 w-4 text-green-600" />
            </div>
            <div className="text-2xl font-semibold text-gray-900">
              {data?.conversionSummary.avgFlightPriceLabel ?? "—"}
            </div>
            <div className="mt-1 text-sm text-gray-700">Avg flight price</div>
            <div className="mt-2 text-xs text-green-600">Not tracked in DB</div>
          </div>
          <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
            <div className="mb-2 flex items-center justify-between">
              <Activity className="h-5 w-5 text-purple-600" />
              <ArrowUpRight className="h-4 w-4 text-purple-600" />
            </div>
            <div className="text-2xl font-semibold text-gray-900">
              {data?.conversionSummary.searchToRedirectPct.toFixed(1) ?? "0"}%
            </div>
            <div className="mt-1 text-sm text-gray-700">Search → redirect</div>
            <div className="mt-2 text-xs text-purple-600">Same ratio as redirect rate</div>
          </div>
          <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
            <div className="mb-2 flex items-center justify-between">
              <MessageSquare className="h-5 w-5 text-orange-600" />
              <TrendingUp className="h-4 w-4 text-orange-600" />
            </div>
            <div className="text-2xl font-semibold text-gray-900">
              {data?.conversionSummary.avgChatsPerUser.toFixed(1) ?? "0"}
            </div>
            <div className="mt-1 text-sm text-gray-700">Avg AI chats / user</div>
            <div className="mt-2 text-xs text-orange-600">Messages attributed per profile</div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">Power User Analytics</h3>
          <Badge variant="outline" className="gap-1">
            <Award className="h-3 w-3" />
            Top {Math.min(10, filteredPowerUsers.length)} users
          </Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">User ID</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Name</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">Searches</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">AI Chats</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">Conversions</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">Engagement</th>
              </tr>
            </thead>
            <tbody>
              {filteredPowerUsers.map((user) => (
                <tr key={user.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-sm text-gray-600">{user.displayId}</td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{user.name}</td>
                  <td className="px-4 py-3 text-right text-sm text-gray-900">{user.searches}</td>
                  <td className="px-4 py-3 text-right text-sm text-gray-900">{user.messageCount}</td>
                  <td className="px-4 py-3 text-right text-sm text-gray-900">{user.conversions}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-24">
                        <Progress value={user.engagementScore} className="h-2" />
                      </div>
                      <span className="w-8 text-sm font-semibold text-gray-900">
                        {user.engagementScore}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900">User Database</h3>
          <p className="mt-1 text-sm text-gray-600">Complete user account management (sample)</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1280px]">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-sm text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">User ID</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Country</th>
                <th className="px-4 py-3 font-medium">Age</th>
                <th className="px-4 py-3 font-medium">Preferred Class</th>
                <th className="px-4 py-3 font-medium">Searches</th>
                <th className="px-4 py-3 font-medium">Conversions</th>
                <th className="px-4 py-3 font-medium">Join Date</th>
                <th className="px-4 py-3 font-medium">Last Active</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr
                  key={user.id}
                  className="cursor-pointer border-b border-gray-100 transition-colors hover:bg-gray-50"
                  onClick={() => setSelectedUser(user)}
                >
                  <td className="px-4 py-4 font-mono text-sm text-gray-600">{user.displayId}</td>
                  <td className="px-4 py-4 text-sm font-medium text-gray-900">{user.name}</td>
                  <td className="px-4 py-4 text-sm text-gray-600">{user.email}</td>
                  <td className="px-4 py-4 text-sm text-gray-700">{user.country}</td>
                  <td className="px-4 py-4 text-sm text-gray-700">{user.age ?? "—"}</td>
                  <td className="px-4 py-4 text-sm text-gray-700">{user.preferredClass}</td>
                  <td className="px-4 py-4 text-right text-sm text-gray-900">{user.searches}</td>
                  <td className="px-4 py-4 text-right text-sm text-gray-900">{user.conversions}</td>
                  <td className="px-4 py-4 text-sm text-gray-600">{user.joinDateLabel}</td>
                  <td className="px-4 py-4 text-sm text-gray-600">{user.lastActiveDateLabel}</td>
                  <td className="px-4 py-4 text-center">
                    <Badge
                      className={
                        user.statusTone === "active"
                          ? "bg-green-100 text-green-800 hover:bg-green-100"
                          : ""
                      }
                      variant={user.statusTone === "active" ? "default" : "secondary"}
                    >
                      {user.statusTone}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col items-start justify-between gap-3 border-t border-gray-200 px-6 py-4 sm:flex-row sm:items-center">
          <div className="text-sm text-gray-600">
            Showing {filteredUsers.length} of {totalUsers.toLocaleString()} users (table lists recent
            sample)
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled>
              Previous
            </Button>
            <Button size="sm" disabled>
              1
            </Button>
            <Button variant="outline" size="sm" disabled>
              Next
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={Boolean(selectedUser)} onOpenChange={(o) => !o && setSelectedUser(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          {selectedUser ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
                    <UsersIcon className="h-6 w-6 text-blue-600" />
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-xl font-semibold text-gray-900">{selectedUser.name}</div>
                    <div className="text-sm font-normal text-gray-600">{selectedUser.email}</div>
                  </div>
                  <Badge
                    className={
                      selectedUser.statusTone === "active"
                        ? "bg-green-100 text-green-800 hover:bg-green-100"
                        : ""
                    }
                  >
                    {selectedUser.statusTone}
                  </Badge>
                </DialogTitle>
              </DialogHeader>
              <div className="mt-4 space-y-6">
                <div>
                  <h4 className="mb-3 text-sm font-semibold text-gray-900">Profile</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-gray-500" />
                      <span className="text-gray-600">Email:</span>
                      <span className="font-medium text-gray-900">{selectedUser.email}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-gray-500" />
                      <span className="text-gray-600">Country:</span>
                      <span className="font-medium text-gray-900">{selectedUser.country}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-gray-500" />
                      <span className="text-gray-600">Age:</span>
                      <span className="font-medium text-gray-900">
                        {selectedUser.age ?? "—"} years
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Smartphone className="h-4 w-4 text-gray-500" />
                      <span className="text-gray-600">Device:</span>
                      <span className="font-medium text-gray-900">Not stored</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-gray-500" />
                      <span className="text-gray-600">Joined:</span>
                      <span className="font-medium text-gray-900">{selectedUser.joinDateLabel}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-gray-500" />
                      <span className="text-gray-600">Last active:</span>
                      <span className="font-medium text-gray-900">
                        {selectedUser.lastActiveDateLabel}
                      </span>
                    </div>
                  </div>
                </div>
                <div>
                  <h4 className="mb-3 text-sm font-semibold text-gray-900">Activity</h4>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                      <div className="text-2xl font-semibold text-gray-900">
                        {selectedUser.searches}
                      </div>
                      <div className="mt-1 text-xs text-gray-600">Searches</div>
                    </div>
                    <div className="rounded-lg border border-purple-200 bg-purple-50 p-3">
                      <div className="text-2xl font-semibold text-gray-900">
                        {selectedUser.messageCount}
                      </div>
                      <div className="mt-1 text-xs text-gray-600">AI messages</div>
                    </div>
                    <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                      <div className="text-2xl font-semibold text-gray-900">
                        {selectedUser.conversions}
                      </div>
                      <div className="mt-1 text-xs text-gray-600">Confirmed trips</div>
                    </div>
                  </div>
                </div>
                <div>
                  <h4 className="mb-3 text-sm font-semibold text-gray-900">Travel preferences</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-lg border border-gray-200 p-3">
                      <div className="mb-1 text-xs text-gray-600">Class</div>
                      <div className="text-sm font-medium text-gray-900">
                        {selectedUser.cabinClass}
                      </div>
                    </div>
                    <div className="rounded-lg border border-gray-200 p-3">
                      <div className="mb-1 text-xs text-gray-600">Seat</div>
                      <div className="text-sm font-medium text-gray-900">
                        {selectedUser.seatPreference}
                      </div>
                    </div>
                    <div className="rounded-lg border border-gray-200 p-3">
                      <div className="mb-1 text-xs text-gray-600">Timing</div>
                      <div className="text-sm font-medium text-gray-900">
                        {selectedUser.flightTiming}
                      </div>
                    </div>
                  </div>
                </div>
                <div>
                  <h4 className="mb-3 text-sm font-semibold text-gray-900">Engagement</h4>
                  <div className="space-y-3">
                    <div>
                      <div className="mb-1 flex justify-between text-sm">
                        <span className="text-gray-700">Profile completion</span>
                        <span className="font-semibold text-gray-900">
                          {selectedUser.profileCompletion}%
                        </span>
                      </div>
                      <Progress value={selectedUser.profileCompletion} className="h-2" />
                    </div>
                    <div>
                      <div className="mb-1 flex justify-between text-sm">
                        <span className="text-gray-700">Engagement score</span>
                        <span className="font-semibold text-gray-900">
                          {selectedUser.engagementScore}
                        </span>
                      </div>
                      <Progress
                        value={selectedUser.engagementScore}
                        className="h-2 [&>div]:bg-purple-600"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
