"use client";

import { RefreshCw } from "lucide-react";
import {
  Area,
  AreaChart,
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
import type { AdminBehaviorPageResponse } from "@/lib/admin-types";
import { useAdminData } from "@/lib/use-admin-data";

const toneMap = {
  blue: "bg-blue-50 text-blue-700",
  purple: "bg-purple-50 text-purple-700",
  green: "bg-emerald-50 text-emerald-700",
  orange: "bg-orange-50 text-orange-700",
  red: "bg-red-50 text-red-700",
};

export function UserBehavior() {
  const { data, loading, error } = useAdminData<AdminBehaviorPageResponse>(
    "/api/admin/behavior",
  );
  const sparkline = data?.activityTrend ?? [];
  const totalSessions = data?.metrics.find((metric) => metric.id === "session-count")?.value ?? "0";
  const avgSearches =
    data?.metrics.find((metric) => metric.id === "avg-searches-session")?.value ?? "0";
  const avgMessages =
    data?.metrics.find((metric) => metric.id === "avg-messages-session")?.value ?? "0";
  const avgDuration = data?.metrics.find((metric) => metric.id === "avg-duration")?.value ?? "0";
  const topRouteTotal = (data?.topRoutes ?? []).reduce((sum, row) => sum + row.count, 0);
  const topPromptTotal = (data?.topPrompts ?? []).reduce((sum, row) => sum + row.count, 0);
  const eventsPerSession = (data?.messageDistribution ?? []).map((row, index) => ({
    ...row,
    color: ["#3B82F6", "#8B5CF6", "#10B981", "#F59E0B", "#EF4444"][index % 5],
  }));
  const engagementBands = {
    high: eventsPerSession
      .filter((row) => /(11|20|\+|10)/i.test(row.label))
      .reduce((sum, row) => sum + row.count, 0),
    moderate: eventsPerSession
      .filter((row) => /(6|7|8|9)/i.test(row.label))
      .reduce((sum, row) => sum + row.count, 0),
    low: eventsPerSession
      .filter((row) => /(1|2|3|4|5)/i.test(row.label))
      .reduce((sum, row) => sum + row.count, 0),
  };
  const engagementTotal = Math.max(
    engagementBands.high + engagementBands.moderate + engagementBands.low,
    1,
  );

  if (loading && !data) {
    return <PageLoader />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">User Behavior</h1>
          <p className="mt-1 text-sm text-gray-600">
            Interaction analytics from live chat sessions, searches, and saved travel activity.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600">
            Last updated: {data?.generatedLabel ?? "Unavailable"}
          </div>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {[
          {
            id: "sessions",
            label: "Total Sessions",
            value: totalSessions,
            tone: "blue" as const,
            chart: "sessions",
          },
          {
            id: "searches",
            label: "Avg Searches / Session",
            value: avgSearches,
            tone: "green" as const,
            chart: "searches",
          },
          {
            id: "messages",
            label: "Avg Messages / Session",
            value: avgMessages,
            tone: "purple" as const,
            chart: "messages",
          },
          {
            id: "duration",
            label: "Avg Session Duration",
            value: avgDuration,
            tone: "orange" as const,
            chart: "messages",
          },
          {
            id: "routes",
            label: "Tracked Routes",
            value: `${data?.topRoutes.length ?? 0}`,
            tone: "blue" as const,
            chart: "searches",
          },
          {
            id: "prompts",
            label: "Tracked Prompts",
            value: `${data?.topPrompts.length ?? 0}`,
            tone: "red" as const,
            chart: "messages",
          },
        ].map((metric) => (
          <div key={metric.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs text-gray-600">{metric.label}</p>
                <p className="mt-1 text-2xl font-semibold text-gray-900">{metric.value}</p>
              </div>
              <div className={`rounded-xl p-3 ${toneMap[metric.tone]}`}>
                <RefreshCw className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-3 h-10">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sparkline}>
                  <Area
                    type="monotone"
                    dataKey={metric.chart}
                    stroke={
                      metric.tone === "red"
                        ? "#ef4444"
                        : metric.tone === "purple"
                          ? "#8b5cf6"
                          : metric.tone === "green"
                            ? "#10b981"
                            : metric.tone === "orange"
                              ? "#f59e0b"
                              : "#2563eb"
                    }
                    fill={
                      metric.tone === "red"
                        ? "#fee2e2"
                        : metric.tone === "purple"
                          ? "#ede9fe"
                          : metric.tone === "green"
                            ? "#d1fae5"
                            : metric.tone === "orange"
                              ? "#ffedd5"
                              : "#dbeafe"
                    }
                    fillOpacity={0.8}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Searches Per Session</h2>
            <p className="text-sm text-gray-600">Distribution from real assistant search events.</p>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.searchDistribution ?? []}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} angle={-15} textAnchor="end" height={60} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#3B82F6" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Most Searched Routes</h2>
            <p className="text-sm text-gray-600">Top route interest from session payload analysis.</p>
          </div>
          <div className="space-y-3">
            {(data?.topRoutes ?? []).slice(0, 8).map((item) => (
              <div key={item.label} className="flex items-center justify-between rounded-xl border border-gray-100 p-4">
                <p className="text-sm font-medium text-gray-900">{item.label}</p>
                <p className="text-xs text-gray-500">
                  {item.count.toLocaleString()} ({topRouteTotal > 0 ? Math.round((item.count / topRouteTotal) * 100) : 0}%)
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Hourly Activity</h2>
            <p className="text-sm text-gray-600">Sessions, messages, and searches by hour buckets.</p>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data?.activityTrend ?? []}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="sessions" stroke="#2563eb" strokeWidth={3} />
                <Line type="monotone" dataKey="messages" stroke="#8b5cf6" strokeWidth={3} />
                <Line type="monotone" dataKey="searches" stroke="#10b981" strokeWidth={3} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Events Per Session</h2>
            <p className="text-sm text-gray-600">Engagement mix based on message-count buckets.</p>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={eventsPerSession} dataKey="count" nameKey="label" innerRadius={50} outerRadius={96}>
                  {eventsPerSession.map((entry) => (
                    <Cell key={entry.label} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-600">Highly Engaged</p>
          <p className="mt-2 text-3xl font-semibold text-emerald-700">
            {Math.round((engagementBands.high / engagementTotal) * 100)}%
          </p>
          <p className="mt-2 text-xs text-gray-500">High-message buckets</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-600">Moderately Engaged</p>
          <p className="mt-2 text-3xl font-semibold text-blue-700">
            {Math.round((engagementBands.moderate / engagementTotal) * 100)}%
          </p>
          <p className="mt-2 text-xs text-gray-500">Mid-range interaction sessions</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-600">Low Engagement</p>
          <p className="mt-2 text-3xl font-semibold text-gray-700">
            {Math.round((engagementBands.low / engagementTotal) * 100)}%
          </p>
          <p className="mt-2 text-xs text-gray-500">Short conversations and early exits</p>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Top AI Prompts</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-sm text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">Prompt</th>
                <th className="px-4 py-3 font-medium text-right">Count</th>
                <th className="px-4 py-3 font-medium text-right">% Share</th>
              </tr>
            </thead>
            <tbody>
              {(data?.topPrompts ?? []).slice(0, 10).map((item) => (
                <tr key={item.label} className="border-b border-gray-100">
                  <td className="px-4 py-3 text-sm text-gray-900">{item.label}</td>
                  <td className="px-4 py-3 text-sm text-gray-700 text-right">{item.count.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-gray-700 text-right">
                    {topPromptTotal > 0 ? Math.round((item.count / topPromptTotal) * 100) : 0}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        Sorting preferences, filter usage distribution, and decision-speed telemetry are not stored
        in the current analytics schema, so those visual-only widgets are intentionally removed.
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Session Duration</h2>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data?.sessionDurationDistribution ?? []}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} angle={-15} textAnchor="end" height={60} />
              <YAxis tickLine={false} axisLine={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#F59E0B" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Recent Session Activity</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px]">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-sm text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">Session</th>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Messages</th>
                <th className="px-4 py-3 font-medium">Searches</th>
                <th className="px-4 py-3 font-medium">Latest Message</th>
              </tr>
            </thead>
            <tbody>
              {data?.recentActivity.map((item) => (
                <tr key={item.id} className="border-b border-gray-100 align-top">
                  <td className="px-4 py-4 text-sm font-medium text-gray-900">
                    {item.displayId}
                  </td>
                  <td className="px-4 py-4 text-sm text-gray-700">
                    <p>{item.userLabel}</p>
                    <p className="text-xs text-gray-500">{item.updatedLabel}</p>
                  </td>
                  <td className="px-4 py-4 text-sm">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        item.status === "Active"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {item.status}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-sm text-gray-700">{item.messageCount}</td>
                  <td className="px-4 py-4 text-sm text-gray-700">{item.searchCount}</td>
                  <td className="px-4 py-4 text-sm text-gray-700">{item.lastMessagePreview}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
