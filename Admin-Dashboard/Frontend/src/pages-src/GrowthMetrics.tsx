"use client";

import { RefreshCw } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PageLoader } from "@/components/PageLoader";
import type { AdminGrowthPageResponse } from "@/lib/admin-types";
import { useAdminData } from "@/lib/use-admin-data";

const toneMap = {
  blue: "bg-blue-50 text-blue-700",
  purple: "bg-purple-50 text-purple-700",
  green: "bg-emerald-50 text-emerald-700",
  orange: "bg-orange-50 text-orange-700",
  red: "bg-red-50 text-red-700",
};

export function GrowthMetrics() {
  const { data, loading, error, refresh } = useAdminData<AdminGrowthPageResponse>(
    "/api/admin/growth",
  );

  if (loading && !data) {
    return <PageLoader />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Growth Metrics</h1>
          <p className="mt-1 text-sm text-gray-600">
            Live acquisition and activity trends from users, conversations, searches, and redirects.
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data?.metrics.map((metric) => (
          <div key={metric.id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm text-gray-600">{metric.label}</p>
                <p className="mt-2 text-3xl font-semibold text-gray-900">{metric.value}</p>
                <p className="mt-2 text-sm text-gray-500">{metric.description}</p>
              </div>
              <div className={`rounded-xl p-3 ${toneMap[metric.tone]}`}>
                <RefreshCw className="h-5 w-5" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Growth Trend</h2>
          <p className="text-sm text-gray-600">
            Daily user growth overlaid with sessions, searches, and redirect events.
          </p>
        </div>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data?.growthTrend ?? []}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="users" fill="#93c5fd" radius={[8, 8, 0, 0]} />
              <Line type="monotone" dataKey="sessions" stroke="#2563eb" strokeWidth={3} />
              <Line type="monotone" dataKey="searches" stroke="#10b981" strokeWidth={3} />
              <Line type="monotone" dataKey="redirects" stroke="#f59e0b" strokeWidth={3} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Acquisition Breakdown</h2>
            <p className="text-sm text-gray-600">
              Current user distribution by nationality values stored in the user profile records.
            </p>
          </div>
          <div className="space-y-4">
            {data?.acquisitionBreakdown.map((item) => {
              const maxCount = Math.max(
                ...(data.acquisitionBreakdown.map((entry) => entry.count) ?? []),
                1,
              );
              return (
                <div key={item.label}>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-medium text-gray-700">{item.label}</span>
                    <span className="text-gray-500">{item.count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100">
                    <div
                      className="h-2 rounded-full bg-blue-600"
                      style={{ width: `${Math.max((item.count / maxCount) * 100, 6)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Funnel Snapshot</h2>
            <p className="text-sm text-gray-600">
              Current volume at each major step from registration to redirect.
            </p>
          </div>
          <div className="space-y-4">
            {data?.funnelStages.map((stage) => (
              <div key={stage.label} className="rounded-xl border border-gray-100 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-900">{stage.label}</p>
                  <span className="text-sm text-gray-500">{stage.count}</span>
                </div>
                <div className="h-2 rounded-full bg-gray-100">
                  <div
                    className="h-2 rounded-full bg-emerald-500"
                    style={{ width: `${Math.max(stage.percentage, 6)}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-gray-500">{stage.percentage}% of registered users</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Top Routes</h2>
          </div>
          <div className="space-y-3">
            {data?.topRoutes.map((item) => (
              <div key={item.label} className="rounded-xl border border-gray-100 p-4">
                <p className="text-sm font-medium text-gray-900">{item.label}</p>
                <p className="mt-1 text-xs text-gray-500">{item.count} saved trips</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Top Prompts</h2>
          </div>
          <div className="space-y-3">
            {data?.topPrompts.map((item) => (
              <div key={item.label} className="rounded-xl border border-gray-100 p-4">
                <p className="text-sm font-medium text-gray-900">{item.label}</p>
                <p className="mt-1 text-xs text-gray-500">{item.count} user prompts</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
