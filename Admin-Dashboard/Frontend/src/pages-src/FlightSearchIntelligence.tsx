"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Pie,
  PieChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Area,
  Line,
  ComposedChart,
} from "recharts";
import {
  Calendar,
  MapPin,
  Plane,
  RefreshCw,
  Search,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";

import { PageLoader } from "@/components/PageLoader";
import type {
  AdminGrowthPageResponse,
  AdminMetricCard,
  AdminUsersPageResponse,
} from "@/lib/admin-types";
import { useAdminData } from "@/lib/use-admin-data";

const CABIN_COLORS = ["#3b82f6", "#8b5cf6", "#f59e0b", "#10b981", "#94a3b8"];
const TIMING_COLORS = ["#3b82f6", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#06b6d4"];

function metricById(metrics: AdminMetricCard[] | undefined, id: string): AdminMetricCard | undefined {
  return metrics?.find((m) => m.id === id);
}

export function FlightSearchIntelligence() {
  const { data: growth, loading: loadingGrowth, error: errGrowth, refresh: refreshGrowth } =
    useAdminData<AdminGrowthPageResponse>("/api/admin/growth");
  const { data: users, loading: loadingUsers, error: errUsers, refresh: refreshUsers } =
    useAdminData<AdminUsersPageResponse>("/api/admin/users");

  const loading = (loadingGrowth || loadingUsers) && !growth && !users;
  const error = errGrowth || errUsers;

  const refresh = () => {
    void refreshGrowth();
    void refreshUsers();
  };

  const trend = growth?.growthTrend ?? [];
  const searchSum = trend.reduce((a, p) => a + p.searches, 0);
  const redirectSum = trend.reduce((a, p) => a + p.redirects, 0);
  const redirectRate =
    searchSum > 0 ? ((redirectSum / searchSum) * 100).toFixed(1) : "0.0";

  const cabinPie =
    users?.distributions.cabinClasses.map((d) => ({
      name: d.label,
      value: d.count,
    })) ?? [];
  const timingPie =
    users?.distributions.flightTimings.map((d) => ({
      name: d.label,
      value: d.count,
    })) ?? [];

  if (loading) {
    return <PageLoader />;
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-4 md:space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Flight Search Intelligence</h1>
          <p className="text-xs md:text-sm text-gray-600 mt-1">
            Live routes from chat flight results and saved trips, plus search volume and funnel signals from
            admin analytics.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600">
            Last updated: {growth?.generatedLabel ?? users?.generatedLabel ?? "—"}
          </div>
          <button
            type="button"
            onClick={() => refresh()}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      ) : null}

      {/* KPIs — subset of growth metrics + derived redirect rate */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm">
          <div className="flex items-center gap-2 text-gray-500 mb-2">
            <Search className="w-4 h-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Total searches</span>
          </div>
          <p className="text-2xl font-semibold text-gray-900">
            {metricById(growth?.metrics, "searches-total")?.value ?? "—"}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {metricById(growth?.metrics, "searches-total")?.description ?? ""}
          </p>
        </div>
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm">
          <div className="flex items-center gap-2 text-gray-500 mb-2">
            <MapPin className="w-4 h-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Distinct search routes</span>
          </div>
          <p className="text-2xl font-semibold text-gray-900">
            {metricById(growth?.metrics, "distinct-search-routes")?.value ?? "—"}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Unique origin→destination pairs from flight result messages
          </p>
        </div>
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm">
          <div className="flex items-center gap-2 text-gray-500 mb-2">
            <Users className="w-4 h-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Avg searches / user</span>
          </div>
          <p className="text-2xl font-semibold text-gray-900">
            {metricById(users?.metrics, "avg-searches")?.value ?? "—"}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {metricById(users?.metrics, "avg-searches")?.description ?? ""}
          </p>
        </div>
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm">
          <div className="flex items-center gap-2 text-gray-500 mb-2">
            <Plane className="w-4 h-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Users with trips</span>
          </div>
          <p className="text-2xl font-semibold text-gray-900">
            {metricById(users?.metrics, "users-with-trips")?.value ?? "—"}
          </p>
          <p className="text-xs text-gray-500 mt-1">Saved trips in the user database</p>
        </div>
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm">
          <div className="flex items-center gap-2 text-gray-500 mb-2">
            <TrendingUp className="w-4 h-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Redirect events</span>
          </div>
          <p className="text-2xl font-semibold text-gray-900">
            {metricById(growth?.metrics, "redirects")?.value ?? "—"}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {metricById(growth?.metrics, "redirects")?.description ?? ""}
          </p>
        </div>
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm">
          <div className="flex items-center gap-2 text-gray-500 mb-2">
            <Target className="w-4 h-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Redirect rate (7d)</span>
          </div>
          <p className="text-2xl font-semibold text-gray-900">{redirectRate}%</p>
          <p className="text-xs text-gray-500 mt-1">Redirects ÷ flight searches (last 7 days)</p>
        </div>
      </div>

      {/* Search volume trend */}
      <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <Calendar className="w-5 h-5 text-blue-600" />
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Flight search volume</h3>
            <p className="text-sm text-gray-600">Daily searches from chat (7-day window)</p>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={trend}>
            <defs>
              <linearGradient id="fsiSearchGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6b7280" }} stroke="#9ca3af" />
            <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} stroke="#9ca3af" />
            <Tooltip
              contentStyle={{
                backgroundColor: "white",
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
                fontSize: "12px",
              }}
            />
            <Legend />
            <Area
              type="monotone"
              dataKey="searches"
              stroke="#3b82f6"
              strokeWidth={2}
              fill="url(#fsiSearchGrad)"
              name="Searches"
            />
            <Line
              type="monotone"
              dataKey="redirects"
              stroke="#059669"
              strokeWidth={2}
              dot={false}
              name="Redirects"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Routes: searched (chat) vs booked (trips) */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <Search className="w-5 h-5 text-blue-600" />
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Top routes (flight search results)</h3>
              <p className="text-sm text-gray-600">
                Inferred from assistant flight payloads (search metadata or IATA pairs in content)
              </p>
            </div>
          </div>
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs font-medium text-gray-500">
                  <th className="py-2 pr-4">#</th>
                  <th className="py-2 pr-4">Route</th>
                  <th className="py-2 text-right">Count</th>
                </tr>
              </thead>
              <tbody>
                {(growth?.topSearchRoutes?.length ? growth.topSearchRoutes : []).map((row, i) => (
                  <tr key={`${row.label}-${i}`} className="border-b border-gray-100">
                    <td className="py-2 pr-4 text-gray-500">{i + 1}</td>
                    <td className="py-2 pr-4 font-medium text-gray-900">{row.label}</td>
                    <td className="py-2 text-right tabular-nums">{row.count}</td>
                  </tr>
                ))}
                {!growth?.topSearchRoutes?.length ? (
                  <tr>
                    <td colSpan={3} className="py-6 text-center text-gray-500">
                      No flight result routes recorded yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <Plane className="w-5 h-5 text-purple-600" />
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Top booked areas (saved trips)</h3>
              <p className="text-sm text-gray-600">Origin → destination from trips stored for users</p>
            </div>
          </div>
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs font-medium text-gray-500">
                  <th className="py-2 pr-4">#</th>
                  <th className="py-2 pr-4">Route</th>
                  <th className="py-2 text-right">Trips</th>
                </tr>
              </thead>
              <tbody>
                {(growth?.topRoutes?.length ? growth.topRoutes : []).map((row, i) => (
                  <tr key={`${row.label}-${i}`} className="border-b border-gray-100">
                    <td className="py-2 pr-4 text-gray-500">{i + 1}</td>
                    <td className="py-2 pr-4 font-medium text-gray-900">{row.label}</td>
                    <td className="py-2 text-right tabular-nums">{row.count}</td>
                  </tr>
                ))}
                {!growth?.topRoutes?.length ? (
                  <tr>
                    <td colSpan={3} className="py-6 text-center text-gray-500">
                      No saved trips yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Preferences from user profiles */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900 mb-1">Cabin class (saved preferences)</h3>
          <p className="text-sm text-gray-600 mb-4">Distribution across users with travel preferences</p>
          <div className="flex justify-center">
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={cabinPie.length ? cabinPie : [{ name: "No data", value: 1 }]}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={2}
                  dataKey="value"
                  nameKey="name"
                >
                  {(cabinPie.length ? cabinPie : [{ name: "No data", value: 1 }]).map((_, index) => (
                    <Cell
                      key={`cabin-${index}`}
                      fill={CABIN_COLORS[index % CABIN_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => v} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900 mb-1">Flight timing preference</h3>
          <p className="text-sm text-gray-600 mb-4">How users prefer to schedule flights</p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={timingPie.length ? timingPie : [{ name: "No data", value: 0 }]}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#6b7280" }} stroke="#9ca3af" />
              <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} stroke="#9ca3af" />
              <Tooltip />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {(timingPie.length ? timingPie : [{ name: "No data", value: 0 }]).map((_, index) => (
                  <Cell key={`ft-${index}`} fill={TIMING_COLORS[index % TIMING_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Funnel */}
      <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-1">Engagement funnel</h3>
        <p className="text-sm text-gray-600 mb-4">Registered users through searches, options, redirects, and trips</p>
        <div className="space-y-3">
          {(growth?.funnelStages ?? []).map((stage) => (
            <div key={stage.label}>
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium text-gray-800">{stage.label}</span>
                <span className="text-gray-600 tabular-nums">
                  {stage.count.toLocaleString()} ({stage.percentage}%)
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                <div
                  className="h-2.5 rounded-full bg-blue-500 transition-all"
                  style={{ width: `${Math.min(100, stage.percentage)}%` }}
                />
              </div>
            </div>
          ))}
          {!growth?.funnelStages?.length ? (
            <p className="text-sm text-gray-500">No funnel data available.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
