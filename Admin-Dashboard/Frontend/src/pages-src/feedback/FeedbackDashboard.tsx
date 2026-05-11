"use client";

import {
  AlertCircle,
  CheckCircle,
  Clock,
  MessageSquare,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Line, LineChart, ResponsiveContainer } from "recharts";

import { PageLoader } from "@/components/PageLoader";
import type { AdminFeedbackDashboardResponse } from "@/lib/admin-types";
import { useAdminData } from "@/lib/use-admin-data";

const iconMap = {
  messages: MessageSquare,
  "trend-up": TrendingUp,
  alert: AlertCircle,
  check: CheckCircle,
  clock: Clock,
  sparkles: Sparkles,
} as const;

function buildSparkline(count: number) {
  const base = Math.max(1, Math.round(count / 7));
  return Array.from({ length: 7 }, (_, index) => ({
    value: Math.max(1, base + ((index * 3) % 7) - 3),
  }));
}

function MetricCard({
  metric,
}: {
  metric: AdminFeedbackDashboardResponse["metrics"][number];
}) {
  const Icon = iconMap[metric.icon];
  const isPositive = metric.change > 0;
  const sparkline = buildSparkline(Number(metric.value.replace(/[^0-9]/g, "") || 0));

  return (
    <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <p className="text-sm text-gray-600 mb-1">{metric.title}</p>
          <h3 className="text-3xl font-semibold text-gray-900">{metric.value}</h3>
        </div>
        <div className={`${metric.iconBgColor} p-3 rounded-lg`}>
          <Icon className={`w-6 h-6 ${metric.iconColor}`} />
        </div>
      </div>
      {metric.change !== 0 ? (
        <div className="flex items-center gap-2 mb-2">
          {isPositive ? (
            <TrendingUp className="w-4 h-4 text-green-600" />
          ) : (
            <TrendingDown className="w-4 h-4 text-red-600" />
          )}
          <span
            className={`text-sm font-medium ${
              isPositive ? "text-green-600" : "text-red-600"
            }`}
          >
            {isPositive ? "+" : ""}
            {metric.change}%
          </span>
          <span className="text-sm text-gray-500">vs last period</span>
        </div>
      ) : (
        <div className="text-xs text-gray-400 mb-2">Historical trend pending</div>
      )}
      <ResponsiveContainer width="100%" height={48}>
        <LineChart data={sparkline}>
          <Line
            type="monotone"
            dataKey="value"
            stroke={isPositive ? "#10B981" : "#3B82F6"}
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function priorityBadgeClass(priority: string) {
  switch (priority) {
    case "Critical":
      return "bg-red-100 text-red-800";
    case "High":
      return "bg-orange-100 text-orange-800";
    case "Medium":
      return "bg-yellow-100 text-yellow-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

function statusBadgeClass(status: string) {
  switch (status) {
    case "Resolved":
      return "bg-green-100 text-green-800";
    case "Investigating":
      return "bg-purple-100 text-purple-800";
    case "Open":
      return "bg-blue-100 text-blue-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

export function FeedbackDashboard() {
  const { data, loading, error, refresh } =
    useAdminData<AdminFeedbackDashboardResponse>("/api/admin/feedback/dashboard");

  if (loading && !data) {
    return <PageLoader />;
  }

  const topCategoryCount = data?.categories[0]?.count || 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900">Feedback Dashboard</h2>
          <p className="text-sm text-gray-600 mt-1">
            Monitor user feedback and support metrics
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600">
            Last updated: {data?.generatedLabel ?? "Unavailable"}
          </div>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {data?.metrics.map((metric) => (
          <MetricCard key={metric.id} metric={metric} />
        ))}
      </div>

      <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Feedback</h3>
        {data?.recent.length ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">
                    ID
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">
                    User
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">
                    Category
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">
                    Priority
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">
                    Status
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">
                    Time
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((feedback) => (
                  <tr
                    key={feedback.id}
                    className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                  >
                    <td className="py-4 px-4 text-sm font-mono text-gray-600">
                      {feedback.displayId}
                    </td>
                    <td className="py-4 px-4 text-sm text-gray-900">
                      {feedback.email}
                    </td>
                    <td className="py-4 px-4">
                      <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        {feedback.category}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      <span
                        className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${priorityBadgeClass(
                          feedback.priority,
                        )}`}
                      >
                        {feedback.priority}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      <span
                        className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadgeClass(
                          feedback.status,
                        )}`}
                      >
                        {feedback.status}
                      </span>
                    </td>
                    <td className="py-4 px-4 text-sm text-gray-600">
                      {feedback.relativeSubmitted}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-gray-200 px-4 py-10 text-center text-sm text-gray-500">
            No recent feedback yet.
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Feedback by Category
          </h3>
          <div className="space-y-3">
            {data?.categories.length ? (
              data.categories.map((item) => (
                <div key={item.label}>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-gray-700">{item.label}</span>
                    <span className="text-sm font-medium text-gray-900">
                      {item.count}
                    </span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div
                      className="h-2 rounded-full"
                      style={{
                        width: `${Math.min(100, (item.count / topCategoryCount) * 100)}%`,
                        backgroundColor: item.color,
                      }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-500">No category data yet.</p>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Priority Distribution
          </h3>
          <div className="space-y-4">
            {data?.priorities.length ? (
              data.priorities.map((item) => (
                <div key={item.label}>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-gray-700">{item.label}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-600">{item.count}</span>
                      <span className="text-sm font-medium text-gray-900">
                        {item.percentage}%
                      </span>
                    </div>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div
                      className="h-2 rounded-full"
                      style={{
                        width: `${item.percentage}%`,
                        backgroundColor: item.color,
                      }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-500">No priority data yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
