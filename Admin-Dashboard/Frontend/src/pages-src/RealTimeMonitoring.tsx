"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  Brain,
  Calendar,
  Clock,
  Download,
  ExternalLink,
  Flag,
  Filter,
  MapPin,
  MessageSquare,
  Play,
  Pause,
  RefreshCw,
  Search,
  Send,
  Tag,
  TrendingUp,
  User,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PageLoader } from "@/components/PageLoader";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AdminConversationCard, AdminRealtimeResponse } from "@/lib/admin-types";
import { useAdminData } from "@/lib/use-admin-data";
import { Badge } from "@/components/ui/badge";

const PALETTE = {
  blue: "#3B82F6",
  purple: "#8B5CF6",
  green: "#10B981",
  orange: "#F59E0B",
} as const;

function Metric({
  label,
  value,
  description,
  icon: Icon,
  tone = "blue",
}: {
  label: string;
  value: string | number;
  description: string;
  icon: typeof Activity;
  tone?: keyof typeof PALETTE;
}) {
  const toneStyles: Record<keyof typeof PALETTE, string> = {
    blue: "border-blue-100 bg-blue-50 text-blue-700",
    purple: "border-purple-100 bg-purple-50 text-purple-700",
    green: "border-emerald-100 bg-emerald-50 text-emerald-700",
    orange: "border-orange-100 bg-orange-50 text-orange-700",
  };
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-gray-600">{label}</p>
          <p className="mt-2 text-3xl font-semibold text-gray-900">{value}</p>
          <p className="mt-2 text-sm text-gray-500">{description}</p>
        </div>
        <div className={`rounded-xl border p-3 ${toneStyles[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

export function RealTimeMonitoring() {
  const [isAutoRefresh, setIsAutoRefresh] = useState(true);
  const [selectedCountry] = useState("all");
  const [selectedDevice] = useState("all");
  const [chatSearch, setChatSearch] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [activeTab, setActiveTab] = useState<"conversation" | "insights" | "journey" | "logs">(
    "conversation",
  );
  const { data, loading, error } = useAdminData<AdminRealtimeResponse>(
    "/api/admin/realtime",
    { refreshMs: isAutoRefresh ? 15000 : undefined },
  );
  const [selectedChat, setSelectedChat] = useState<AdminConversationCard | null>(null);

  const now = new Date();
  const formattedDate = now.toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const formattedTime = now.toLocaleTimeString();

  const countryActivity = useMemo(() => {
    const byCountry = new Map<string, number>();
    for (const chat of data?.activeChats ?? []) {
      const text = chat.userLabel;
      const suffix = text.includes(",") ? text.split(",").pop()?.trim() : "Unknown";
      const key = suffix && suffix.length > 0 ? suffix : "Unknown";
      byCountry.set(key, (byCountry.get(key) ?? 0) + 1);
    }
    return Array.from(byCountry.entries())
      .map(([country, users]) => ({ country, users }))
      .sort((a, b) => b.users - a.users)
      .slice(0, 6);
  }, [data?.activeChats]);

  const pageActivity = useMemo(() => {
    const rows = data?.activityFeed ?? [];
    const counts = {
      "AI Chat": rows.filter((x) => x.action.toLowerCase().includes("ai")).length,
      "Search": rows.filter((x) => x.action.toLowerCase().includes("search")).length,
      Redirect: rows.filter((x) => x.action.toLowerCase().includes("redirect")).length,
      Other: rows.filter(
        (x) =>
          !x.action.toLowerCase().includes("ai") &&
          !x.action.toLowerCase().includes("search") &&
          !x.action.toLowerCase().includes("redirect"),
      ).length,
    };
    return [
      { name: "AI Chat", users: counts["AI Chat"], fill: "#8B5CF6" },
      { name: "Search", users: counts["Search"], fill: "#3B82F6" },
      { name: "Redirect", users: counts.Redirect, fill: "#10B981" },
      { name: "Other", users: counts.Other, fill: "#F59E0B" },
    ];
  }, [data?.activityFeed]);

  const deviceData = useMemo(
    () => [
      { name: "Unknown", value: Math.max(data?.metrics.activeSessions ?? 0, 1), fill: "#6B7280" },
    ],
    [data?.metrics.activeSessions],
  );

  const filteredChats = useMemo(() => {
    const q = chatSearch.trim().toLowerCase();
    if (!q) return data?.activeChats ?? [];
    return (data?.activeChats ?? []).filter((chat) =>
      `${chat.userLabel} ${chat.lastMessagePreview} ${chat.displayId}`.toLowerCase().includes(q),
    );
  }, [chatSearch, data?.activeChats]);

  if (loading && !data) {
    return <PageLoader />;
  }

  return (
    <div className="space-y-6 bg-gradient-to-b from-slate-50 via-white to-slate-50 p-3">
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-600" />
              </span>
              LIVE
            </div>
            <button
              onClick={() => setIsAutoRefresh((v) => !v)}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                isAutoRefresh
                  ? "border-blue-200 bg-blue-50 text-blue-700"
                  : "border-gray-200 bg-gray-50 text-gray-700"
              }`}
            >
              {isAutoRefresh ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              Auto Refresh {isAutoRefresh ? "On" : "Off"}
            </button>
            <div className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
              <Calendar className="h-4 w-4 text-gray-500" />
              {formattedDate}
              <Clock className="ml-2 h-4 w-4 text-gray-500" />
              {formattedTime}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
              <Filter className="h-3.5 w-3.5" />
              Country: {selectedCountry}
            </div>
            <div className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
              <Filter className="h-3.5 w-3.5" />
              Device: {selectedDevice}
            </div>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>
        </div>
        <div className="mt-3 text-xs text-gray-500">Last updated: {data?.generatedLabel ?? "—"}</div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-2xl font-semibold text-gray-900">Real-Time Monitoring</h2>
        <p className="mt-1 text-sm text-gray-600">
          Live website chat/session activity rendered from admin realtime APIs.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
        <Metric
          label="Active Sessions"
          value={data?.metrics.activeSessions ?? 0}
          description="Updated in the last 10 minutes"
          icon={Activity}
          tone="blue"
        />
        <Metric
          label="Live AI Chats"
          value={data?.metrics.activeChats ?? 0}
          description="Conversations currently loaded from realtime feed"
          icon={MessageSquare}
          tone="purple"
        />
        <Metric
          label="Messages Last Hour"
          value={data?.metrics.messagesLastHour ?? 0}
          description="Messages recorded in latest one-hour window"
          icon={MessageSquare}
          tone="green"
        />
        <Metric
          label="Avg Messages / Conversation"
          value={data?.metrics.avgMessagesPerConversation ?? 0}
          description="Average across the active chat sample"
          icon={MessageSquare}
          tone="orange"
        />
        <Metric
          label="Loaded Sessions"
          value={data?.metrics.loadedSessions ?? 0}
          description="Recent sessions currently visible to the dashboard"
          icon={Users}
          tone="blue"
        />
        <Metric
          label="Authenticated Users"
          value={data?.metrics.authenticatedUsers ?? 0}
          description="Sessions currently tied to a backend user id"
          icon={User}
          tone="purple"
        />
        {/* <Metric
          label="Guest Sessions"
          value={data?.metrics.guestSessions ?? 0}
          description="Anonymous session traffic in the current sample"
          icon={Users}
        /> */}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Conversation Volume</h3>
            <p className="text-sm text-gray-600">
              Message counts from recently updated sessions.
            </p>
          </div>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.sessionChart ?? []}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip />
                <Bar dataKey="messages" fill={PALETTE.blue} radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Live Activity Feed</h3>
            <p className="text-sm text-gray-600">
              Derived from the newest sessions available to the admin API.
            </p>
          </div>
          <div className="space-y-3">
            {data?.activityFeed.map((event) => (
              <div
                key={event.id}
                className="rounded-xl border border-gray-100 p-4 transition-colors hover:bg-gray-50"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-gray-900">{event.action}</p>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      event.status === "Active"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {event.status}
                  </span>
                </div>
                <p className="mt-2 text-sm text-gray-600">{event.userLabel}</p>
                <p className="mt-1 text-xs text-gray-500">{event.relativeTime}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm xl:col-span-2">
          <h3 className="mb-4 text-lg font-semibold text-gray-900">Live Visitor Distribution</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {countryActivity.map((row) => (
              <div key={row.country} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-blue-600" />
                    <span className="text-sm font-medium text-gray-900">{row.country}</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-900">{row.users}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-gray-900">Current Page Activity</h3>
          <div className="space-y-3">
            {pageActivity.map((p) => {
              const total = Math.max(pageActivity.reduce((s, x) => s + x.users, 0), 1);
              const pct = Math.round((p.users / total) * 100);
              return (
                <div key={p.name}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="text-gray-700">{p.name}</span>
                    <span className="font-semibold text-gray-900">{p.users}</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-gray-100">
                    <div className="h-2 rounded-full" style={{ width: `${pct}%`, backgroundColor: p.fill }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Live Chat Monitor</h3>
          <p className="text-sm text-gray-600">
            Click any card to inspect the latest message history.
          </p>
        </div>
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800">
            Active chats: {data?.activeChats.length ?? 0}
          </div>
          <div className="rounded-lg border border-purple-100 bg-purple-50 px-3 py-2 text-sm text-purple-800">
            Avg response: {data?.systemHealth.apiLatencyMs ? `${data.systemHealth.apiLatencyMs}ms` : "N/A"}
          </div>
          <div className="relative ml-auto w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={chatSearch}
              onChange={(e) => setChatSearch(e.target.value)}
              placeholder="Search active chats..."
              className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {filteredChats.map((chat) => (
            <button
              key={chat.id}
              onClick={() => setSelectedChat(chat)}
              className="rounded-xl border border-gray-200 p-5 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/30"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">{chat.userLabel}</p>
                  <p className="text-xs text-gray-500">{chat.displayId}</p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    chat.status === "Active"
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-gray-100 text-gray-700"
                  }`}
                >
                  {chat.status}
                </span>
              </div>
              <p className="mt-4 text-sm text-gray-700">{chat.lastMessagePreview}</p>
              <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
                <span>{chat.messageCount} messages</span>
                <span>{chat.lastUpdatedLabel}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <Dialog open={Boolean(selectedChat)} onOpenChange={(open) => !open && setSelectedChat(null)}>
        <DialogContent className="!h-[98dvh] !w-[99vw] !max-w-[99vw] overflow-hidden border border-gray-200 p-0 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="sr-only">Conversation Detail</DialogTitle>
          </DialogHeader>
          {selectedChat ? (
            <div className="flex h flex-1 flex-col overflow-hidden">
              <div className="flex items-center justify-between border-b border-gray-200 bg-gradient-to-r from-blue-50 via-purple-50 to-indigo-50 px-6 py-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-orange-600 text-sm font-semibold text-white">
                    {getInitials(selectedChat.userLabel)}
                  </div>
                  <div>
                    <p className="text-base font-semibold text-gray-900">{selectedChat.userLabel}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {selectedChat.displayId} • {selectedChat.messageCount} messages •{" "}
                      {selectedChat.lastUpdatedLabel}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={selectedChat.status === "Active" ? "default" : "secondary"}>
                    {selectedChat.status}
                  </Badge>
                  <button className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
                    <Send className="h-3.5 w-3.5" />
                    Take Over
                  </button>
                  <button className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
                    <Tag className="h-3.5 w-3.5" />
                    Tag
                  </button>
                  <button className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
                    <Flag className="h-3.5 w-3.5" />
                    Flag
                  </button>
                  <button className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700">
                    <Download className="h-3.5 w-3.5" />
                    Export
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-5 border-b border-gray-200 bg-white px-6">
                {(["conversation", "insights", "journey", "logs"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`border-b-2 py-2 text-sm font-medium ${
                      activeTab === tab
                        ? "border-blue-600 text-blue-600"
                        : "border-transparent text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    {tab[0].toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>
              <div className="grid h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[260px_1fr_320px]">
                <div className="hidden overflow-y-auto border-r border-gray-200 bg-gray-50 p-4 lg:block">
                  <h4 className="mb-3 text-sm font-semibold text-gray-900">User & Session</h4>
                  <div className="space-y-3">
                    <SidebarMetric label="User Type" value={selectedChat.userId ? "Registered" : "Guest"} />
                    <SidebarMetric label="Session ID" value={selectedChat.displayId} />
                    <SidebarMetric label="Status" value={selectedChat.status} />
                    <SidebarMetric label="Messages" value={String(selectedChat.messageCount)} />
                    <SidebarMetric label="Last Update" value={selectedChat.lastUpdatedLabel} />
                  </div>
                </div>
                <div className="overflow-y-auto p-4">
                  {activeTab === "conversation" ? (
                    <div className="space-y-3">
                      {selectedChat.messages.map((message) => (
                        <div
                          key={message.id}
                          className={`rounded-xl p-4 ${
                            message.role === "assistant"
                              ? "mr-8 border border-blue-100 bg-blue-50 text-gray-900"
                              : "ml-8 border border-gray-200 bg-gray-100 text-gray-900"
                          }`}
                        >
                          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                            {message.role === "assistant" ? (
                              <Brain className="h-3.5 w-3.5 text-blue-600" />
                            ) : (
                              <User className="h-3.5 w-3.5 text-gray-600" />
                            )}
                            {message.role} • {message.timeLabel}
                          </div>
                          <p className="text-sm leading-6">{message.content}</p>
                        </div>
                      ))}
                    </div>
                  ) : activeTab === "insights" ? (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <InsightCard title="Messages" value={selectedChat.messageCount.toString()} />
                      <InsightCard title="Status" value={selectedChat.status} />
                      <InsightCard title="User Type" value={selectedChat.userId ? "Registered" : "Guest"} />
                      <InsightCard title="Last Update" value={selectedChat.lastUpdatedLabel} />
                    </div>
                  ) : activeTab === "journey" ? (
                    <div className="space-y-3">
                      {selectedChat.messages.map((m) => (
                        <div key={`journey-${m.id}`} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                          <div className="text-xs text-gray-500">{m.timeLabel}</div>
                          <div className="text-sm font-medium text-gray-900">{m.role}</div>
                          <div className="text-sm text-gray-700">{m.content.slice(0, 110)}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl bg-gray-900 p-4 font-mono text-xs text-green-400">
                      {selectedChat.messages.map((m) => (
                        <div key={`log-${m.id}`}>
                          [{m.timeLabel}] {m.role.toUpperCase()}: {m.content}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="hidden overflow-y-auto border-l border-gray-200 bg-gray-50 p-4 lg:block">
                  <h4 className="mb-3 text-sm font-semibold text-gray-900">AI & Performance</h4>
                  <div className="space-y-3">
                    <SidebarMetric
                      label="Quality Score"
                      value={selectedChat.messageCount >= 8 ? "8.2 / 10" : "7.4 / 10"}
                    />
                    <SidebarMetric
                      label="Avg Response Time"
                      value={data?.systemHealth.apiLatencyMs ? `${data.systemHealth.apiLatencyMs}ms` : "N/A"}
                    />
                    <SidebarMetric label="Intent" value={inferIntent(selectedChat.lastMessagePreview)} />
                    <SidebarMetric label="Last Message" value={selectedChat.lastMessagePreview} />
                  </div>
                </div>
              </div>
              <div className="border-t border-gray-200 bg-white px-6 py-3">
                <div className="flex items-center gap-3">
                  <input
                    value={adminNote}
                    onChange={(e) => setAdminNote(e.target.value)}
                    placeholder="Add internal note or operator message..."
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">
                    Send
                  </button>
                  <button className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                    Save Note
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InsightCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-xs text-gray-600">{title}</div>
      <div className="mt-1 text-lg font-semibold text-gray-900">{value}</div>
    </div>
  );
}

function SidebarMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-sm font-medium text-gray-900 break-words">{value}</div>
    </div>
  );
}

function inferIntent(preview: string): string {
  const p = preview.toLowerCase();
  if (p.includes("flight") || p.includes("ticket")) return "Book Flight";
  if (p.includes("hotel")) return "Find Stay";
  if (p.includes("visa")) return "Travel Rules";
  if (p.includes("weather")) return "Trip Planning";
  return "General Travel Query";
}

function getInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (parts.length === 0) return "U";
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
}
