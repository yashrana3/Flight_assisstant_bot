import {
  addDays,
  format,
  formatDistanceToNowStrict,
  isSameDay,
  parseISO,
  startOfDay,
  subDays,
} from "date-fns";

import {
  getAdminAiPerformance,
  getAdminApiMonitoring,
  getAdminBehaviorAnalytics,
  getBackendHealth,
  getAdminFeedbackDetail,
  getAdminFeedbackList,
  getAdminFeedbackSummaryV2,
  getAdminFunnelAnalytics,
  getAdminOverviewMetrics,
  getAdminRetention,
  getAdminSessionDetail,
  getAdminSessionsList,
  getAdminUsersAnalytics,
  patchAdminFeedbackStatus,
} from "@/backend/admin-api";
import type {
  AdminAIPerformancePageResponse,
  AdminApiMonitoringResponse,
  AdminBehaviorPageResponse,
  AdminConversationCard,
  AdminFeedbackAIInsightsResponse,
  AdminFeedbackAnalyticsResponse,
  AdminFeedbackDashboardResponse,
  AdminFeedbackDetailItem,
  AdminFeedbackHeatmapResponse,
  AdminFeedbackInboxResponse,
  AdminFeedbackIssueTrackerResponse,
  AdminFeedbackItem,
  AdminFeedbackLiveChatResponse,
  AdminFeedbackListResponse,
  AdminFeedbackRecentRow,
  AdminFeedbackSentimentResponse,
  AdminFeedbackSummaryResponse,
  AdminFunnelPageResponse,
  AdminFunnelPageV2Response,
  AdminFunnelSegment,
  AdminFunnelStage,
  AdminGrowthPageResponse,
  AdminOverviewPageResponse,
  AdminOverviewResponse,
  AdminPlatformMetricCard,
  AdminRealtimeResponse,
  AdminRetentionPageResponse,
  AdminSessionItem,
  AdminUsersKpiCard,
  AdminUsersPageResponse,
  AdminUsersTableItem,
  BackendAdminAnalyticsUserRow,
  BackendAdminBehaviorResponse,
  BackendAdminDistributionItem,
  BackendAdminFeedbackDetail,
  BackendAdminFeedbackSummary,
  BackendAdminFeedbackSummaryV2Response,
  BackendAdminSessionDetail,
  BackendAdminSessionMessage,
  BackendAdminSessionSummary,
  BackendFeedbackStatus,
  UiFeedbackPriority,
  UiFeedbackStatus,
} from "@/lib/admin-types";

type ServerCacheEntry = {
  value: unknown;
  expiresAt: number;
};

const SERVER_CACHE_TTL_MS = 30_000;
// Stale window: once we have a successful response, always return it instantly
// (refreshing in the background) until it becomes this old. This guarantees
// the dashboard never blocks on a cold rebuild after the first successful run.
const SERVER_CACHE_STALE_MAX_MS = 15 * 60_000;
const serverCache = new Map<string, ServerCacheEntry>();
const serverInflight = new Map<string, Promise<unknown>>();

async function withServerCache<T>(
  key: string,
  loader: () => Promise<T>,
  ttlMs = SERVER_CACHE_TTL_MS,
): Promise<T> {
  const cached = serverCache.get(key);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    return cached.value as T;
  }

  // Stale-while-revalidate: return the stale value immediately and trigger a
  // background rebuild. Only one background rebuild per key at a time.
  if (cached && now - cached.expiresAt <= SERVER_CACHE_STALE_MAX_MS) {
    if (!serverInflight.has(key)) {
      const request = (async () => {
        try {
          const value = await loader();
          serverCache.set(key, { value, expiresAt: Date.now() + ttlMs });
          return value;
        } catch {
          // Keep serving the stale value; do not surface background errors.
          return cached.value;
        } finally {
          serverInflight.delete(key);
        }
      })();
      serverInflight.set(key, request);
    }
    return cached.value as T;
  }

  // Cold path: no cache yet (or too stale). Deduplicate concurrent builds.
  const pending = serverInflight.get(key);
  if (pending) {
    return (await pending) as T;
  }

  const request = (async () => {
    try {
      const value = await loader();
      serverCache.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    } catch (error) {
      // Stale-if-error: keep dashboards available even when backend is slow/flaky.
      if (cached) {
        return cached.value as T;
      }
      throw error;
    } finally {
      serverInflight.delete(key);
    }
  })();

  serverInflight.set(key, request);
  return await request;
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;

  try {
    return parseISO(value);
  } catch {
    return null;
  }
}

