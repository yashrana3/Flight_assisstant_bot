"use client";

import { Activity, AlertCircle, Clock, MessageSquare, RefreshCw } from "lucide-react";

import { PageLoader } from "@/components/PageLoader";
import type { AdminFeedbackLiveChatResponse } from "@/lib/admin-types";
import { useAdminData } from "@/lib/use-admin-data";

function metricTile(
  label: string,
  value: string,
  icon: typeof Activity,
  color: string,
) {
  const Icon = icon;
  return (
    <div
      key={label}
      className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-gray-600">{label}</span>
        <Icon className={`w-5 h-5 ${color}`} />
      </div>
      <div className="text-3xl font-semibold text-gray-900">{value}</div>
    </div>
  );
}

export function LiveChatMonitor() {
  const { data, loading, error, refresh } =
    useAdminData<AdminFeedbackLiveChatResponse>("/api/admin/feedback/live-chat", {
      refreshMs: 15000,
    });

  if (loading && !data) {
    return <PageLoader />;
  }

  const metrics = data?.metrics;
  const responseTime =
    metrics?.avgResponseSeconds != null && metrics.avgResponseSeconds > 0
      ? `${metrics.avgResponseSeconds.toFixed(1)}s`
      : "Not tracked";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900">Live Chat Monitor</h2>
          <p className="text-sm text-gray-600 mt-1">
            Monitor real-time AI conversations
          </p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-2 self-start rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {metricTile(
          "Active Conversations",
          String(metrics?.activeConversations ?? 0),
          Activity,
          "text-blue-600",
        )}
        {metricTile(
          "Messages / min",
          String(metrics?.messagesPerMinute ?? 0),
          MessageSquare,
          "text-green-600",
        )}
        {metricTile("Avg Response Time", responseTime, Clock, "text-purple-600")}
        {metricTile(
          "Failed Responses",
          String(metrics?.failedResponses ?? 0),
          AlertCircle,
          "text-red-600",
        )}
      </div>

      {metrics?.avgResponseSeconds == null ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Response latency is not tracked yet — add a `latency_ms` column to
          `chat_messages` and the backend will surface it here automatically.
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {(data?.chats ?? []).map((chat) => {
          const initials = chat.userLabel
            .split(" ")
            .map((part) => part.charAt(0))
            .join("")
            .slice(0, 2)
            .toUpperCase();
          return (
            <div
              key={chat.id}
              className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                    <span className="text-blue-600 font-medium">{initials || "U"}</span>
                  </div>
                  <div>
                    <div className="font-medium text-gray-900">{chat.userLabel}</div>
                    <div className="text-xs text-gray-500">
                      {chat.status} • {chat.lastUpdatedLabel}
                    </div>
                  </div>
                </div>
                <span
                  className={`px-2 py-1 text-xs font-medium rounded ${
                    chat.status === "Active"
                      ? "bg-green-100 text-green-800"
                      : "bg-gray-100 text-gray-700"
                  }`}
                >
                  {chat.status}
                </span>
              </div>

              <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                {chat.messages.length ? (
                  chat.messages.slice(-4).map((message) => {
                    const isAssistant = message.role === "assistant";
                    return (
                      <div
                        key={message.id}
                        className={`flex gap-2 ${isAssistant ? "justify-end" : ""}`}
                      >
                        <div
                          className={`rounded-lg p-3 max-w-[80%] ${
                            isAssistant
                              ? "bg-blue-500 text-white"
                              : "bg-gray-100 text-gray-900"
                          }`}
                        >
                          <p className="text-sm leading-relaxed">{message.content}</p>
                          <span
                            className={`text-xs ${
                              isAssistant ? "opacity-75" : "text-gray-500"
                            }`}
                          >
                            {message.timeLabel}
                          </span>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-gray-500">No messages captured yet.</p>
                )}
              </div>

              <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
                <span>{chat.messageCount} total messages</span>
                <span>{chat.displayId}</span>
              </div>
            </div>
          );
        })}
        {(data?.chats.length ?? 0) === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-500">
            No live conversations right now.
          </div>
        ) : null}
      </div>
    </div>
  );
}
