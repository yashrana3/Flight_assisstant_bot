"use client";

import { AlertCircle, CheckCircle, HelpCircle, RefreshCw, XCircle } from "lucide-react";

import { PageLoader } from "@/components/PageLoader";
import type { AdminFeedbackAIInsightsResponse } from "@/lib/admin-types";
import { useAdminData } from "@/lib/use-admin-data";

function severityBadgeClass(severity: "critical" | "high" | "medium" | "low") {
  switch (severity) {
    case "critical":
      return "bg-red-100 text-red-800";
    case "high":
      return "bg-orange-100 text-orange-800";
    case "medium":
      return "bg-yellow-100 text-yellow-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

function deltaLabel(delta: number) {
  if (delta === 0) return "No historical baseline yet";
  const prefix = delta > 0 ? "+" : "";
  return `${prefix}${delta}% vs previous period`;
}

export function AIFeedbackInsights() {
  const { data, loading, error, refresh } =
    useAdminData<AdminFeedbackAIInsightsResponse>("/api/admin/feedback/ai-insights");

  if (loading && !data) return <PageLoader />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900">AI Feedback Insights</h2>
          <p className="text-sm text-gray-600 mt-1">
            Analyze AI performance based on user feedback
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600">AI Answer Accuracy</span>
            <CheckCircle className="w-5 h-5 text-green-600" />
          </div>
          <div className="text-3xl font-semibold text-gray-900">
            {data?.metrics.accuracy.value ?? 0}%
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {deltaLabel(data?.metrics.accuracy.delta ?? 0)}
          </p>
        </div>

        <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600">Confusing Responses</span>
            <HelpCircle className="w-5 h-5 text-yellow-600" />
          </div>
          <div className="text-3xl font-semibold text-gray-900">
            {data?.metrics.confusing.count ?? 0}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {deltaLabel(data?.metrics.confusing.delta ?? 0)}
          </p>
        </div>

        <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600">Missing Information</span>
            <AlertCircle className="w-5 h-5 text-orange-600" />
          </div>
          <div className="text-3xl font-semibold text-gray-900">
            {data?.metrics.missing.count ?? 0}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {deltaLabel(data?.metrics.missing.delta ?? 0)}
          </p>
        </div>

        <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600">AI Error Reports</span>
            <XCircle className="w-5 h-5 text-red-600" />
          </div>
          <div className="text-3xl font-semibold text-gray-900">
            {data?.metrics.errors.count ?? 0}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {deltaLabel(data?.metrics.errors.delta ?? 0)}
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Most Reported AI Issues
        </h3>
        {data?.topIssues.length ? (
          <div className="space-y-3">
            {data.topIssues.map((item, idx) => (
              <div
                key={`${item.issue}-${idx}`}
                className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">{item.issue}</p>
                    <p className="text-sm text-gray-600 mt-1">
                      {item.count} {item.count === 1 ? "report" : "reports"}
                    </p>
                  </div>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${severityBadgeClass(
                      item.severity,
                    )}`}
                  >
                    {item.severity}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-gray-200 px-4 py-10 text-center text-sm text-gray-500">
            No AI-tagged feedback yet.
          </div>
        )}
      </div>
    </div>
  );
}
