"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, Search } from "lucide-react";

import { PageLoader } from "@/components/PageLoader";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type {
  AdminFeedbackDetailItem,
  AdminFeedbackItem,
  AdminFeedbackListResponse,
  UiFeedbackStatus,
} from "@/lib/admin-types";
import { useAdminData } from "@/lib/use-admin-data";

const statusOptions: UiFeedbackStatus[] = [
  "Open",
  "Investigating",
  "Resolved",
  "Closed",
];

export function FeedbackInbox() {
  const { data, loading, error, refresh } = useAdminData<AdminFeedbackListResponse>(
    "/api/admin/feedback",
  );
  const [items, setItems] = useState<AdminFeedbackItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All Categories");
  const [priorityFilter, setPriorityFilter] = useState("All Priorities");
  const [statusFilter, setStatusFilter] = useState("All Statuses");
  const [selectedFeedback, setSelectedFeedback] = useState<AdminFeedbackDetailItem | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    setItems(data?.items ?? []);
  }, [data]);

  const categories = useMemo(() => {
    const unique = new Set(items.map((item) => item.category));
    return ["All Categories", ...Array.from(unique)];
  }, [items]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const query = searchQuery.trim().toLowerCase();
      const matchesQuery =
        !query ||
        item.displayId.toLowerCase().includes(query) ||
        item.email.toLowerCase().includes(query) ||
        item.messagePreview.toLowerCase().includes(query);
      const matchesCategory =
        categoryFilter === "All Categories" || item.category === categoryFilter;
      const matchesPriority =
        priorityFilter === "All Priorities" || item.priority === priorityFilter;
      const matchesStatus =
        statusFilter === "All Statuses" || item.status === statusFilter;

      return matchesQuery && matchesCategory && matchesPriority && matchesStatus;
    });
  }, [categoryFilter, items, priorityFilter, searchQuery, statusFilter]);

  async function handleView(feedbackId: string) {
    setBusyId(feedbackId);

    try {
      const response = await fetch(`/api/admin/feedback/${encodeURIComponent(feedbackId)}`, {
        cache: "no-store",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.detail || "Failed to load feedback detail.");
      }

      setSelectedFeedback(payload as AdminFeedbackDetailItem);
      setIsDialogOpen(true);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to load feedback.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleStatusChange(feedbackId: string, status: UiFeedbackStatus) {
    setBusyId(feedbackId);

    try {
      const response = await fetch(`/api/admin/feedback/${encodeURIComponent(feedbackId)}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ status }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.detail || "Failed to update feedback.");
      }

      setItems((current) =>
        current.map((item) =>
          item.id === feedbackId
            ? {
                ...item,
                status: payload.status,
                backendStatus: payload.backendStatus,
              }
            : item,
        ),
      );

      if (selectedFeedback?.id === feedbackId) {
        setSelectedFeedback(payload as AdminFeedbackDetailItem);
      }
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to update feedback.");
    } finally {
      setBusyId(null);
    }
  }

  function handleExport() {
    const rows = [
      ["Feedback ID", "Email", "Category", "Priority", "Status", "Submitted", "Message"].join(","),
      ...filteredItems.map((item) =>
        [
          item.displayId,
          item.email,
          item.category,
          item.priority,
          item.status,
          item.submittedLabel,
          `"${item.messagePreview.replace(/"/g, '""')}"`,
        ].join(","),
      ),
    ];

    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "admin-feedback-export.csv";
    link.click();
    window.URL.revokeObjectURL(url);
  }

  if (loading && !data) {
    return <PageLoader />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900">Feedback Inbox</h2>
          <p className="mt-1 text-sm text-gray-600">
            Review, search, and update feedback with live backend data.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            <Download className="h-4 w-4" />
            Export
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
        {[
          { label: "Total", value: data?.counts.total ?? 0 },
          { label: "Open", value: data?.counts.open ?? 0 },
          { label: "Investigating", value: data?.counts.investigating ?? 0 },
          { label: "Resolved", value: data?.counts.resolved ?? 0 },
          { label: "Closed", value: data?.counts.closed ?? 0 },
        ].map((item) => (
          <div key={item.label} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-gray-600">{item.label}</p>
            <p className="mt-2 text-2xl font-semibold text-gray-900">{item.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search by feedback ID, email, or message..."
              className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-4 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {categories.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
          <select
            value={priorityFilter}
            onChange={(event) => setPriorityFilter(event.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {["All Priorities", "Critical", "High", "Medium", "Low"].map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {["All Statuses", ...statusOptions].map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px]">
            <thead className="bg-gray-50">
              <tr className="border-b border-gray-200 text-left text-sm text-gray-600">
                <th className="px-4 py-3 font-medium">Feedback</th>
                <th className="px-4 py-3 font-medium">Message</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Priority</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Submitted</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((feedback) => (
                <tr key={feedback.id} className="border-b border-gray-100 align-top">
                  <td className="px-4 py-4">
                    <p className="text-sm font-medium text-gray-900">{feedback.email}</p>
                    <p className="text-xs text-gray-500">{feedback.displayId}</p>
                  </td>
                  <td className="max-w-md px-4 py-4 text-sm text-gray-700">
                    {feedback.messagePreview}
                  </td>
                  <td className="px-4 py-4">
                    <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                      {feedback.category}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-700">
                      {feedback.priority}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <select
                      value={feedback.status}
                      disabled={busyId === feedback.id}
                      onChange={(event) =>
                        void handleStatusChange(
                          feedback.id,
                          event.target.value as UiFeedbackStatus,
                        )
                      }
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {statusOptions.map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-4 text-sm text-gray-500">
                    <div>{feedback.submittedLabel}</div>
                    <div className="text-xs">{feedback.relativeSubmitted}</div>
                  </td>
                  <td className="px-4 py-4">
                    <button
                      onClick={() => void handleView(feedback.id)}
                      disabled={busyId === feedback.id}
                      className="text-sm font-medium text-blue-600 transition-colors hover:text-blue-700 disabled:opacity-50"
                    >
                      {busyId === feedback.id ? "Loading..." : "View"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredItems.length === 0 ? (
          <div className="border-t border-gray-200 p-6 text-center text-sm text-gray-500">
            No feedback items matched the current filters.
          </div>
        ) : null}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Feedback Detail</DialogTitle>
          </DialogHeader>
          {selectedFeedback ? (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded-lg bg-gray-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Feedback</p>
                  <p className="mt-2 text-sm font-medium text-gray-900">
                    {selectedFeedback.displayId}
                  </p>
                </div>
                <div className="rounded-lg bg-gray-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Status</p>
                  <p className="mt-2 text-sm font-medium text-gray-900">
                    {selectedFeedback.status}
                  </p>
                </div>
                <div className="rounded-lg bg-gray-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Priority</p>
                  <p className="mt-2 text-sm font-medium text-gray-900">
                    {selectedFeedback.priority}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-500">Reporter</p>
                <p className="mt-2 text-sm font-medium text-gray-900">
                  {selectedFeedback.name} ({selectedFeedback.email})
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  Submitted {selectedFeedback.submittedLabel}
                </p>
              </div>

              <div className="rounded-xl border border-gray-200 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-500">Message</p>
                <p className="mt-3 whitespace-pre-wrap text-sm text-gray-800">
                  {selectedFeedback.message}
                </p>
              </div>

              <div className="rounded-xl border border-gray-200 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-500">Chat Context</p>
                <div className="mt-3 space-y-3">
                  {selectedFeedback.contextChat.length > 0 ? (
                    selectedFeedback.contextChat.map((message, index) => (
                      <div key={`${message.role}-${index}`} className="rounded-lg bg-gray-50 p-3">
                        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">
                          {message.role}
                        </div>
                        <p className="text-sm text-gray-800">{message.content}</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-gray-500">No chat context was stored for this feedback.</p>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-500">Page Snapshot</p>
                {selectedFeedback.contextPage ? (
                  <div className="mt-3 space-y-2 text-sm text-gray-800">
                    {typeof selectedFeedback.contextPage === "object" ? (
                      <>
                        {"url" in (selectedFeedback.contextPage as Record<string, unknown>) && (
                          <p>
                            <span className="font-medium">URL:</span>{" "}
                            {String((selectedFeedback.contextPage as Record<string, unknown>).url || "")}
                          </p>
                        )}
                        {"title" in (selectedFeedback.contextPage as Record<string, unknown>) && (
                          <p>
                            <span className="font-medium">Title:</span>{" "}
                            {String((selectedFeedback.contextPage as Record<string, unknown>).title || "")}
                          </p>
                        )}
                        {"capturedAt" in (selectedFeedback.contextPage as Record<string, unknown>) && (
                          <p>
                            <span className="font-medium">Captured:</span>{" "}
                            {String((selectedFeedback.contextPage as Record<string, unknown>).capturedAt || "")}
                          </p>
                        )}
                        {"contentSnippet" in (selectedFeedback.contextPage as Record<string, unknown>) && (
                          <div>
                            <p className="font-medium mb-1">Content Snippet</p>
                            <p className="whitespace-pre-wrap text-gray-700">
                              {String((selectedFeedback.contextPage as Record<string, unknown>).contentSnippet || "")}
                            </p>
                          </div>
                        )}
                      </>
                    ) : (
                      <p>{String(selectedFeedback.contextPage)}</p>
                    )}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-gray-500">No page snapshot stored for this feedback.</p>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
