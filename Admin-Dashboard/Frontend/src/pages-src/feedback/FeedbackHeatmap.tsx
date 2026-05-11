"use client";

import { Flame, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";

import { PageLoader } from "@/components/PageLoader";
import type { AdminFeedbackHeatmapResponse } from "@/lib/admin-types";
import { useAdminData } from "@/lib/use-admin-data";

export function FeedbackHeatmap() {
  const { data, loading, error, refresh } =
    useAdminData<AdminFeedbackHeatmapResponse>("/api/admin/feedback/heatmap");

  if (loading && !data) return <PageLoader />;

  const rows = data?.rows ?? [];
  const hottest = data?.summary.hottest ?? null;
  const trendingUp = data?.summary.trendingUp ?? null;
  const improving = data?.summary.improving ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900">Feedback Heatmap</h2>
          <p className="text-sm text-gray-600 mt-1">
            Identify which platform sections receive the most feedback
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <Flame className="w-5 h-5 text-red-600" />
            <span className="text-sm text-gray-600">Hottest Section</span>
          </div>
          <div className="text-2xl font-semibold text-gray-900">
            {hottest?.area ?? "—"}
          </div>
          <p className="text-sm text-gray-600 mt-1">
            {hottest
              ? `${hottest.count} feedback items (${hottest.percentage}%)`
              : "Not enough data yet"}
          </p>
        </div>

        <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-5 h-5 text-green-600" />
            <span className="text-sm text-gray-600">Trending Up</span>
          </div>
          <div className="text-2xl font-semibold text-gray-900">
            {trendingUp?.area ?? "—"}
          </div>
          <p className="text-sm text-green-600 mt-1">
            {trendingUp ? `+${trendingUp.trend}% this week` : "No trending section yet"}
          </p>
        </div>

        <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <TrendingDown className="w-5 h-5 text-blue-600" />
            <span className="text-sm text-gray-600">Improving</span>
          </div>
          <div className="text-2xl font-semibold text-gray-900">
            {improving?.area ?? "—"}
          </div>
          <p className="text-sm text-blue-600 mt-1">
            {improving
              ? `${improving.trend > 0 ? "+" : ""}${improving.trend}% this week`
              : "Not enough data yet"}
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-6">
          Platform Section Heatmap
        </h3>
        {rows.length ? (
          <div className="space-y-4">
            {rows.map((item, idx) => (
              <div key={`${item.area}-${idx}`} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-gray-900 w-32 truncate">
                      {item.area}
                    </span>
                    <div className="flex items-center gap-2">
                      {item.trend >= 0 ? (
                        <TrendingUp className="w-4 h-4 text-green-600" />
                      ) : (
                        <TrendingDown className="w-4 h-4 text-red-600" />
                      )}
                      <span
                        className={`text-sm font-medium ${
                          item.trend >= 0 ? "text-green-600" : "text-red-600"
                        }`}
                      >
                        {item.trend > 0 ? "+" : ""}
                        {item.trend}%
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-gray-600">
                      {item.feedback} feedback
                    </span>
                    <span className="text-sm font-medium text-gray-900 w-16 text-right">
                      {item.percentage}%
                    </span>
                  </div>
                </div>
                <div className="relative h-12 bg-gray-100 rounded-lg overflow-hidden">
                  <div
                    className={`h-full bg-gradient-to-r ${item.color} flex items-center px-4 text-white font-medium transition-all duration-500`}
                    style={{ width: `${Math.max(item.percentage, 3)}%` }}
                  >
                    {item.percentage >= 15 ? item.area : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No section data available yet.</p>
        )}
      </div>

      <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Section Feedback Details
        </h3>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">
                    Section
                  </th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">
                    Total Feedback
                  </th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">
                    Positive
                  </th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">
                    Neutral
                  </th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">
                    Negative
                  </th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">
                    Trend
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item, idx) => (
                  <tr
                    key={`${item.area}-row-${idx}`}
                    className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                  >
                    <td className="py-4 px-4 text-sm font-medium text-gray-900">
                      {item.area}
                    </td>
                    <td className="py-4 px-4 text-sm text-gray-900 text-right">
                      {item.feedback}
                    </td>
                    <td className="py-4 px-4 text-sm text-green-600 text-right">
                      {item.positive}
                    </td>
                    <td className="py-4 px-4 text-sm text-yellow-600 text-right">
                      {item.neutral}
                    </td>
                    <td className="py-4 px-4 text-sm text-red-600 text-right">
                      {item.negative}
                    </td>
                    <td className="py-4 px-4 text-right">
                      <span
                        className={`inline-flex items-center gap-1 text-sm font-medium ${
                          item.trend >= 0 ? "text-green-600" : "text-red-600"
                        }`}
                      >
                        {item.trend >= 0 ? (
                          <TrendingUp className="w-4 h-4" />
                        ) : (
                          <TrendingDown className="w-4 h-4" />
                        )}
                        {item.trend > 0 ? "+" : ""}
                        {item.trend}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-500">No detail rows available yet.</p>
        )}
      </div>
    </div>
  );
}
