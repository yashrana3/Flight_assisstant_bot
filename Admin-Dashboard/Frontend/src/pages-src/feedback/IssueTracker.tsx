"use client";

import { RefreshCw } from "lucide-react";

import { PageLoader } from "@/components/PageLoader";
import type { AdminFeedbackIssueTrackerResponse } from "@/lib/admin-types";
import { useAdminData } from "@/lib/use-admin-data";

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

export function IssueTracker() {
  const { data, loading, error, refresh } =
    useAdminData<AdminFeedbackIssueTrackerResponse>("/api/admin/feedback/issues");

  if (loading && !data) return <PageLoader />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900">Issue Tracker</h2>
          <p className="text-sm text-gray-600 mt-1">
            Track and manage feedback issues
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

      <div className="flex gap-4 overflow-x-auto pb-4">
        {(data?.columns ?? []).map((column) => (
          <div key={column.name} className="flex-shrink-0 w-80">
            <div className={`${column.color} rounded-lg p-3 mb-3`}>
              <h3 className="font-semibold text-gray-900 flex items-center justify-between">
                {column.name}
                <span className="text-sm bg-white px-2 py-0.5 rounded">
                  {column.issues.length}
                </span>
              </h3>
            </div>
            <div className="space-y-3">
              {column.issues.map((issue) => (
                <div
                  key={issue.id}
                  className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                >
                  <div className="flex items-start justify-between mb-2">
                    <span className="text-xs font-mono text-gray-500">
                      {issue.displayId}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${priorityBadgeClass(
                        issue.priority,
                      )}`}
                    >
                      {issue.priority}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-gray-900 mb-2 line-clamp-3">
                    {issue.summary}
                  </p>
                  <div className="flex items-center justify-between text-xs text-gray-600 gap-2">
                    <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded truncate">
                      {issue.category}
                    </span>
                    <span className="truncate">{issue.assigned}</span>
                  </div>
                </div>
              ))}
              {column.issues.length === 0 && (
                <div className="text-center py-8 text-gray-400 text-sm">
                  No issues
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
