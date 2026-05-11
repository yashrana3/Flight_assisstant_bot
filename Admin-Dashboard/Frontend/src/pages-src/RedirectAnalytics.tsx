"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  Calendar,
  ExternalLink,
  MessageSquare,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PageLoader } from "@/components/PageLoader";
import type { AdminFunnelPageV2Response } from "@/lib/admin-types";
import { useAdminData } from "@/lib/use-admin-data";

const PIE_COLORS = ["#8B5CF6", "#3B82F6", "#10B981", "#F59E0B", "#EC4899", "#6B7280"];

export function RedirectAnalytics() {
  const [dateRange, setDateRange] = useState("7d");
  const { data, loading, error } = useAdminData<AdminFunnelPageV2Response>(
    `/api/admin/funnel?range=${dateRange}`,
  );

  const redirectStage = data?.stages.find((stage) => stage.id === "redirects") ?? data?.stages.at(-1);
  const avgConversion =
    data?.conversionTrend.length
      ? Math.round(
          data.conversionTrend.reduce((sum, point) => sum + point.conversion, 0) /
            data.conversionTrend.length,
        )
      : 0;
  const avgSearchRate =
    data?.conversionTrend.length
      ? Math.round(
          data.conversionTrend.reduce((sum, point) => sum + point.searchRate, 0) /
            data.conversionTrend.length,
        )
      : 0;
  const avgAiEngagement =
    data?.conversionTrend.length
      ? Math.round(
          data.conversionTrend.reduce((sum, point) => sum + point.aiEngagement, 0) /
            data.conversionTrend.length,
        )
      : 0;
  const topDrop = data?.dropOffPoints[0];
  const maxRouteCount = useMemo(
    () => Math.max(...(data?.topRoutes.map((item) => item.count) ?? [1]), 1),
    [data],
  );

  if (loading && !data) return <PageLoader />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Redirect Analytics</h1>
          <p className="mt-1 text-sm text-gray-600">
            Live redirect performance from funnel stages, path analysis, and route-level conversion
            signals.
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

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Calendar className="h-4 w-4" />
            <span>Range</span>
            <select
              value={dateRange}
              onChange={(event) => setDateRange(event.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700"
            >
              <option value="7d">Last 7 days</option>
              <option value="15d">Last 15 days</option>
              <option value="30d">Last 30 days</option>
            </select>
          </div>
          {/* Country/device filters disabled: redirect view has no direct
              country/device-attributed redirect metrics in current payload. */}
          {/* <div className="ml-auto rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Average flight price and browser/device redirect cuts are not available in the current
            data model.
          </div> */}
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-600">Total Redirects</p>
          <p className="mt-2 text-3xl font-semibold text-gray-900">
            {(redirectStage?.count ?? 0).toLocaleString()}
          </p>
          <p className="mt-2 text-sm text-gray-500">Current redirect stage volume in the funnel</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-600">Conversion Rate</p>
          <p className="mt-2 text-3xl font-semibold text-gray-900">{avgConversion}%</p>
          <p className="mt-2 text-sm text-gray-500">Average redirect conversion across the 7-day trend</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-600">Search Rate</p>
          <p className="mt-2 text-3xl font-semibold text-gray-900">{avgSearchRate}%</p>
          <p className="mt-2 text-sm text-gray-500">How often conversations reach a search step</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-600">AI Engagement</p>
          <p className="mt-2 text-3xl font-semibold text-gray-900">{avgAiEngagement}%</p>
          <p className="mt-2 text-sm text-gray-500">Authenticated-session engagement proxy from funnel data</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-600">Avg Time To Redirect</p>
          <p className="mt-2 text-3xl font-semibold text-gray-900">{redirectStage?.avgTime ?? "—"}</p>
          <p className="mt-2 text-sm text-gray-500">Stage timing estimate from conversation progression</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-600">Largest Drop-off</p>
          <p className="mt-2 text-3xl font-semibold text-gray-900">{topDrop?.dropOff ?? 0}%</p>
          <p className="mt-2 text-sm text-gray-500">{topDrop?.stage ?? "No drop-off data"}</p>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Search to Redirect Performance</h2>
        <p className="mt-1 text-sm text-gray-600">
          Hourly funnel load showing search activity against redirect completions.
        </p>
        <div className="mt-6 h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data?.timeMetrics ?? []}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="time" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="search" fill="#3B82F6" radius={[6, 6, 0, 0]} name="Searches" />
              <Line
                type="monotone"
                dataKey="redirect"
                stroke="#F59E0B"
                strokeWidth={3}
                dot={{ r: 4 }}
                name="Redirects"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Redirect Trigger Analysis</h2>
          <p className="mt-1 text-sm text-gray-600">
            Top observed navigation paths leading users toward redirects.
          </p>
          <div className="mt-6 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data?.pathAnalysis ?? []}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={95}
                  paddingAngle={3}
                  dataKey="count"
                  nameKey="path"
                  label={({ percent }: { percent?: number }) =>
                    `${Math.round((percent ?? 0) * 100)}%`
                  }
                >
                  {(data?.pathAnalysis ?? []).map((entry, index) => (
                    <Cell key={entry.path} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Trigger Insights</h2>
          <div className="mt-6 space-y-4">
            {(data?.pathAnalysis ?? []).slice(0, 3).map((item, index) => (
              <div key={item.path} className="rounded-lg border border-gray-200 p-4">
                <div className="flex items-start gap-3">
                  {index === 0 ? (
                    <MessageSquare className="mt-0.5 h-5 w-5 text-purple-600" />
                  ) : index === 1 ? (
                    <ArrowUpRight className="mt-0.5 h-5 w-5 text-blue-600" />
                  ) : (
                    <ExternalLink className="mt-0.5 h-5 w-5 text-emerald-600" />
                  )}
                  <div>
                    <p className="text-sm font-medium text-gray-900">{item.path}</p>
                    <p className="mt-1 text-xs text-gray-600">
                      {item.count.toLocaleString()} observed flows, {item.percentage}% of tracked paths.
                    </p>
                  </div>
                </div>
              </div>
            ))}
            <div className="rounded-lg border border-amber-100 bg-amber-50 p-4 text-xs text-amber-800">
              Trigger categories in the original Figma file were replaced with real path-analysis
              data from the funnel builder.
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Route-Based Redirect Analytics</h2>
        <p className="mt-1 text-sm text-gray-600">
          Top saved-trip routes that currently contribute the most redirect volume.
        </p>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-sm text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">Route</th>
                <th className="px-4 py-3 font-medium">Redirect volume</th>
                <th className="px-4 py-3 font-medium">Relative share</th>
                <th className="px-4 py-3 font-medium">Trend</th>
              </tr>
            </thead>
            <tbody>
              {(data?.topRoutes ?? []).slice(0, 8).map((route) => (
                <tr key={route.label} className="border-b border-gray-100">
                  <td className="px-4 py-4 text-sm font-medium text-gray-900">{route.label}</td>
                  <td className="px-4 py-4 text-sm text-gray-700">{route.count.toLocaleString()}</td>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-3">
                      <div className="h-2 w-32 rounded-full bg-gray-100">
                        <div
                          className="h-2 rounded-full bg-blue-600"
                          style={{ width: `${Math.max((route.count / maxRouteCount) * 100, 8)}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500">
                        {Math.round((route.count / maxRouteCount) * 100)}%
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-sm">
                    <span className="inline-flex items-center gap-1 text-emerald-600">
                      <TrendingUp className="h-4 w-4" />
                      High volume
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Redirect Funnel Stages</h2>
          <p className="mt-1 text-sm text-gray-600">
            Real counts across the major redirect journey stages.
          </p>
          <div className="mt-6 space-y-4">
            {data?.stages.map((stage) => (
              <div key={stage.id}>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-900">{stage.name}</span>
                  <span className="text-gray-500">
                    {stage.count.toLocaleString()} ({stage.percentage}%)
                  </span>
                </div>
                <div className="h-2 rounded-full bg-gray-100">
                  <div
                    className="h-2 rounded-full"
                    style={{ width: `${Math.max(stage.percentage, 6)}%`, backgroundColor: stage.color }}
                  />
                </div>
                <p className="mt-2 text-xs text-gray-500">Avg stage time: {stage.avgTime}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Drop-off Analysis</h2>
          <div className="mt-6 space-y-4">
            {data?.dropOffPoints.map((item) => (
              <div key={item.stage} className="rounded-lg border border-gray-200 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{item.stage}</p>
                    <p className="mt-1 text-xs text-gray-600">{item.reason}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-red-600">
                    <TrendingDown className="h-4 w-4" />
                    {item.dropOff}%
                  </span>
                </div>
                <p className="mt-2 text-xs text-gray-500">{item.count.toLocaleString()} dropped users/events</p>
              </div>
            ))}
            {!data?.dropOffPoints.length ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
                No drop-off data available yet.
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-amber-600" />
          <h2 className="text-lg font-semibold text-gray-900">Telemetry Gaps</h2>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p className="text-sm font-medium text-gray-900">Avg Flight Price</p>
            <p className="mt-1 text-sm text-gray-600">
              Not tracked consistently enough to surface on redirect analytics.
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p className="text-sm font-medium text-gray-900">Browser / Device Split</p>
            <p className="mt-1 text-sm text-gray-600">
              Current user and chat databases do not store device telemetry.
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p className="text-sm font-medium text-gray-900">Booking Partner Types</p>
            <p className="mt-1 text-sm text-gray-600">
              Redirect destination categories are not persisted separately from redirect events.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