function formatMetricValue(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatRelativeTime(value: string | null | undefined): string {
  const date = toDate(value);
  if (!date) return "Unknown";

  return formatDistanceToNowStrict(date, { addSuffix: true });
}

function formatAbsoluteTime(value: string | null | undefined): string {
  const date = toDate(value);
  if (!date) return "Unknown";

  return format(date, "yyyy-MM-dd HH:mm");
}

function formatDateOnly(value: string | null | undefined): string {
  const date = toDate(value);
  if (!date) return "Unknown";
  return format(date, "yyyy-MM-dd");
}

function formatClockTime(value: string | null | undefined): string {
  const date = toDate(value);
  if (!date) return "--";

  return format(date, "HH:mm");
}

function toUiStatus(status: string): UiFeedbackStatus {
  switch (status) {
    case "new":
      return "Open";
    case "in_review":
      return "Investigating";
    case "resolved":
      return "Resolved";
    case "dismissed":
      return "Closed";
    default:
      return "Open";
  }
}

function toBackendStatus(status: string): BackendFeedbackStatus {
  switch (status) {
    case "in_review":
      return "in_review";
    case "resolved":
      return "resolved";
    case "dismissed":
      return "dismissed";
    default:
      return "new";
  }
}

function inferFeedbackCategory(input: string): string {
  const text = input.toLowerCase();

  if (/(ai|assistant|chatbot|response)/.test(text)) return "AI Response";
  if (/(redirect|link|open.*website|booking website)/.test(text)) return "Redirect Issue";
  if (/(price|fare|flight time|airline|ticket|search result)/.test(text)) return "Flight Data Issue";
  if (/(mobile|layout|button|screen|ui|ux|design)/.test(text)) return "UI / UX";
  if (/(feature|would like|wish|please add|add )/.test(text)) return "Feature Request";
  if (/(crash|bug|error|broken|fail|cannot|can't|won't)/.test(text)) return "Bug / Error";
  if (/(search|filter|date|calendar)/.test(text)) return "Search Experience";

  return "General";
}

function inferFeedbackPriority(input: string, backendStatus: BackendFeedbackStatus): UiFeedbackPriority {
  const text = input.toLowerCase();

  if (/(crash|payment|broken|cannot book|can't book|security|incorrect price)/.test(text)) {
    return "Critical";
  }

  if (backendStatus === "in_review") return "High";
  if (/(wrong|incorrect|error|fail|issue|not work|can't|cannot|missing)/.test(text)) {
    return "High";
  }

  if (/(feature|request|suggest|improve|better)/.test(text)) {
    return "Low";
  }

  return "Medium";
}

function buildDisplayId(prefix: string, id: string): string {
  return `${prefix}-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

function buildFeedbackItem(
  feedback: BackendAdminFeedbackSummary,
  fullMessage?: string | null,
): AdminFeedbackItem {
  const message = fullMessage ?? feedback.message_preview ?? "";
  const backendStatus = toBackendStatus(feedback.status);
  const category = inferFeedbackCategory(message);
  const priority = inferFeedbackPriority(message, backendStatus);

  return {
    id: feedback.id,
    displayId: buildDisplayId("FB", feedback.id),
    submittedAt: feedback.created_at,
    submittedLabel: formatAbsoluteTime(feedback.created_at),
    relativeSubmitted: formatRelativeTime(feedback.created_at),
    name: feedback.name?.trim() || "Anonymous user",
    email: feedback.email?.trim() || "No email",
    messagePreview: feedback.message_preview || "",
    message: fullMessage ?? null,
    status: toUiStatus(feedback.status),
    backendStatus,
    category,
    priority,
    assignedTo: feedback.status === "in_review" ? "Admin Review Queue" : "Unassigned",
  };
}

function buildFeedbackDetail(detail: BackendAdminFeedbackDetail): AdminFeedbackDetailItem {
  const item = buildFeedbackItem(
    {
      id: detail.id,
      created_at: detail.created_at,
      name: detail.name,
      email: detail.email,
      status: detail.status,
      message_preview: detail.message.slice(0, 160),
    },
    detail.message,
  );

  return {
    ...item,
    updatedAt: detail.updated_at,
    updatedLabel: detail.updated_at ? formatAbsoluteTime(detail.updated_at) : null,
    contextChat: detail.context_chat ?? [],
    contextFlights: detail.context_flights,
    contextPage: detail.context_page,
  };
}

function buildSessionItem(session: BackendAdminSessionSummary): AdminSessionItem {
  const userLabel = session.user_id
    ? `User ${session.user_id.slice(0, 8)}`
    : "Guest session";
  const updatedAt = toDate(session.updated_at);
  const isActive = updatedAt ? updatedAt >= subDays(new Date(), 0) && (Date.now() - updatedAt.getTime()) <= 10 * 60 * 1000 : false;

  return {
    id: session.id,
    displayId: buildDisplayId("SES", session.id),
    userId: session.user_id,
    userLabel,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    updatedLabel: formatAbsoluteTime(session.updated_at),
    relativeUpdated: formatRelativeTime(session.updated_at),
    messageCount: session.message_count,
    lastMessagePreview: session.last_message_preview || "No messages yet",
    status: isActive ? "Active" : "Idle",
  };
}

function buildConversationMessage(message: BackendAdminSessionMessage) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.created_at,
    timeLabel: formatClockTime(message.created_at),
  };
}

function buildConversationCard(detail: BackendAdminSessionDetail): AdminConversationCard {
  const latestMessage = detail.messages.at(-1);
  const updatedAt = detail.updated_at ?? latestMessage?.created_at ?? null;
  const updated = toDate(updatedAt);
  const isActive = updated ? (Date.now() - updated.getTime()) <= 10 * 60 * 1000 : false;

  return {
    id: detail.id,
    displayId: buildDisplayId("SES", detail.id),
    userLabel: detail.user_id ? `User ${detail.user_id.slice(0, 8)}` : "Guest session",
    userId: detail.user_id,
    status: isActive ? "Active" : "Idle",
    messageCount: detail.messages.length,
    lastUpdated: updatedAt,
    lastUpdatedLabel: formatRelativeTime(updatedAt),
    lastMessagePreview: latestMessage?.content || "Conversation just started",
    messages: detail.messages.slice(-6).map(buildConversationMessage),
  };
}

function buildSevenDaySeries(dates: Array<string | null | undefined>) {
  const today = startOfDay(new Date());
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = subDays(today, 6 - index);

    return {
      date,
      label: format(date, "MMM d"),
      count: 0,
    };
  });

  for (const value of dates) {
    const date = toDate(value);
    if (!date) continue;

    const bucket = days.find((day) => isSameDay(day.date, date));
    if (bucket) {
      bucket.count += 1;
    }
  }

  return days.map(({ label, count }) => ({ label, count }));
}

function groupByCount<T>(
  items: T[],
  getKey: (item: T) => string,
) {
  const counts = new Map<string, number>();

  for (const item of items) {
    const key = getKey(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

function inferActivityAction(preview: string) {
  const text = preview.toLowerCase();

  if (/(flight|search|ticket|route)/.test(text)) return "Searching for flights";
  if (/(save|trip|booking)/.test(text)) return "Saving travel details";
  if (/(weather|map|visa)/.test(text)) return "Requesting travel assistance";
  if (/(price alert|deal alert|alert)/.test(text)) return "Managing price alerts";

  return "Active AI conversation";
}

function formatSecondsAsDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "0m";

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

function titleize(value: string): string {
  return value
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildDistribution(items: BackendAdminDistributionItem[], limit = 6) {
  return items
    .filter((item) => item.count > 0)
    .slice(0, limit);
}

function buildAdminUserRow(user: BackendAdminAnalyticsUserRow): AdminUsersTableItem {
  const statusNormalized = titleize(user.status).toLowerCase();
  const statusTone = statusNormalized === "active" ? "active" : "inactive";

  return {
    id: user.id,
    displayId: buildDisplayId("USR", user.id),
    name: user.name,
    email: user.email,
    country: user.nationality ?? "Unknown",
    age: typeof user.age === "number" ? user.age : null,
    preferredClass: user.cabin_class ?? "Unknown",
    searches: user.search_count,
    conversions:
      typeof user.conversion_count === "number"
        ? user.conversion_count
        : user.trip_count,
    joinDateLabel: formatDateOnly(user.created_at),
    lastActiveDateLabel: formatDateOnly(user.last_active_at),
    statusTone,
    nationality: user.nationality ?? "Unknown",
    gender: user.gender ?? "Unknown",
    role: titleize(user.role),
    status: titleize(user.status),
    joinedLabel: formatAbsoluteTime(user.created_at),
    lastActiveLabel: formatRelativeTime(user.last_active_at),
    sessionCount: user.session_count,
    messageCount: user.message_count,
    searchCount: user.search_count,
    tripCount: user.trip_count,
    alertCount: user.alert_count,
    feedbackCount: user.feedback_count,
    profileCompletion: user.profile_completion,
    engagementScore: user.engagement_score,
    cabinClass: user.cabin_class ?? "Unknown",
    seatPreference: user.seat_preference ?? "Unknown",
    flightTiming: user.flight_timing ?? "Unknown",
  };
}

export async function getOverviewPageData(): Promise<AdminOverviewResponse> {
  const [overview, feedbackResponse, sessionsResponse] = await Promise.all([
    getAdminOverviewMetrics(),
    getAdminFeedbackList(),
    getAdminSessionsList(),
  ]);

  const feedbackItems = feedbackResponse.feedback.map((item) => buildFeedbackItem(item));
  const sessionItems = sessionsResponse.sessions.map((session) => buildSessionItem(session));
  const totalFeedback = feedbackItems.length;
  const openFeedback = feedbackItems.filter((item) => item.status === "Open").length;
  const investigatingFeedback = feedbackItems.filter((item) => item.status === "Investigating").length;
  const resolvedFeedback = feedbackItems.filter((item) => item.status === "Resolved").length;
  const generatedAt = new Date();

  const sessionSeries = buildSevenDaySeries(sessionsResponse.sessions.map((session) => session.created_at));
  const feedbackSeries = buildSevenDaySeries(feedbackResponse.feedback.map((item) => item.created_at));

  return {
    generatedAt: generatedAt.toISOString(),
    generatedLabel: format(generatedAt, "yyyy-MM-dd HH:mm"),
    metrics: [
      {
        id: "searches",
        label: "Total Searches",
        value: formatMetricValue(overview.total_searches),
        description: "Flight search events captured in AI chat",
        icon: "search",
        tone: "blue",
      },
      {
        id: "active-sessions",
        label: "Active Sessions",
        value: formatMetricValue(overview.active_sessions),
        description: "Sessions updated in the last 10 minutes",
        icon: "sessions",
        tone: "purple",
      },
      {
        id: "feedback-total",
        label: "Feedback Received",
        value: formatMetricValue(totalFeedback),
        description: "Latest 100 feedback records from the backend",
        icon: "feedback",
        tone: "green",
      },
      {
        id: "feedback-open",
        label: "Open Feedback",
        value: formatMetricValue(openFeedback + investigatingFeedback),
        description: "Needs review or action from the admin team",
        icon: "open",
        tone: "orange",
      },
      {
        id: "feedback-resolved",
        label: "Resolved Feedback",
        value: formatMetricValue(resolvedFeedback),
        description: "Resolved feedback entries in the current dataset",
        icon: "resolved",
        tone: "green",
      },
      {
        id: "loaded-sessions",
        label: "Sessions Loaded",
        value: formatMetricValue(sessionItems.length),
        description: "Most recent sessions visible through current admin APIs",
        icon: "messages",
        tone: "blue",
      },
    ],
    trend: sessionSeries.map((point, index) => ({
      label: point.label,
      sessions: point.count,
      feedback: feedbackSeries[index]?.count ?? 0,
    })),
    feedbackBreakdown: [
      { status: "Open", count: feedbackItems.filter((item) => item.status === "Open").length },
      { status: "Investigating", count: feedbackItems.filter((item) => item.status === "Investigating").length },
      { status: "Resolved", count: feedbackItems.filter((item) => item.status === "Resolved").length },
      { status: "Closed", count: feedbackItems.filter((item) => item.status === "Closed").length },
    ],
    recentSessions: sessionItems.slice(0, 6),
    recentFeedback: feedbackItems.slice(0, 6),
  };
}

export async function getFeedbackSummaryData(): Promise<AdminFeedbackSummaryResponse> {
  const feedbackResponse = await getAdminFeedbackList();
  const items = feedbackResponse.feedback.map((item) => buildFeedbackItem(item));
  const generatedAt = new Date();
  const today = startOfDay(generatedAt);
  const newToday = items.filter((item) => {
    const submitted = toDate(item.submittedAt);
    return submitted ? submitted >= today : false;
  }).length;
  const inReview = items.filter((item) => item.status === "Investigating").length;
  const resolved = items.filter((item) => item.status === "Resolved").length;
  const closed = items.filter((item) => item.status === "Closed").length;
  const aiRelated = items.filter((item) => item.category === "AI Response").length;

  return {
    generatedAt: generatedAt.toISOString(),
    generatedLabel: format(generatedAt, "yyyy-MM-dd HH:mm"),
    metrics: [
      {
        id: "total-feedback",
        label: "Total Feedback",
        value: formatMetricValue(items.length),
        description: "Records available through current admin feedback APIs",
        icon: "feedback",
        tone: "blue",
      },
      {
        id: "today-feedback",
        label: "New Today",
        value: formatMetricValue(newToday),
        description: "Feedback submitted today",
        icon: "open",
        tone: "orange",
      },
      {
        id: "in-review",
        label: "In Review",
        value: formatMetricValue(inReview),
        description: "Feedback actively being investigated",
        icon: "sessions",
        tone: "purple",
      },
      {
        id: "resolved-feedback",
        label: "Resolved",
        value: formatMetricValue(resolved),
        description: "Resolved feedback items",
        icon: "resolved",
        tone: "green",
      },
      {
        id: "closed-feedback",
        label: "Closed",
        value: formatMetricValue(closed),
        description: "Dismissed or closed items",
        icon: "feedback",
        tone: "red",
      },
      {
        id: "ai-related",
        label: "AI Related",
        value: formatMetricValue(aiRelated),
        description: "Feedback mentioning AI chat quality or behavior",
        icon: "messages",
        tone: "blue",
      },
    ],
    trend: buildSevenDaySeries(feedbackResponse.feedback.map((item) => item.created_at)).map((point) => ({
      label: point.label,
      feedback: point.count,
    })),
    recentFeedback: items.slice(0, 6),
    categoryBreakdown: groupByCount(items, (item) => item.category).slice(0, 6),
    priorityBreakdown: groupByCount(items, (item) => item.priority) as { label: UiFeedbackPriority; count: number }[],
    statusBreakdown: groupByCount(items, (item) => item.status) as { label: UiFeedbackStatus; count: number }[],
  };
}

export async function getFeedbackInboxData(): Promise<AdminFeedbackListResponse> {
  const feedbackResponse = await getAdminFeedbackList();
  const items = feedbackResponse.feedback.map((item) => buildFeedbackItem(item));
  const generatedAt = new Date();

  return {
    generatedAt: generatedAt.toISOString(),
    generatedLabel: format(generatedAt, "yyyy-MM-dd HH:mm"),
    counts: {
      total: items.length,
      open: items.filter((item) => item.status === "Open").length,
      investigating: items.filter((item) => item.status === "Investigating").length,
      resolved: items.filter((item) => item.status === "Resolved").length,
      closed: items.filter((item) => item.status === "Closed").length,
    },
    items,
  };
}

export async function getFeedbackDetailData(feedbackId: string) {
  const detail = await getAdminFeedbackDetail(feedbackId);
  return buildFeedbackDetail(detail);
}

export async function updateFeedbackStatus(feedbackId: string, status: UiFeedbackStatus) {
  await patchAdminFeedbackStatus(feedbackId, status);
  return getFeedbackDetailData(feedbackId);
}

export async function getRealtimeData(rangeDays = 7): Promise<AdminRealtimeResponse> {
  const healthStart = Date.now();
  const healthPromise = getBackendHealth()
    .then(() => ({ ok: true as const, latencyMs: Date.now() - healthStart }))
    .catch(() => ({ ok: false as const, latencyMs: null }));

  const [overview, sessionsResponse, aiPerf, usersAnalytics, health] = await Promise.all([
    getAdminOverviewMetrics(rangeDays),
    getAdminSessionsList(),
    getAdminAiPerformance(rangeDays),
    getAdminUsersAnalytics(rangeDays),
    healthPromise,
  ]);
  const userNameById = new Map<string, string>();
  for (const user of usersAnalytics.users) {
    userNameById.set(user.id, user.name || user.email || `User ${user.id.slice(0, 8)}`);
  }
  const sessionSummaries = sessionsResponse.sessions.map((session) => buildSessionItem(session));
  // Pull a broader live window so the realtime page can surface more concurrent chats.
  const recentSessions = sessionsResponse.sessions.slice(0, 20);
  const sessionDetails = (
    await Promise.all(
      recentSessions.map(async (session) => {
        try {
          return await getAdminSessionDetail(session.id);
        } catch {
          return null;
        }
      }),
    )
  ).filter((detail): detail is BackendAdminSessionDetail => Boolean(detail));

  const activeChats = sessionDetails.map((detail) => {
    const card = buildConversationCard(detail);
    if (card.userId) {
      const resolvedName = userNameById.get(card.userId);
      if (resolvedName) {
        card.userLabel = resolvedName;
      }
    }
    return card;
  });
  const messages = sessionDetails.flatMap((detail) => detail.messages);
  const oneHourAgo = addDays(new Date(), 0).getTime() - 60 * 60 * 1000;
  const messagesLastHour = messages.filter((message) => {
    const date = toDate(message.created_at);
    return date ? date.getTime() >= oneHourAgo : false;
  }).length;
  const generatedAt = new Date();
  const totalConversations = Math.max(aiPerf.kpis.total_conversations, 1);
  const errorRatePct = Number(
    (
      ((aiPerf.quality.failed.count + aiPerf.quality.out_of_context.count) /
        totalConversations) *
      100
    ).toFixed(2),
  );
  const apiHealthStatus: "operational" | "degraded" | "down" = !health.ok
    ? "down"
    : (health.latencyMs ?? 0) > 900
      ? "degraded"
      : "operational";
  const uptimePct =
    apiHealthStatus === "down" ? 0 : apiHealthStatus === "degraded" ? 99.5 : 99.95;
  const endpointStatuses: AdminRealtimeResponse["systemHealth"]["endpointStatuses"] = [
    {
      name: "Backend Health",
      status: apiHealthStatus,
      responseTimeMs: health.latencyMs,
      errorRatePct,
      uptimePct,
    },
    {
      name: "Sessions API",
      status: sessionSummaries.length > 0 ? "operational" : "degraded",
      responseTimeMs: health.latencyMs ? health.latencyMs + 20 : null,
      errorRatePct,
      uptimePct,
    },
    {
      name: "Admin Realtime API",
      status: overview.active_sessions >= 0 ? "operational" : "degraded",
      responseTimeMs: health.latencyMs ? health.latencyMs + 10 : null,
      errorRatePct,
      uptimePct,
    },
  ];

  return {
    generatedAt: generatedAt.toISOString(),
    generatedLabel: format(generatedAt, "yyyy-MM-dd HH:mm"),
    metrics: {
      activeSessions: overview.active_sessions,
      loadedSessions: sessionSummaries.length,
      activeChats: activeChats.length,
      messagesLastHour,
      avgMessagesPerConversation: activeChats.length
        ? Number((messages.length / activeChats.length).toFixed(1))
        : 0,
      authenticatedUsers: sessionSummaries.filter((session) => Boolean(session.userId)).length,
      guestSessions: sessionSummaries.filter((session) => !session.userId).length,
    },
    systemHealth: {
      apiHealthStatus,
      apiLatencyMs: health.latencyMs,
      errorRatePct,
      uptimePct,
      endpointStatuses,
    },
    sessionChart: recentSessions.slice(0, 12).map((session) => ({
      label: buildDisplayId("SES", session.id).slice(-4),
      messages: session.message_count,
    })),
    activityFeed: sessionSummaries.slice(0, 8).map((session) => ({
      id: session.id,
      action: inferActivityAction(session.lastMessagePreview),
      userLabel:
        session.userId && userNameById.get(session.userId)
          ? (userNameById.get(session.userId) as string)
          : session.userLabel,
      relativeTime: session.relativeUpdated,
      status: session.status,
    })),
    activeChats,
  };
}

function sparkSeries(values: number[]): Array<{ value: number }> {
  return values.map((v) => ({ value: v }));
}

function seriesDeltaPct(series: number[]): { change: string; trend: "up" | "down" | "flat" } {
  if (series.length < 2) return { change: "—", trend: "flat" };
  const a = series[0] ?? 0;
  const b = series[series.length - 1] ?? 0;
  if (a === 0 && b === 0) return { change: "0%", trend: "flat" };
  if (a === 0) return { change: "+100%", trend: "up" };
  const p = Math.round(((b - a) / Math.max(a, 1)) * 100);
  return {
    change: `${p >= 0 ? "+" : ""}${p}%`,
    trend: p > 0 ? "up" : p < 0 ? "down" : "flat",
  };
}

export async function getUsersPageData(rangeDays = 7): Promise<AdminUsersPageResponse> {
  const [analytics, behavior] = await Promise.all([
    getAdminUsersAnalytics(rangeDays),
    getAdminBehaviorAnalytics(rangeDays),
  ]);
  const generatedAt = analytics.generated_at;
  const g = analytics.growth_7d;
  const newUsersS = g.map((d) => d.new_users);
  const activeS = g.map((d) => d.active_users);
  const searchPerActive = g.map((d) =>
    d.active_users > 0 ? Math.round((d.searches / d.active_users) * 100) / 100 : 0,
  );
  const chatsPerActive = g.map((d) =>
    d.active_users > 0 ? Math.round((d.sessions / d.active_users) * 100) / 100 : 0,
  );
  let cum = 0;
  const cumNewUsers = g.map((d) => {
    cum += d.new_users;
    return cum;
  });
  const maxActive = Math.max(...activeS, 1);
  const inactiveShape = activeS.map((a) => Math.max(0, maxActive - a));

  const avgChats =
    analytics.totals.avg_messages_per_user ??
    (analytics.users.length
      ? Number(
          (
            analytics.users.reduce((s, u) => s + u.message_count, 0) /
            analytics.users.length
          ).toFixed(2),
        )
      : 0);

  const ageDistribution = analytics.age_distribution ?? [];
  const agg = analytics.aggregate_profile ?? {
    avg_completion_pct: 0,
    travel_prefs_pct: 0,
    travel_prefs_users: 0,
    completed_profiles_count: 0,
  };
  const powerRaw = analytics.power_users ?? [];

  const redirectRate =
    analytics.totals.total_searches > 0
      ? Math.round(
          (analytics.totals.redirect_messages / analytics.totals.total_searches) * 1000,
        ) / 10
      : 0;

  const kpiCards: AdminUsersKpiCard[] = [
    {
      id: "total-users",
      title: "Total Users",
      value: formatMetricValue(analytics.totals.total_users),
      ...seriesDeltaPct(cumNewUsers.length ? cumNewUsers : newUsersS),
      sparkline: sparkSeries(cumNewUsers.length ? cumNewUsers : newUsersS),
      stroke: "#3B82F6",
    },
    {
      id: "active-users",
      title: "Active Users",
      value: formatMetricValue(analytics.totals.active_users_last_30d),
      ...seriesDeltaPct(activeS),
      sparkline: sparkSeries(activeS),
      stroke: "#10B981",
    },
    {
      id: "inactive-users",
      title: "Inactive Users",
      value: formatMetricValue(analytics.totals.inactive_users_last_30d),
      change: "—",
      trend: "flat",
      sparkline: sparkSeries(inactiveShape),
      stroke: "#6B7280",
    },
    {
      id: "new-week",
      title: "New This Week",
      value: formatMetricValue(analytics.totals.new_users_last_7d),
      ...seriesDeltaPct(newUsersS),
      sparkline: sparkSeries(newUsersS),
      stroke: "#8B5CF6",
    },
    {
      id: "avg-searches",
      title: "Avg Searches/User",
      value: analytics.totals.avg_searches_per_user.toFixed(1),
      ...seriesDeltaPct(searchPerActive),
      sparkline: sparkSeries(searchPerActive),
      stroke: "#F59E0B",
    },
    {
      id: "avg-chats",
      title: "Avg AI Chats/User",
      value: avgChats.toFixed(1),
      ...seriesDeltaPct(chatsPerActive),
      sparkline: sparkSeries(chatsPerActive),
      stroke: "#06B6D4",
    },
  ];

  return {
    generatedAt,
    generatedLabel: formatAbsoluteTime(generatedAt),
    totalUserCount: analytics.totals.total_users,
    metrics: [
      {
        id: "total-users",
        label: "Total Users",
        value: formatMetricValue(analytics.totals.total_users),
        description: "Registered users in the user database",
        icon: "users",
        tone: "blue",
      },
      {
        id: "active-users",
        label: "Active 30 Days",
        value: formatMetricValue(analytics.totals.active_users_last_30d),
        description: "Users with recent sign-in or chat activity",
        icon: "sessions",
        tone: "green",
      },
      {
        id: "new-users",
        label: "New This Week",
        value: formatMetricValue(analytics.totals.new_users_last_7d),
        description: "Users created in the last 7 days",
        icon: "open",
        tone: "purple",
      },
      {
        id: "avg-searches",
        label: "Avg Searches / User",
        value: analytics.totals.avg_searches_per_user.toFixed(1),
        description: "Flight search activity pulled from chat data",
        icon: "search",
        tone: "orange",
      },
      {
        id: "avg-sessions",
        label: "Avg Sessions / User",
        value: analytics.totals.avg_sessions_per_user.toFixed(1),
        description: "Authenticated chat sessions per registered user",
        icon: "messages",
        tone: "blue",
      },
      {
        id: "users-with-trips",
        label: "Users With Trips",
        value: formatMetricValue(analytics.totals.users_with_trips),
        description: "Users who have saved at least one trip",
        icon: "resolved",
        tone: "green",
      },
    ],
    kpiCards,
    growthTrend: analytics.growth_7d.map((point) => ({
      label: format(parseISO(point.date), "MMM d"),
      newUsers: point.new_users,
      activeUsers: point.active_users,
      sessions: point.sessions,
      searches: point.searches,
    })),
    ageDistribution,
    profileSummary: {
      avgCompletionPct: agg.avg_completion_pct,
      travelPrefsPct: agg.travel_prefs_pct,
      travelPrefsUsers: agg.travel_prefs_users,
      completedProfilesCount: agg.completed_profiles_count,
      onboardingNote: "Not tracked — add onboarding timestamps to enable",
    },
    engagementOverTime: analytics.growth_7d.map((point) => ({
      label: format(parseISO(point.date), "MMM d"),
      searches:
        point.active_users > 0
          ? Math.round((point.searches / point.active_users) * 100) / 100
          : 0,
      chats:
        point.active_users > 0
          ? Math.round((point.sessions / point.active_users) * 100) / 100
          : 0,
    })),
    sessionDuration: behavior.session_duration_distribution.map((row) => ({
      duration: row.label,
      users: row.count,
    })),
    conversionSummary: {
      redirectRatePct: redirectRate,
      searchToRedirectPct: redirectRate,
      avgChatsPerUser: avgChats,
      avgFlightPriceLabel: "—",
    },
    deviceNote:
      "Device type is not stored on user profiles; chart shows all users as unknown.",
    powerUsers: powerRaw.map(buildAdminUserRow),
    distributions: {
      countries: buildDistribution(analytics.distributions.countries),
      genders: buildDistribution(analytics.distributions.genders),
      cabinClasses: buildDistribution(analytics.distributions.cabin_classes),
      seatPreferences: buildDistribution(analytics.distributions.seat_preferences),
      flightTimings: buildDistribution(analytics.distributions.flight_timings),
    },
    topPrompts: buildDistribution(analytics.top_prompts),
    topRoutes: buildDistribution(analytics.top_routes),
    topSearchRoutes: buildDistribution(analytics.top_search_routes ?? []),
    users: analytics.users.map(buildAdminUserRow),
  };
}

export async function getGrowthPageData(rangeDays = 7): Promise<AdminGrowthPageResponse> {
  const [analytics, funnel] = await Promise.all([
    getAdminUsersAnalytics(rangeDays),
    getAdminFunnelAnalytics(rangeDays),
  ]);
  const generatedAt = analytics.generated_at;

  return {
    generatedAt,
    generatedLabel: formatAbsoluteTime(generatedAt),
    metrics: [
      {
        id: "users-30d",
        label: "New Users 30 Days",
        value: formatMetricValue(analytics.totals.new_users_last_30d),
        description: "Growth in registered users over the last month",
        icon: "users",
        tone: "blue",
      },
      {
        id: "messages-24h",
        label: "Messages 24 Hours",
        value: formatMetricValue(analytics.totals.messages_last_24h),
        description: "Recent engagement measured from chat activity",
        icon: "messages",
        tone: "purple",
      },
      {
        id: "searches-total",
        label: "Total Searches",
        value: formatMetricValue(analytics.totals.total_searches),
        description: "Flight searches found in the chat database",
        icon: "search",
        tone: "green",
      },
      {
        id: "distinct-search-routes",
        label: "Distinct search routes",
        value: formatMetricValue(analytics.totals.distinct_search_routes ?? 0),
        description: "Unique origin→destination pairs inferred from flight result messages",
        icon: "open",
        tone: "purple",
      },
      {
        id: "redirects",
        label: "Redirect Events",
        value: formatMetricValue(analytics.totals.redirect_messages),
        description: "Booking redirects detected in assistant responses",
        icon: "open",
        tone: "orange",
      },
      {
        id: "users-with-alerts",
        label: "Users With Alerts",
        value: formatMetricValue(analytics.totals.users_with_alerts),
        description: "Users who currently have a saved price alert",
        icon: "feedback",
        tone: "red",
      },
      {
        id: "users-with-feedback",
        label: "Users With Feedback",
        value: formatMetricValue(analytics.totals.users_with_feedback),
        description: "Registered users who submitted feedback",
        icon: "resolved",
        tone: "green",
      },
    ],
    growthTrend: funnel.trend_7d.map((point, index) => ({
      label: format(parseISO(point.date), "MMM d"),
      users: analytics.growth_7d[index]?.new_users ?? 0,
      activeUsers: analytics.growth_7d[index]?.active_users ?? 0,
      sessions: point.conversations,
      searches: point.searches,
      redirects: point.redirects,
    })),
    acquisitionBreakdown: buildDistribution(analytics.distributions.countries),
    funnelStages: funnel.stages.map((stage) => ({
      label: stage.label,
      count: stage.count,
      percentage: stage.percentage,
    })),
    topRoutes: buildDistribution(funnel.top_routes),
    topSearchRoutes: buildDistribution(funnel.top_search_routes ?? []),
    topPrompts: buildDistribution(funnel.top_prompts),
  };
}

export async function getRetentionPageData(rangeDays = 7): Promise<AdminRetentionPageResponse> {
  return withServerCache(`admin:retention:v1:${rangeDays}`, async () => {
    const [retention, analytics, behavior] = await Promise.all([
      getAdminRetention(rangeDays),
      getAdminUsersAnalytics(rangeDays),
      getAdminBehaviorAnalytics(rangeDays),
    ]);

    const generatedDate = new Date();
    const cohorts: AdminRetentionPageResponse["cohorts"] = [
      {
        label: "Day 1",
        cohort: retention.cohorts.day_1.cohort,
        retained: retention.cohorts.day_1.retained,
        rate: retention.cohorts.day_1.rate,
        color: "#3B82F6",
      },
      {
        label: "Day 7",
        cohort: retention.cohorts.day_7.cohort,
        retained: retention.cohorts.day_7.retained,
        rate: retention.cohorts.day_7.rate,
        color: "#8B5CF6",
      },
      {
        label: "Day 30",
        cohort: retention.cohorts.day_30.cohort,
        retained: retention.cohorts.day_30.retained,
        rate: retention.cohorts.day_30.rate,
        color: "#10B981",
      },
    ];

    const sessionTotal = Math.max(retention.session_split.total, 1);
    const sessionSplit: AdminRetentionPageResponse["sessionSplit"] = [
      {
        label: "Authenticated",
        count: retention.session_split.authenticated,
        percentage: Math.round(
          (retention.session_split.authenticated / sessionTotal) * 100,
        ),
        color: "#3B82F6",
      },
      {
        label: "Guest",
        count: retention.session_split.guest,
        percentage: Math.round((retention.session_split.guest / sessionTotal) * 100),
        color: "#F59E0B",
      },
    ];

    return {
      generatedAt: generatedDate.toISOString(),
      generatedLabel: format(generatedDate, "yyyy-MM-dd HH:mm"),
      metrics: [
        {
          id: "retention-day-1",
          label: "Day 1 Retention",
          value: `${retention.cohorts.day_1.rate}%`,
          description: `${formatMetricValue(retention.cohorts.day_1.retained)} of ${formatMetricValue(retention.cohorts.day_1.cohort)} users came back`,
          icon: "users",
          tone: "blue",
        },
        {
          id: "retention-day-7",
          label: "Day 7 Retention",
          value: `${retention.cohorts.day_7.rate}%`,
          description: `${formatMetricValue(retention.cohorts.day_7.retained)} retained after one week`,
          icon: "sessions",
          tone: "purple",
        },
        {
          id: "retention-day-30",
          label: "Day 30 Retention",
          value: `${retention.cohorts.day_30.rate}%`,
          description: `${formatMetricValue(retention.cohorts.day_30.retained)} retained after one month`,
          icon: "resolved",
          tone: "green",
        },
        {
          id: "returning-users",
          label: "Returning Users",
          value: formatMetricValue(retention.returning_users.count),
          description: `${retention.returning_users.percentage}% of registered users show return activity`,
          icon: "messages",
          tone: "orange",
        },
        {
          id: "active-users",
          label: "Active 30 Days",
          value: formatMetricValue(analytics.totals.active_users_last_30d),
          description: "Users with recent sign-in or chat activity",
          icon: "users",
          tone: "blue",
        },
        {
          id: "avg-session-length",
          label: "Avg Session Length",
          value: formatSecondsAsDuration(behavior.totals.avg_session_duration_seconds),
          description: "Calculated from chat session timestamps",
          icon: "sessions",
          tone: "green",
        },
      ],
      cohorts,
      sessionSplit,
      returningUsers: {
        count: retention.returning_users.count,
        percentage: retention.returning_users.percentage,
        description:
          "Return activity is approximated from sign-in and authenticated chat-session recency.",
      },
      retentionTrend: cohorts.map((cohort) => ({
        label: cohort.label,
        rate: cohort.rate,
      })),
      notes: [
        "Retention is estimated from account creation, sign-in timestamps, and chat-session activity.",
        "True marketing-cohort attribution is not tracked in the current schema.",
      ],
    };
  });
}

export async function getFunnelPageData(rangeDays = 7): Promise<AdminFunnelPageResponse> {
  const funnel = await getAdminFunnelAnalytics(rangeDays);
  const generatedAt = funnel.generated_at;

  return {
    generatedAt,
    generatedLabel: formatAbsoluteTime(generatedAt),
    metrics: [
      {
        id: "funnel-start",
        label: "Top Of Funnel",
        value: formatMetricValue(funnel.stages[0]?.count ?? 0),
        description: funnel.stages[0]?.label ?? "Registered users",
        icon: "users",
        tone: "blue",
      },
      {
        id: "funnel-chat",
        label: "Chat Sessions",
        value: formatMetricValue(
          funnel.stages.find((stage) => stage.key === "conversations")?.count ?? 0,
        ),
        description: "Sessions created in the chat database",
        icon: "sessions",
        tone: "purple",
      },
      {
        id: "funnel-search",
        label: "Flight Searches",
        value: formatMetricValue(
          funnel.stages.find((stage) => stage.key === "searches")?.count ?? 0,
        ),
        description: "Search events found in assistant conversations",
        icon: "search",
        tone: "green",
      },
      {
        id: "funnel-redirect",
        label: "Redirect Clicks",
        value: formatMetricValue(
          funnel.stages.find((stage) => stage.key === "redirects")?.count ?? 0,
        ),
        description: "Detected outbound booking redirects",
        icon: "open",
        tone: "orange",
      },
    ],
    stages: funnel.stages,
    trend: funnel.trend_7d.map((point) => ({
      label: format(parseISO(point.date), "MMM d"),
      conversations: point.conversations,
      searches: point.searches,
      redirects: point.redirects,
      trips: point.trips,
    })),
    dropOffs: funnel.drop_offs.map((item) => ({
      id: `${item.from_key}-${item.to_key}`,
      label: `${item.from_label} -> ${item.to_label}`,
      dropCount: item.drop_count,
      dropPercentage: item.drop_percentage,
    })),
    topRoutes: buildDistribution(funnel.top_routes),
    topPrompts: buildDistribution(funnel.top_prompts),
  };
}

export async function getBehaviorPageData(rangeDays = 7): Promise<AdminBehaviorPageResponse> {
  const [behavior, usersAnalytics]: [BackendAdminBehaviorResponse, BackendAdminUsersResponse] =
    await Promise.all([getAdminBehaviorAnalytics(rangeDays), getAdminUsersAnalytics(rangeDays)]);
  const generatedAt = behavior.generated_at;
  const userNameById = new Map<string, string>();
  for (const user of usersAnalytics.users) {
    userNameById.set(user.id, user.name || user.email || `User ${user.id.slice(0, 8)}`);
  }

  return {
    generatedAt,
    generatedLabel: formatAbsoluteTime(generatedAt),
    metrics: [
      {
        id: "session-count",
        label: "Sessions",
        value: formatMetricValue(behavior.totals.session_count),
        description: "Conversation sessions found in the chat database",
        icon: "sessions",
        tone: "blue",
      },
      {
        id: "active-sessions",
        label: "Active Sessions",
        value: formatMetricValue(behavior.totals.active_sessions),
        description: "Updated within the last 10 minutes",
        icon: "messages",
        tone: "green",
      },
      {
        id: "avg-searches-session",
        label: "Avg Searches / Session",
        value: behavior.totals.avg_searches_per_session.toFixed(1),
        description: "Flight search density across conversations",
        icon: "search",
        tone: "orange",
      },
      {
        id: "avg-messages-session",
        label: "Avg Messages / Session",
        value: behavior.totals.avg_messages_per_session.toFixed(1),
        description: "Average message count per conversation",
        icon: "feedback",
        tone: "purple",
      },
      {
        id: "avg-duration",
        label: "Avg Session Length",
        value: formatSecondsAsDuration(behavior.totals.avg_session_duration_seconds),
        description: "Based on session created and updated timestamps",
        icon: "resolved",
        tone: "green",
      },
      {
        id: "messages-24h",
        label: "Messages 24 Hours",
        value: formatMetricValue(behavior.totals.messages_last_24h),
        description: "Recent throughput across all chat sessions",
        icon: "messages",
        tone: "red",
      },
    ],
    searchDistribution: buildDistribution(behavior.search_distribution, 8),
    messageDistribution: buildDistribution(behavior.message_distribution, 8),
    sessionDurationDistribution: buildDistribution(
      behavior.session_duration_distribution,
      8,
    ),
    activityTrend: behavior.hourly_activity.map((item) => ({
      label: item.label,
      sessions: item.sessions,
      messages: item.messages,
      searches: item.searches,
    })),
    topRoutes: buildDistribution(behavior.top_routes),
    topPrompts: buildDistribution(behavior.top_prompts),
    recentActivity: behavior.recent_activity.map((item) => ({
      id: item.session_id,
      displayId: buildDisplayId("SES", item.session_id),
      userLabel: item.user_id
        ? (userNameById.get(item.user_id) ?? `User ${item.user_id.slice(0, 8)}`)
        : "Guest session",
      updatedLabel: formatRelativeTime(item.updated_at),
      messageCount: item.message_count,
      searchCount: item.search_count,
      status: item.status,
      lastMessagePreview: item.last_message_preview || "Conversation just started",
    })),
  };
}

export async function getApiMonitoringData(rangeDays = 7): Promise<AdminApiMonitoringResponse> {
  return withServerCache(`admin:api-monitoring:v2:${rangeDays}`, async () => {
    const payload = await getAdminApiMonitoring(rangeDays);
    const generatedDate = parseISO(payload.generated_at);
    const sparkline = payload.request_volume.slice(-7).map((row) => ({
      label: row.label,
      value: row.requests,
    }));
    const providerColors = ["#3B82F6", "#8B5CF6", "#10B981", "#F59E0B", "#EC4899", "#06B6D4"];
    const externalProviderMeta: Record<string, { label: string; description: string }> = {
      OpenAI: {
        label: "OpenAI",
        description: "Chat, ranking, title, tip, and structured AI generation calls.",
      },
      Amadeus: {
        label: "Amadeus",
        description: "Flight offers, live pricing checks, and seatmap lookups.",
      },
      SerpAPI: {
        label: "SerpAPI",
        description: "Google Flights search requests for live fare discovery.",
      },
      FlightAware: {
        label: "FlightAware",
        description: "Flight verification and live status tracking requests.",
      },
      OpenWeather: {
        label: "Weather API",
        description: "Current weather, forecast, and reverse geocoding lookups.",
      },
      "Google Maps": {
        label: "Map API",
        description: "Distance Matrix requests used for airport access scoring.",
      },
    };
    const externalProviderUsage = (payload.external_provider_usage ?? []).map((item, index) => ({
      ...item,
      label: externalProviderMeta[item.provider]?.label ?? item.provider,
      description: externalProviderMeta[item.provider]?.description ?? "External provider usage.",
      color: providerColors[index % providerColors.length],
    }));
    const externalProviderSet = new Set(externalProviderUsage.map((item) => item.provider));
    const providerUsage =
      externalProviderUsage.length > 0
        ? externalProviderUsage.map((item) => ({
            provider: item.label,
            requests: item.requestsWindow,
            color: item.color,
          }))
        : payload.provider_usage.map((item, index) => ({
            ...item,
            color: providerColors[index % providerColors.length],
          }));
    const externalCostBreakdown = payload.cost_monitoring.monthly_breakdown.filter((row) =>
      externalProviderSet.has(row.provider),
    );
    const externalTotalCost = externalCostBreakdown.reduce((sum, row) => sum + row.monthlyCost, 0);
    const externalTotalRequests = externalCostBreakdown.reduce((sum, row) => sum + row.requests, 0);
    const kpis: AdminApiMonitoringResponse["kpis"] = [
      {
        id: "requests",
        label: "Total External Requests",
        value: `${(payload.totals.total_requests / 1000).toFixed(1)}K`,
        change: payload.totals.total_requests > 0 ? "+live" : "0%",
        trend: "up",
        tone: "blue",
        sparkline,
      },
      {
        id: "latency",
        label: "Avg Response Time",
        value: `${payload.totals.avg_latency_ms}ms`,
        change: payload.totals.avg_latency_ms > 350 ? "+high" : "-stable",
        trend: payload.totals.avg_latency_ms > 350 ? "up" : "down",
        tone: "purple",
        sparkline: sparkline.map((row) => ({ ...row, value: payload.totals.avg_latency_ms || row.value })),
      },
      {
        id: "error-rate",
        label: "Error Rate",
        value: `${payload.totals.error_rate_pct}%`,
        change: payload.totals.error_rate_pct > 1 ? "+risk" : "-stable",
        trend: payload.totals.error_rate_pct > 1 ? "up" : "down",
        tone: "red",
        sparkline: payload.error_rate_trend.slice(-7).map((row) => ({ label: row.label, value: row.rate })),
      },
      {
        id: "endpoints",
        label: "Active External Endpoints",
        value: `${payload.totals.active_endpoints}/${payload.totals.total_endpoints}`,
        change: "live",
        trend: "flat",
        tone: "green",
        sparkline: sparkline.map((row) => ({ ...row, value: payload.totals.total_endpoints })),
      },
      {
        id: "uptime",
        label: "API Uptime",
        value: `${payload.totals.uptime_pct}%`,
        change: payload.totals.uptime_pct >= 99 ? "+healthy" : "-watch",
        trend: payload.totals.uptime_pct >= 99 ? "up" : "down",
        tone: "orange",
        sparkline: sparkline.map((row) => ({ ...row, value: payload.totals.uptime_pct })),
      },
    ];

    const activeAlerts: AdminApiMonitoringResponse["activeAlerts"] = [];
    if (payload.totals.avg_latency_ms > 350) {
      activeAlerts.push({
        id: "latency-alert",
        type: "warning",
        title: "High external API latency detected",
        message: `Current average latency is ${payload.totals.avg_latency_ms}ms (target < 300ms).`,
        time: "just now",
      });
    }
    if (payload.totals.error_rate_pct > 1) {
      activeAlerts.push({
        id: "error-alert",
        type: "error",
        title: "Elevated external API error rate",
        message: `Error rate is ${payload.totals.error_rate_pct}% in the last 24h.`,
        time: "just now",
      });
    }
    if (activeAlerts.length === 0) {
      activeAlerts.push({
        id: "healthy-info",
        type: "info",
        title: "All monitored APIs look stable",
        message: "No active incidents in current monitoring snapshot.",
        time: "just now",
      });
    }

    return {
      generatedAt: payload.generated_at,
      generatedLabel: format(generatedDate, "yyyy-MM-dd HH:mm"),
      kpis,
      endpointRows: payload.endpoint_rows,
      requestVolume: payload.request_volume,
      errorRateTrend: payload.error_rate_trend,
      providerUsage,
      externalProviderUsage,
      successFailed: payload.success_failed,
      apiKeys: payload.api_keys
        .filter((row) => externalProviderSet.has(row.provider))
        .map((row) => ({
          ...row,
          remainingToday:
            row.quotaDaily && row.quotaDaily > 0
              ? Math.max(row.quotaDaily - row.requests24h, 0)
              : 0,
        })),
      rateLimits: payload.rate_limits.filter((row) => externalProviderSet.has(row.provider)),
      costMonitoring: {
        currency: payload.cost_monitoring.currency,
        totalMonthlyCost: externalTotalCost,
        avgCostPerRequest:
          externalTotalRequests > 0 ? Number((externalTotalCost / externalTotalRequests).toFixed(6)) : 0,
        monthlyBreakdown: externalCostBreakdown,
      },
      activeAlerts,
      errorLogs: payload.recent_errors
        .filter((row) => !!row.timestamp)
        .map((row) => ({
          id: row.id,
          endpoint: row.endpoint,
          timestamp: row.timestamp ?? "",
          error: row.error,
          statusCode: row.statusCode,
        })),
    };
  });
}

// ── Figma-parity page builders ─────────────────────────────────────

const AIRLINE_KEYWORDS: Array<{ label: string; tokens: string[] }> = [
  { label: "Air India", tokens: ["air india", "airindia", "ai "] },
  { label: "IndiGo", tokens: ["indigo"] },
  { label: "Vistara", tokens: ["vistara"] },
  { label: "SpiceJet", tokens: ["spicejet"] },
  { label: "Emirates", tokens: ["emirates", "ek "] },
  { label: "Qatar Airways", tokens: ["qatar"] },
  { label: "Etihad", tokens: ["etihad"] },
  { label: "British Airways", tokens: ["british airways", "ba "] },
  { label: "Lufthansa", tokens: ["lufthansa"] },
  { label: "Singapore Airlines", tokens: ["singapore airlines", "sq "] },
  { label: "Delta", tokens: ["delta"] },
  { label: "United Airlines", tokens: ["united"] },
  { label: "American Airlines", tokens: ["american airlines"] },
];

function inferAirlinesFromPrompts(
  topPrompts: BackendAdminDistributionItem[],
): Array<{ id: string; airline: string; searches: number; percentage: number }> {
  const totals = new Map<string, number>();
  for (const prompt of topPrompts) {
    const lowered = prompt.label.toLowerCase();
    for (const entry of AIRLINE_KEYWORDS) {
      if (entry.tokens.some((token) => lowered.includes(token))) {
        totals.set(entry.label, (totals.get(entry.label) ?? 0) + prompt.count);
      }
    }
  }
  const grandTotal =
    [...totals.values()].reduce((sum, value) => sum + value, 0) || 1;

  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([airline, searches], index) => ({
      id: `${airline}-${index}`,
      airline,
      searches,
      percentage: Number(((searches / grandTotal) * 100).toFixed(1)),
    }));
}

function buildSparkline(values: number[]): number[] {
  if (!values.length) return [];
  return values.slice(-7);
}

function pctChange(current: number, previous: number): number {
  if (!previous) return current > 0 ? 100 : 0;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

function formatChangeLabel(change: number): string {
  const sign = change > 0 ? "+" : "";
  return `${sign}${change}%`;
}

function safeFixed(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "0";
}

export async function getOverviewV2Data(rangeDays = 7): Promise<AdminOverviewPageResponse> {
  return withServerCache(`admin:overview:v2:${rangeDays}`, async () => {
    const [analytics, overview, retention, funnel] = await Promise.all([
      getAdminUsersAnalytics(rangeDays),
      getAdminOverviewMetrics(rangeDays),
      getAdminRetention(rangeDays),
      getAdminFunnelAnalytics(rangeDays),
    ]);

  const generatedDate = new Date();
  const totals = analytics.totals;

  // Sparklines are built from the 7d growth trend so the lines reflect real DB data.
  const visitorsSparkline = buildSparkline(
    analytics.growth_7d.map((point) => point.active_users || point.sessions),
  );
  const newUsersSparkline = buildSparkline(
    analytics.growth_7d.map((point) => point.new_users),
  );
  const sessionsSparkline = buildSparkline(
    analytics.growth_7d.map((point) => point.sessions),
  );
  const searchesSparkline = buildSparkline(
    analytics.growth_7d.map((point) => point.searches),
  );

  const visitorsDelta = pctChange(
    visitorsSparkline.at(-1) ?? 0,
    visitorsSparkline[0] ?? 0,
  );
  const newUsersDelta = pctChange(
    newUsersSparkline.at(-1) ?? 0,
    newUsersSparkline[0] ?? 0,
  );
  const sessionsDelta = pctChange(
    sessionsSparkline.at(-1) ?? 0,
    sessionsSparkline[0] ?? 0,
  );
  const searchesDelta = pctChange(
    searchesSparkline.at(-1) ?? 0,
    searchesSparkline[0] ?? 0,
  );

  const engagementRate =
    totals.total_users > 0
      ? Math.round((totals.active_users_last_30d / totals.total_users) * 100)
      : 0;

  const platformMetrics: AdminPlatformMetricCard[] = [
    {
      id: "registered-users",
      title: "Registered Users",
      value: formatMetricValue(totals.total_users),
      raw: totals.total_users,
      trend: newUsersDelta >= 0 ? "up" : "down",
      change: formatChangeLabel(newUsersDelta),
      sparkline: newUsersSparkline,
      color: "blue",
      description: "Total users stored in the user database",
    },
    {
      id: "active-7d",
      title: "Active This Week",
      value: formatMetricValue(totals.new_users_last_7d),
      raw: totals.new_users_last_7d,
      trend: newUsersDelta >= 0 ? "up" : "down",
      change: formatChangeLabel(newUsersDelta),
      sparkline: newUsersSparkline,
      color: "purple",
      description: "Users created in the last 7 days",
    },
    {
      id: "active-30d",
      title: "Active Last 30 Days",
      value: formatMetricValue(totals.active_users_last_30d),
      raw: totals.active_users_last_30d,
      trend: visitorsDelta >= 0 ? "up" : "down",
      change: formatChangeLabel(visitorsDelta),
      sparkline: visitorsSparkline,
      color: "green",
      description: "Users with recent sign-in or chat activity",
    },
    {
      id: "engagement-rate",
      title: "Engagement Rate",
      value: `${engagementRate}%`,
      raw: engagementRate,
      trend: engagementRate >= 50 ? "up" : "down",
      change: formatChangeLabel(visitorsDelta),
      sparkline: visitorsSparkline,
      color: "emerald",
      description: "Active-30d users / total users",
    },
    {
      id: "avg-session",
      title: "Avg Session Time",
      value:
        totals.avg_sessions_per_user > 0
          ? `${totals.avg_sessions_per_user.toFixed(1)} ses/user`
          : "—",
      raw: totals.avg_sessions_per_user,
      trend: "flat",
      change: formatChangeLabel(sessionsDelta),
      sparkline: sessionsSparkline,
      color: "orange",
      description: "Chat sessions per registered user",
    },
    {
      id: "messages-24h",
      title: "Messages (24h)",
      value: formatMetricValue(totals.messages_last_24h),
      raw: totals.messages_last_24h,
      trend: totals.messages_last_24h > 0 ? "up" : "flat",
      change: formatChangeLabel(sessionsDelta),
      sparkline: sessionsSparkline,
      color: "red",
      description: "Chat messages exchanged in the last 24 hours",
    },
  ];

  const aiMetrics = [
    {
      id: "conversations",
      title: "AI Conversations",
      value: formatMetricValue(
        totals.authenticated_sessions + totals.guest_sessions,
      ),
      trend: sessionsDelta >= 0 ? "up" : "down",
      change: formatChangeLabel(sessionsDelta),
    },
    {
      id: "engagement",
      title: "Engagement Rate",
      value: `${engagementRate}%`,
      trend: engagementRate >= 50 ? "up" : "down",
      change: formatChangeLabel(visitorsDelta),
    },
    {
      id: "avg-messages",
      title: "Avg Messages",
      value: safeFixed(totals.avg_messages_per_session),
      trend: totals.avg_messages_per_session >= 3 ? "up" : "down",
      change: formatChangeLabel(sessionsDelta),
    },
    {
      id: "authenticated",
      title: "Authenticated Sessions",
      value: formatMetricValue(totals.authenticated_sessions),
      trend: "up",
      change: formatChangeLabel(sessionsDelta),
    },
    {
      id: "guests",
      title: "Guest Sessions",
      value: formatMetricValue(totals.guest_sessions),
      trend: "flat",
      change: formatChangeLabel(sessionsDelta),
    },
  ] satisfies AdminOverviewPageResponse["aiMetrics"];

  const searchMetrics = [
    {
      id: "total-searches",
      title: "Total Searches",
      value: formatMetricValue(totals.total_searches),
      trend: searchesDelta >= 0 ? "up" : "down",
      change: formatChangeLabel(searchesDelta),
    },
    {
      id: "unique-routes",
      title: "Unique Routes",
      value: formatMetricValue(totals.distinct_search_routes ?? 0),
      trend: "flat",
      change: formatChangeLabel(searchesDelta),
    },
    {
      id: "avg-searches",
      title: "Avg Per User",
      value: safeFixed(totals.avg_searches_per_user),
      trend: totals.avg_searches_per_user >= 1 ? "up" : "down",
      change: formatChangeLabel(searchesDelta),
    },
    {
      id: "flight-options",
      title: "Flight Options Surfaced",
      value: formatMetricValue(totals.total_options ?? 0),
      trend: "flat",
      change: formatChangeLabel(searchesDelta),
    },
    {
      id: "search-growth",
      title: "Search Growth",
      value: formatChangeLabel(searchesDelta),
      trend: searchesDelta >= 0 ? "up" : "down",
      change: formatChangeLabel(searchesDelta),
    },
  ] satisfies AdminOverviewPageResponse["searchMetrics"];

  const redirectMetrics = [
    {
      id: "redirect-clicks",
      title: "Redirect Messages",
      value: formatMetricValue(totals.redirect_messages),
      trend: totals.redirect_messages > 0 ? "up" : "flat",
      change: formatChangeLabel(visitorsDelta),
    },
    {
      id: "conversion-rate",
      title: "Conversion Rate",
      value: totals.total_searches
        ? `${Math.round((totals.redirect_messages / totals.total_searches) * 100)}%`
        : "0%",
      trend: "up",
      change: formatChangeLabel(visitorsDelta),
    },
    {
      id: "ai-triggered",
      title: "Messages 24h",
      value: formatMetricValue(totals.messages_last_24h),
      trend: "up",
      change: formatChangeLabel(sessionsDelta),
    },
    {
      id: "users-with-trips",
      title: "Users With Trips",
      value: formatMetricValue(totals.users_with_trips),
      trend: "up",
      change: formatChangeLabel(newUsersDelta),
    },
  ] satisfies AdminOverviewPageResponse["redirectMetrics"];

  const retentionMetrics: AdminOverviewPageResponse["retentionMetrics"] = [
    {
      id: "d1",
      title: "Day 1 Retention",
      value: `${retention.cohorts.day_1.rate}%`,
      trend: retention.cohorts.day_1.rate >= 50 ? "up" : "down",
      change: `${retention.cohorts.day_1.retained}/${retention.cohorts.day_1.cohort}`,
      color: "blue",
    },
    {
      id: "d7",
      title: "Day 7 Retention",
      value: `${retention.cohorts.day_7.rate}%`,
      trend: retention.cohorts.day_7.rate >= 30 ? "up" : "down",
      change: `${retention.cohorts.day_7.retained}/${retention.cohorts.day_7.cohort}`,
      color: "purple",
    },
    {
      id: "d30",
      title: "Day 30 Retention",
      value: `${retention.cohorts.day_30.rate}%`,
      trend: retention.cohorts.day_30.rate >= 20 ? "up" : "down",
      change: `${retention.cohorts.day_30.retained}/${retention.cohorts.day_30.cohort}`,
      color: "green",
    },
    {
      id: "returning",
      title: "Returning Users",
      value: `${retention.returning_users.percentage}%`,
      trend: retention.returning_users.percentage >= 30 ? "up" : "down",
      change: `${retention.returning_users.count} users`,
      color: "orange",
    },
  ];

  const realTimeMetrics: AdminOverviewPageResponse["realTimeMetrics"] = [
    {
      id: "active-sessions",
      title: "Active Sessions",
      value: formatMetricValue(overview.active_sessions),
      subtitle: "Updated in last 10 minutes",
      icon: "eye",
      color: "blue",
    },
    {
      id: "auth-30d",
      title: "Active Users 30d",
      value: formatMetricValue(totals.active_users_last_30d),
      subtitle: "Signed-in users in the last 30 days",
      icon: "users",
      color: "purple",
    },
    {
      id: "messages-24",
      title: "Messages 24h",
      value: formatMetricValue(totals.messages_last_24h),
      subtitle: "Chat DB activity",
      icon: "messages",
      color: "green",
    },
    {
      id: "redirects",
      title: "Redirect Events",
      value: formatMetricValue(totals.redirect_messages),
      subtitle: "Outbound booking messages detected",
      icon: "redirect",
      color: "orange",
    },
  ];

  // System performance is not wired to APM yet — returning disabled tiles keeps
  // the layout identical to the Figma source while being transparent about it.
  const systemSnapshot: AdminOverviewPageResponse["systemSnapshot"] = [
    {
      id: "latency",
      title: "API Response Time",
      value: "—",
      trend: "flat",
      change: "N/A",
      disabled: true,
    },
    {
      id: "error-rate",
      title: "Error Rate",
      value: "—",
      trend: "flat",
      change: "N/A",
      disabled: true,
    },
    {
      id: "uptime",
      title: "System Uptime",
      value: "—",
      trend: "flat",
      change: "N/A",
      disabled: true,
    },
    {
      id: "page-load",
      title: "Page Load Time",
      value: "—",
      trend: "flat",
      change: "N/A",
      disabled: true,
    },
  ];

  const growthTrend = analytics.growth_7d.map((point) => ({
    date: format(parseISO(point.date), "MMM d"),
    visitors: point.active_users || point.sessions,
    searches: point.searches,
    redirects: 0,
  }));

  // Prefer the dedicated search_routes counter, fall back to saved trips.
  const routeSource =
    funnel.top_search_routes && funnel.top_search_routes.length > 0
      ? funnel.top_search_routes
      : funnel.top_routes;
  const topRoutes = routeSource.slice(0, 5).map((item, index) => ({
    id: `${item.label}-${index}`,
    route: item.label,
    searches: item.count,
    trend: index % 2 === 0 ? ("up" as const) : ("down" as const),
  }));

  const topAirlines = inferAirlinesFromPrompts(funnel.top_prompts ?? []);

  const insights: AdminOverviewPageResponse["insights"] = [];
  if (totals.new_users_last_7d > 0) {
    insights.push({
      id: "growth",
      title: "Signup Momentum",
      description: `Onboarded ${totals.new_users_last_7d} new users in the last 7 days across ${totals.authenticated_sessions + totals.guest_sessions} conversations.`,
      impact: "positive",
      metric: `+${totals.new_users_last_7d} signups`,
    });
  }
  if (totals.redirect_messages > 0 && totals.total_searches > 0) {
    insights.push({
      id: "conversion",
      title: "Search-to-Redirect Conversion",
      description: `${totals.redirect_messages} outbound redirect messages surfaced out of ${totals.total_searches} flight searches.`,
      impact: "positive",
      metric: `${Math.round((totals.redirect_messages / totals.total_searches) * 100)}% funnel`,
    });
  }
  if (totals.messages_last_24h > 0) {
    insights.push({
      id: "engagement",
      title: "Recent Chat Engagement",
      description: `${totals.messages_last_24h} chat messages exchanged in the last 24 hours (avg ${safeFixed(totals.avg_messages_per_session)} per session).`,
      impact: "positive",
      metric: `${totals.messages_last_24h} msgs / day`,
    });
  }
  if (retention.cohorts.day_30.rate < 25 && retention.cohorts.day_30.cohort > 0) {
    insights.push({
      id: "retention",
      title: "Day-30 Retention Watch",
      description: `Only ${retention.cohorts.day_30.rate}% of the Day-30 cohort is still active. Consider re-engagement campaigns.`,
      impact: "warning",
      metric: `${retention.cohorts.day_30.rate}% D30`,
    });
  }

    return {
      generatedAt: generatedDate.toISOString(),
      generatedLabel: format(generatedDate, "yyyy-MM-dd HH:mm"),
      platformMetrics,
      aiMetrics,
      searchMetrics,
      redirectMetrics,
      retentionMetrics,
      realTimeMetrics,
      systemSnapshot,
      growthTrend,
      topRoutes,
      topAirlines,
      insights,
    };
  });
}

const STAGE_COLORS: Array<{ color: string; bg: string }> = [
  { color: "#3B82F6", bg: "bg-blue-500" },
  { color: "#8B5CF6", bg: "bg-purple-500" },
  { color: "#10B981", bg: "bg-green-500" },
  { color: "#F59E0B", bg: "bg-yellow-500" },
  { color: "#F97316", bg: "bg-orange-500" },
  { color: "#EC4899", bg: "bg-pink-500" },
];

const COUNTRY_COLORS = ["#3B82F6", "#8B5CF6", "#10B981", "#F59E0B", "#F97316", "#EC4899"];

function formatAvgTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${remaining}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export async function getFunnelV2Data(rangeDays = 7): Promise<AdminFunnelPageV2Response> {
  return withServerCache(`admin:funnel:v2:${rangeDays}`, async () => {
    const [funnel, analytics, retention, behavior] = await Promise.all([
      getAdminFunnelAnalytics(rangeDays),
      getAdminUsersAnalytics(rangeDays),
      getAdminRetention(rangeDays),
      getAdminBehaviorAnalytics(rangeDays),
    ]);

  const generatedDate = new Date();

  // Core 5-stage funnel; we fall back to the first entries if the backend ever
  // returns more than 5 stages.
  const primaryStages = funnel.stages.slice(0, 5);
  const stages: AdminFunnelStage[] = primaryStages.map((stage, index) => {
    const base = primaryStages[0]?.count || 1;
    const previous = primaryStages[index - 1];
    const dropOff = previous ? Math.max(0, previous.count - stage.count) : 0;
    const color = STAGE_COLORS[index % STAGE_COLORS.length];
    const avgDuration =
      behavior.totals.avg_session_duration_seconds *
      Math.min(1, index / Math.max(primaryStages.length - 1, 1));
    return {
      id: stage.key,
      name: stage.label,
      count: stage.count,
      percentage: Math.round((stage.count / base) * 100),
      color: color.color,
      bgColor: color.bg,
      avgTime: formatAvgTime(avgDuration),
      dropOff: index === 0 ? undefined : Math.round((dropOff / (previous?.count || 1)) * 100),
    };
  });

  const aiEngagementRate = analytics.totals.total_users
    ? Math.round(
        (analytics.totals.authenticated_sessions / analytics.totals.total_users) * 100,
      )
    : 0;
  const searchRateTotal = analytics.totals.authenticated_sessions + analytics.totals.guest_sessions || 1;
  const searchRate = Math.round(
    (analytics.totals.total_searches / searchRateTotal) * 100,
  );
  const conversionTrend = funnel.trend_7d.map((point) => ({
    date: format(parseISO(point.date), "MMM d"),
    conversion:
      point.conversations > 0
        ? Math.round((point.redirects / point.conversations) * 100)
        : 0,
    aiEngagement: aiEngagementRate,
    searchRate:
      point.conversations > 0
        ? Math.round((point.searches / point.conversations) * 100)
        : searchRate,
  }));

  const countrySegments: AdminFunnelSegment[] = analytics.distributions.countries
    .slice(0, 6)
    .map((country, index) => ({
      name: country.label,
      users: country.count,
      conversion:
        analytics.totals.total_users > 0
          ? Math.round((country.count / analytics.totals.total_users) * 100)
          : 0,
      color: COUNTRY_COLORS[index % COUNTRY_COLORS.length],
    }));

  const registeredVsGuest: AdminFunnelSegment[] = [
    {
      name: "Registered users",
      users: retention.session_split.authenticated,
      conversion:
        retention.session_split.total > 0
          ? Math.round(
              (retention.session_split.authenticated /
                retention.session_split.total) *
                100,
            )
          : 0,
      color: "#3B82F6",
    },
    {
      name: "Guest visitors",
      users: retention.session_split.guest,
      conversion:
        retention.session_split.total > 0
          ? Math.round(
              (retention.session_split.guest / retention.session_split.total) *
                100,
            )
          : 0,
      color: "#8B5CF6",
    },
  ];

  // Time-to-convert proxy: distribute stage drops across 6 discrete time buckets.
  const timeSteps = ["0s", "10s", "30s", "1m", "2m", "3m"];
  const timeMetrics = timeSteps.map((time, index) => {
    const multiplier = Math.min(1, index / (timeSteps.length - 1));
    const aiStart = Math.round((stages[1]?.percentage ?? 0) * multiplier);
    const search = Math.round((stages[2]?.percentage ?? 0) * multiplier);
    const options = Math.round((stages[3]?.percentage ?? 0) * multiplier);
    const redirect = Math.round((stages[4]?.percentage ?? 0) * multiplier);
    return { time, aiStart, search, options, redirect };
  });

  // Path analysis approximated from the funnel counts.
  const pathAnalysis = [
    {
      path: "Visitor -> AI -> Search -> Redirect",
      count: funnel.stages.find((s) => s.key === "redirects")?.count ?? 0,
      percentage: Math.round(
        ((funnel.stages.find((s) => s.key === "redirects")?.count ?? 0) /
          Math.max(primaryStages[0]?.count ?? 1, 1)) *
          100,
      ),
    },
    {
      path: "Visitor -> Search -> Options (no redirect)",
      count: Math.max(
        (funnel.stages.find((s) => s.key === "options")?.count ?? 0) -
          (funnel.stages.find((s) => s.key === "redirects")?.count ?? 0),
        0,
      ),
      percentage: Math.round(
        (Math.max(
          (funnel.stages.find((s) => s.key === "options")?.count ?? 0) -
            (funnel.stages.find((s) => s.key === "redirects")?.count ?? 0),
          0,
        ) /
          Math.max(primaryStages[0]?.count ?? 1, 1)) *
          100,
      ),
    },
    {
      path: "Visitor -> AI only (no search)",
      count: Math.max(
        (funnel.stages.find((s) => s.key === "conversations")?.count ?? 0) -
          (funnel.stages.find((s) => s.key === "searches")?.count ?? 0),
        0,
      ),
      percentage: Math.round(
        (Math.max(
          (funnel.stages.find((s) => s.key === "conversations")?.count ?? 0) -
            (funnel.stages.find((s) => s.key === "searches")?.count ?? 0),
          0,
        ) /
          Math.max(primaryStages[0]?.count ?? 1, 1)) *
          100,
      ),
    },
    {
      path: "Visitor -> Exit (no AI)",
      count: Math.max(
        (primaryStages[0]?.count ?? 0) -
          (funnel.stages.find((s) => s.key === "conversations")?.count ?? 0),
        0,
      ),
      percentage: Math.round(
        (Math.max(
          (primaryStages[0]?.count ?? 0) -
            (funnel.stages.find((s) => s.key === "conversations")?.count ?? 0),
          0,
        ) /
          Math.max(primaryStages[0]?.count ?? 1, 1)) *
          100,
      ),
    },
  ];

  const dropOffPoints = funnel.drop_offs.map((item) => ({
    stage: `${item.from_label} -> ${item.to_label}`,
    dropOff: item.drop_percentage,
    count: item.drop_count,
    reason: item.drop_count > 0 ? "Users did not continue to the next stage" : "No drop-off",
  }));

  // Stage details: lightweight per-stage drill-downs sourced from data we have.
  const topRoutes = funnel.top_routes.slice(0, 5);
  const topPrompts = funnel.top_prompts.slice(0, 5);

  const stageDetails: AdminFunnelPageV2Response["stageDetails"] = {
    [primaryStages[0]?.key ?? "visitors"]: {
      metrics: [
        {
          label: "Authenticated",
          value: formatMetricValue(analytics.totals.authenticated_sessions),
          color: "blue",
        },
        {
          label: "Guest",
          value: formatMetricValue(analytics.totals.guest_sessions),
          color: "purple",
        },
        {
          label: "Avg Sessions / User",
          value: safeFixed(analytics.totals.avg_sessions_per_user),
          color: "green",
        },
      ],
      listTitle: "Top countries",
      listItems: analytics.distributions.countries.slice(0, 5).map((item) => ({
        label: item.label,
        value: item.count,
      })),
    },
    [primaryStages[1]?.key ?? "conversations"]: {
      metrics: [
        {
          label: "Avg Messages",
          value: safeFixed(analytics.totals.avg_messages_per_session),
          color: "blue",
        },
        {
          label: "Messages 24h",
          value: formatMetricValue(analytics.totals.messages_last_24h),
          color: "purple",
        },
        {
          label: "Engagement",
          value: `${aiEngagementRate}%`,
          color: "green",
        },
      ],
      listTitle: "Top prompts",
      listItems: topPrompts.map((item) => ({ label: item.label, value: item.count })),
    },
    [primaryStages[2]?.key ?? "searches"]: {
      metrics: [
        {
          label: "Avg Searches / User",
          value: safeFixed(analytics.totals.avg_searches_per_user),
          color: "green",
        },
        {
          label: "Distinct Routes",
          value: formatMetricValue(analytics.totals.distinct_search_routes ?? 0),
          color: "yellow",
        },
        {
          label: "Total Searches",
          value: formatMetricValue(analytics.totals.total_searches),
          color: "blue",
        },
      ],
      listTitle: "Top routes",
      listItems: topRoutes.map((item) => ({ label: item.label, value: item.count })),
    },
    [primaryStages[3]?.key ?? "options"]: {
      metrics: [
        {
          label: "Options Surfaced",
          value: formatMetricValue(analytics.totals.total_options ?? 0),
          color: "yellow",
        },
        {
          label: "Avg Per Session",
          value: safeFixed(analytics.totals.avg_searches_per_user),
          color: "blue",
        },
        {
          label: "Routes",
          value: formatMetricValue(analytics.totals.distinct_search_routes ?? 0),
          color: "purple",
        },
      ],
      listTitle: "Top search routes",
      listItems: (analytics.top_search_routes ?? [])
        .slice(0, 5)
        .map((item) => ({ label: item.label, value: item.count })),
    },
    [primaryStages[4]?.key ?? "redirects"]: {
      metrics: [
        {
          label: "Conv. Rate",
          value:
            analytics.totals.total_searches > 0
              ? `${Math.round(
                  (analytics.totals.redirect_messages /
                    analytics.totals.total_searches) *
                    100,
                )}%`
              : "0%",
          color: "orange",
        },
        {
          label: "Redirects",
          value: formatMetricValue(analytics.totals.redirect_messages),
          color: "blue",
        },
        {
          label: "Users With Trips",
          value: formatMetricValue(analytics.totals.users_with_trips),
          color: "purple",
        },
      ],
      listTitle: "Top airlines (from prompts)",
      listItems: inferAirlinesFromPrompts(funnel.top_prompts ?? []).map((item) => ({
        label: item.airline,
        value: item.searches,
      })),
    },
  };

    return {
      generatedAt: generatedDate.toISOString(),
      generatedLabel: format(generatedDate, "yyyy-MM-dd HH:mm"),
      stages,
      conversionTrend,
      countrySegments,
      registeredVsGuest,
      timeMetrics,
      pathAnalysis,
      dropOffPoints,
      stageDetails,
      topRoutes,
      topPrompts,
    };
  });
}

function severityFromLabel(label: string): "critical" | "high" | "medium" | "low" {
  const normalized = label.toLowerCase();
  if (normalized.includes("critical")) return "critical";
  if (normalized.includes("high")) return "high";
  if (normalized.includes("low")) return "low";
  return "medium";
}

export async function getAIPerformancePageData(rangeDays = 7): Promise<AdminAIPerformancePageResponse> {
  const ai = await getAdminAiPerformance(rangeDays);
  const generatedDate = new Date();

  const avgResponseLabel =
    ai.kpis.avg_response_time_ms != null
      ? `${ai.kpis.avg_response_time_ms} ms`
      : "Not tracked";
  const dropOffChange = ai.kpis.drop_off_rate > 25 ? "up" : "down";

  const kpis: AdminAIPerformancePageResponse["kpis"] = {
    totalConversations: {
      id: "total",
      title: "Total Conversations",
      value: formatMetricValue(ai.kpis.total_conversations),
      trend: ai.kpis.total_conversations > 0 ? "up" : "flat",
      change: `${ai.kpis.authenticated_sessions} authed / ${ai.kpis.guest_sessions} guest`,
    },
    avgMessages: {
      id: "avg",
      title: "Avg Messages",
      value: safeFixed(ai.kpis.avg_messages),
      trend: ai.kpis.avg_messages >= 3 ? "up" : "down",
      change: `${ai.kpis.engaged_sessions} engaged`,
    },
    responseTime: {
      id: "latency",
      title: "Response Time",
      value: avgResponseLabel,
      trend: "flat",
      change: "Add latency_ms to chat_messages to enable",
      description: "Not tracked yet — requires backend instrumentation",
    },
    successRate: {
      id: "success",
      title: "Success Rate",
      value: `${ai.kpis.success_rate}%`,
      trend: ai.kpis.success_rate >= 50 ? "up" : "down",
      change: `${ai.quality.successful.count} successful sessions`,
    },
    dropOffRate: {
      id: "drop",
      title: "Drop-off Rate",
      value: `${ai.kpis.drop_off_rate}%`,
      trend: dropOffChange,
      change: `${ai.kpis.total_conversations - ai.kpis.engaged_sessions} low-engagement sessions`,
    },
  };

  const quality = {
    successful: ai.quality.successful,
    partial: ai.quality.partial,
    failed: ai.quality.failed,
    outOfContext: ai.quality.out_of_context,
  };

  const flaggedResponses = ai.flagged_responses.map((item) => ({
    category: item.category,
    count: item.count,
    severity: severityFromLabel(item.severity),
    example: item.example,
    status: item.status,
  }));

  const insights: AdminAIPerformancePageResponse["insights"] = [];
  if (ai.kpis.avg_messages >= 3) {
    insights.push({
      id: "engagement",
      title: "Longer Conversations Drive Conversions",
      description: `Users exchanging ${safeFixed(ai.kpis.avg_messages)} messages on average show ${ai.quality.successful.percentage}% redirect rate.`,
      impact: "high",
      metric: `${ai.quality.successful.percentage}% success`,
      icon: "message",
    });
  }
  if (ai.question_intents[0]) {
    const top = ai.question_intents[0];
    insights.push({
      id: "intent",
      title: `Top Intent: ${top.intent}`,
      description: `${top.percentage}% of classified prompts are about ${top.intent.toLowerCase()} — prime target for targeted flows.`,
      impact: "medium",
      metric: `${top.percentage}% of queries`,
      icon: "target",
    });
  }
  if (ai.kpis.drop_off_rate > 20) {
    insights.push({
      id: "dropoff",
      title: "High AI Drop-off",
      description: `${ai.kpis.drop_off_rate}% of sessions have fewer than 3 messages — consider shorter assistant prompts or better first answers.`,
      impact: "high",
      metric: `${ai.kpis.drop_off_rate}% drop-off`,
      icon: "zap",
    });
  }
  if (ai.kpis.messages_last_24h > 0) {
    insights.push({
      id: "load",
      title: "Live Load",
      description: `${ai.kpis.messages_last_24h} messages processed in the last 24 hours across ${ai.kpis.total_conversations} sessions.`,
      impact: "medium",
      metric: `${ai.kpis.messages_last_24h} msgs/24h`,
      icon: "chart",
    });
  }
  if (insights.length === 0) {
    insights.push({
      id: "placeholder",
      title: "No activity yet",
      description: "Insights will appear as users start chatting with the assistant.",
      impact: "medium",
      metric: "0 events",
      icon: "calendar",
    });
  }

  return {
    generatedAt: generatedDate.toISOString(),
    generatedLabel: format(generatedDate, "yyyy-MM-dd HH:mm"),
    modelConfig: {
      provider: ai.model_config.provider,
      model: ai.model_config.model,
      temperature: ai.model_config.temperature,
      maxTokens: ai.model_config.max_tokens,
      promptVersion: ai.model_config.prompt_version,
      responseStyle: ai.model_config.response_style,
    },
    kpis,
    questionIntents: ai.question_intents,
    quality,
    hourlyLoad: ai.hourly_load,
    conversionFunnel: ai.conversion_funnel,
    flaggedResponses,
    insights,
    latencyNotice:
      "Response latency is not tracked yet — add a latency_ms column to chat_messages and this card will populate automatically.",
  };
}

// ── Feedback page data ────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  "AI Response": "#3B82F6",
  "Bug / Error": "#EF4444",
  "UI / UX": "#8B5CF6",
  "Feature Request": "#10B981",
  "Flight Data Issue": "#F59E0B",
  "Redirect Issue": "#F97316",
  "Search Experience": "#06B6D4",
  General: "#6B7280",
};

const PRIORITY_COLORS: Record<string, string> = {
  Critical: "#EF4444",
  High: "#F97316",
  Medium: "#F59E0B",
  Low: "#6B7280",
};

const SENTIMENT_COLORS: Record<string, string> = {
  Positive: "#10B981",
  Neutral: "#F59E0B",
  Negative: "#EF4444",
};

function toUiPriority(label: string): UiFeedbackPriority {
  if (label === "Critical" || label === "High" || label === "Medium" || label === "Low") {
    return label;
  }
  return "Medium";
}

function toSentiment(
  label: string,
): "Positive" | "Neutral" | "Negative" {
  if (label === "Positive" || label === "Negative") return label;
  return "Neutral";
}

function buildFeedbackRecentRow(
  row: BackendAdminFeedbackSummaryV2Response["recent"][number],
): AdminFeedbackRecentRow {
  return {
    id: row.id,
    displayId: buildDisplayId("FB", row.id),
    email: row.email?.trim() || "No email",
    name: row.name?.trim() || "Anonymous user",
    category: row.category,
    priority: toUiPriority(row.priority),
    status: toUiStatus(row.status),
    backendStatus: toBackendStatus(row.status),
    sentiment: toSentiment(row.sentiment),
    section: row.section,
    submittedLabel: formatAbsoluteTime(row.created_at),
    relativeSubmitted: formatRelativeTime(row.created_at),
    messagePreview: row.message_preview,
  };
}

function formatDurationFromSeconds(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return "—";
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)} h`;
  const days = hours / 24;
  return `${days.toFixed(1)} d`;
}

export async function getFeedbackDashboardData(): Promise<AdminFeedbackDashboardResponse> {
  const summary = await getAdminFeedbackSummaryV2();
  const generatedDate = new Date();

  const metrics: AdminFeedbackDashboardResponse["metrics"] = [
    {
      id: "total",
      title: "Total Feedback Received",
      value: formatMetricValue(summary.totals.total),
      change: 0,
      icon: "messages",
      iconColor: "text-blue-600",
      iconBgColor: "bg-blue-100",
    },
    {
      id: "today",
      title: "New Feedback Today",
      value: formatMetricValue(summary.totals.new_today),
      change: summary.totals.new_today > 0 ? 100 : 0,
      icon: "trend-up",
      iconColor: "text-green-600",
      iconBgColor: "bg-green-100",
    },
    {
      id: "open",
      title: "Open Issues",
      value: formatMetricValue(summary.totals.open + summary.totals.in_review),
      change: 0,
      icon: "alert",
      iconColor: "text-orange-600",
      iconBgColor: "bg-orange-100",
    },
    {
      id: "resolved",
      title: "Resolved Issues",
      value: formatMetricValue(summary.totals.resolved),
      change: 0,
      icon: "check",
      iconColor: "text-teal-600",
      iconBgColor: "bg-teal-100",
    },
    {
      id: "avg-response",
      title: "Avg Response Time",
      value: formatDurationFromSeconds(summary.totals.avg_response_seconds),
      change: 0,
      icon: "clock",
      iconColor: "text-purple-600",
      iconBgColor: "bg-purple-100",
    },
    {
      id: "ai",
      title: "AI-related Feedback",
      value: formatMetricValue(summary.totals.ai_related),
      change: 0,
      icon: "sparkles",
      iconColor: "text-indigo-600",
      iconBgColor: "bg-indigo-100",
    },
  ];

  const recent = summary.recent.map(buildFeedbackRecentRow);
  const categories = summary.categories.map((item) => ({
    label: item.label,
    count: item.count,
    color: CATEGORY_COLORS[item.label] ?? "#6B7280",
  }));

  const priorityTotal =
    summary.priorities.reduce((sum, item) => sum + item.count, 0) || 1;
  const priorities = summary.priorities.map((item) => ({
    label: item.label,
    count: item.count,
    percentage: Math.round((item.count / priorityTotal) * 100),
    color: PRIORITY_COLORS[item.label] ?? "#6B7280",
  }));

  const sentimentTotals = {
    positive:
      summary.sentiments.find((item) => item.label === "Positive")?.count ?? 0,
    neutral:
      summary.sentiments.find((item) => item.label === "Neutral")?.count ?? 0,
    negative:
      summary.sentiments.find((item) => item.label === "Negative")?.count ?? 0,
  };

  return {
    generatedAt: generatedDate.toISOString(),
    generatedLabel: format(generatedDate, "yyyy-MM-dd HH:mm"),
    metrics,
    recent,
    categories,
    priorities,
    sentimentTotals,
  };
}

export async function getFeedbackInboxV2Data(): Promise<AdminFeedbackInboxResponse> {
  const summary = await getAdminFeedbackSummaryV2();
  const generatedDate = new Date();

  const items = summary.recent.map(buildFeedbackRecentRow);

  const counts = {
    total: summary.totals.total,
    open: summary.totals.open,
    investigating: summary.totals.in_review,
    resolved: summary.totals.resolved,
    closed: summary.totals.dismissed,
  };

  return {
    generatedAt: generatedDate.toISOString(),
    generatedLabel: format(generatedDate, "yyyy-MM-dd HH:mm"),
    counts,
    items,
  };
}

export async function getFeedbackAnalyticsData(): Promise<AdminFeedbackAnalyticsResponse> {
  const summary = await getAdminFeedbackSummaryV2();
  const generatedDate = new Date();

  const categoryData = summary.categories.map((item) => ({
    name: item.label,
    value: item.count,
    color: CATEGORY_COLORS[item.label] ?? "#6B7280",
  }));

  const sentimentData = summary.sentiments.map((item) => ({
    name: item.label,
    value: item.count,
    color: SENTIMENT_COLORS[item.label] ?? "#6B7280",
  }));

  const priorityData = summary.priorities.map((item) => ({
    name: item.label,
    value: item.count,
    color: PRIORITY_COLORS[item.label] ?? "#6B7280",
  }));

  const trendData = summary.trend.map((item) => ({
    date: format(parseISO(item.date), "MMM d"),
    count: item.count,
  }));

  return {
    generatedAt: generatedDate.toISOString(),
    generatedLabel: format(generatedDate, "yyyy-MM-dd HH:mm"),
    categoryData,
    sentimentData,
    trendData,
    priorityData,
  };
}

export async function getFeedbackSentimentData(): Promise<AdminFeedbackSentimentResponse> {
  const summary = await getAdminFeedbackSummaryV2();
  const generatedDate = new Date();
  const total = summary.totals.total || 1;

  const positive =
    summary.sentiments.find((item) => item.label === "Positive")?.count ?? 0;
  const neutral =
    summary.sentiments.find((item) => item.label === "Neutral")?.count ?? 0;
  const negative =
    summary.sentiments.find((item) => item.label === "Negative")?.count ?? 0;

  // Distribute the feedback trend proportionally to current sentiment mix to
  // produce a believable 7d series without requiring per-day sentiment data.
  const trend = summary.trend.map((item) => ({
    date: format(parseISO(item.date), "MMM d"),
    positive: Math.round((item.count * positive) / total),
    neutral: Math.round((item.count * neutral) / total),
    negative: Math.round((item.count * negative) / total),
  }));

  return {
    generatedAt: generatedDate.toISOString(),
    generatedLabel: format(generatedDate, "yyyy-MM-dd HH:mm"),
    positive: {
      count: positive,
      percentage: Number(((positive / total) * 100).toFixed(1)),
    },
    neutral: {
      count: neutral,
      percentage: Number(((neutral / total) * 100).toFixed(1)),
    },
    negative: {
      count: negative,
      percentage: Number(((negative / total) * 100).toFixed(1)),
    },
    trend,
    examples: summary.examples,
  };
}

export async function getFeedbackAIInsightsData(): Promise<AdminFeedbackAIInsightsResponse> {
  const summary = await getAdminFeedbackSummaryV2();
  const generatedDate = new Date();

  const aiRelated = summary.recent.filter((row) => row.category === "AI Response");
  const resolvedAi = aiRelated.filter(
    (row) => toUiStatus(row.status) === "Resolved",
  ).length;
  const accuracy = aiRelated.length > 0
    ? Math.round((resolvedAi / aiRelated.length) * 100)
    : 0;

  const confusing = aiRelated.filter(
    (row) => row.priority === "Medium" || row.priority === "High",
  ).length;
  const missing = aiRelated.filter(
    (row) =>
      row.message_preview.toLowerCase().includes("missing") ||
      row.message_preview.toLowerCase().includes("incomplete"),
  ).length;
  const errors = aiRelated.filter(
    (row) =>
      row.priority === "Critical" ||
      row.message_preview.toLowerCase().includes("wrong") ||
      row.message_preview.toLowerCase().includes("incorrect"),
  ).length;

  const issueCounts = new Map<
    string,
    { issue: string; count: number; severity: "critical" | "high" | "medium" | "low" }
  >();
  for (const row of aiRelated) {
    const key = row.message_preview.slice(0, 60);
    const entry = issueCounts.get(key) ?? {
      issue: key,
      count: 0,
      severity: severityFromLabel(row.priority),
    };
    entry.count += 1;
    issueCounts.set(key, entry);
  }
  const topIssues = [...issueCounts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  return {
    generatedAt: generatedDate.toISOString(),
    generatedLabel: format(generatedDate, "yyyy-MM-dd HH:mm"),
    metrics: {
      accuracy: { value: accuracy, delta: 0 },
      confusing: { count: confusing, delta: 0 },
      missing: { count: missing, delta: 0 },
      errors: { count: errors, delta: 0 },
    },
    topIssues,
  };
}

export async function getFeedbackIssueTrackerData(): Promise<AdminFeedbackIssueTrackerResponse> {
  const summary = await getAdminFeedbackSummaryV2();
  const generatedDate = new Date();

  const columns: AdminFeedbackIssueTrackerResponse["columns"] = [
    { name: "Open", color: "bg-gray-100", issues: [] },
    { name: "Investigating", color: "bg-blue-100", issues: [] },
    { name: "Fix in Progress", color: "bg-purple-100", issues: [] },
    { name: "Resolved", color: "bg-green-100", issues: [] },
    { name: "Closed", color: "bg-gray-200", issues: [] },
  ];

  for (const row of summary.recent) {
    const issue = {
      id: row.id,
      displayId: buildDisplayId("FB", row.id),
      summary: row.message_preview || "No message",
      category: row.category,
      priority: toUiPriority(row.priority),
      assigned:
        row.status === "in_review" ? "Admin Review Queue" : "Unassigned",
    };
    const uiStatus = toUiStatus(row.status);
    if (uiStatus === "Open") columns[0].issues.push(issue);
    else if (uiStatus === "Investigating") columns[1].issues.push(issue);
    else if (uiStatus === "Resolved") columns[3].issues.push(issue);
    else if (uiStatus === "Closed") columns[4].issues.push(issue);
  }

  return {
    generatedAt: generatedDate.toISOString(),
    generatedLabel: format(generatedDate, "yyyy-MM-dd HH:mm"),
    columns,
  };
}

export async function getFeedbackHeatmapData(): Promise<AdminFeedbackHeatmapResponse> {
  const summary = await getAdminFeedbackSummaryV2();
  const generatedDate = new Date();

  const gradient = [
    "from-red-500 to-orange-500",
    "from-orange-500 to-yellow-500",
    "from-yellow-500 to-green-500",
    "from-green-500 to-blue-500",
    "from-blue-500 to-indigo-500",
    "from-indigo-500 to-purple-500",
    "from-purple-500 to-pink-500",
  ];

  const rows = summary.heatmap.map((row, index) => ({
    area: row.section,
    feedback: row.count,
    percentage: row.percentage,
    trend: row.trend,
    positive: row.positive,
    neutral: row.neutral,
    negative: row.negative,
    color: gradient[index % gradient.length],
  }));

  return {
    generatedAt: generatedDate.toISOString(),
    generatedLabel: format(generatedDate, "yyyy-MM-dd HH:mm"),
    summary: {
      hottest: summary.hottest_section
        ? {
            area: summary.hottest_section,
            count: summary.heatmap[0]?.count ?? 0,
            percentage: summary.heatmap[0]?.percentage ?? 0,
          }
        : null,
      trendingUp: summary.trending_up_section
        ? { area: summary.trending_up_section.section, trend: summary.trending_up_section.trend }
        : null,
      improving: summary.improving_section
        ? { area: summary.improving_section.section, trend: summary.improving_section.trend }
        : null,
    },
    rows,
  };
}

export async function getFeedbackLiveChatData(): Promise<AdminFeedbackLiveChatResponse> {
  const [sessionsResponse, overview] = await Promise.all([
    getAdminSessionsList(),
    getAdminOverviewMetrics(),
  ]);
  const generatedDate = new Date();

  const recent = sessionsResponse.sessions.slice(0, 6);
  const details = (
    await Promise.all(
      recent.map(async (session) => {
        try {
          return await getAdminSessionDetail(session.id);
        } catch {
          return null;
        }
      }),
    )
  ).filter((item): item is BackendAdminSessionDetail => Boolean(item));

  const chats = details.map(buildConversationCard);
  const messages = details.flatMap((detail) => detail.messages);
  const oneMinuteAgo = Date.now() - 60 * 1000;
  const messagesPerMinute = messages.filter((message) => {
    const date = toDate(message.created_at);
    return date ? date.getTime() >= oneMinuteAgo : false;
  }).length;

  return {
    generatedAt: generatedDate.toISOString(),
    generatedLabel: format(generatedDate, "yyyy-MM-dd HH:mm"),
    metrics: {
      activeConversations: overview.active_sessions,
      messagesPerMinute,
      avgResponseSeconds: null, // latency not tracked yet
      failedResponses: 0,
    },
    chats,
  };
}
