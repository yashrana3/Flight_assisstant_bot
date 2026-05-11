export type BackendFeedbackStatus = "new" | "in_review" | "resolved" | "dismissed";
export type UiFeedbackStatus = "Open" | "Investigating" | "Resolved" | "Closed";
export type UiFeedbackPriority = "Critical" | "High" | "Medium" | "Low";

export type BackendAdminMetricsOverviewResponse = {
  total_searches: number;
  active_sessions: number;
  feedback_counts: Partial<Record<BackendFeedbackStatus, number>>;
};

export type BackendAdminSessionSummary = {
  id: string;
  user_id: string | null;
  created_at: string | null;
  updated_at: string | null;
  message_count: number;
  last_message_preview: string | null;
};

export type BackendAdminSessionMessage = {
  id: string;
  role: string;
  content: string;
  created_at: string | null;
};

export type BackendAdminSessionDetail = {
  id: string;
  user_id: string | null;
  created_at: string | null;
  updated_at: string | null;
  messages: BackendAdminSessionMessage[];
};

export type BackendAdminSessionsResponse = {
  sessions: BackendAdminSessionSummary[];
};

export type BackendAdminAuthUser = {
  id: string;
  username: string;
  email: string | null;
  fullName: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type BackendAdminAuthSessionResponse = {
  accessToken: string;
  expiresInSeconds: number;
  admin: BackendAdminAuthUser;
};

export type BackendAdminAuthMeResponse = {
  admin: BackendAdminAuthUser;
};

export type BackendAdminSetupStatusResponse = {
  needsSetup: boolean;
};

export type BackendAdminUsersResponse = {
  admins: BackendAdminAuthUser[];
};

export type BackendAdminFeedbackSummary = {
  id: string;
  created_at: string | null;
  name: string | null;
  email: string | null;
  status: BackendFeedbackStatus | string;
  message_preview: string;
};

export type BackendAdminFeedbackContextMessage = {
  role: string;
  content: string;
  created_at: string | null;
};

export type BackendAdminFeedbackDetail = {
  id: string;
  created_at: string | null;
  updated_at: string | null;
  name: string | null;
  email: string | null;
  status: BackendFeedbackStatus | string;
  message: string;
  context_chat?: BackendAdminFeedbackContextMessage[] | null;
  context_flights?: unknown;
  context_page?: unknown;
};

export type BackendAdminFeedbackResponse = {
  feedback: BackendAdminFeedbackSummary[];
};

export type AdminMetricCard = {
  id: string;
  label: string;
  value: string;
  description: string;
  icon: "search" | "sessions" | "feedback" | "open" | "resolved" | "users" | "messages";
  tone: "blue" | "purple" | "green" | "orange" | "red";
};

export type AdminTrendPoint = {
  label: string;
  sessions: number;
  feedback: number;
};

export type AdminFeedbackItem = {
  id: string;
  displayId: string;
  submittedAt: string | null;
  submittedLabel: string;
  relativeSubmitted: string;
  name: string;
  email: string;
  messagePreview: string;
  message: string | null;
  status: UiFeedbackStatus;
  backendStatus: BackendFeedbackStatus;
  category: string;
  priority: UiFeedbackPriority;
  assignedTo: string;
};

export type AdminFeedbackDetailItem = AdminFeedbackItem & {
  updatedAt: string | null;
  updatedLabel: string | null;
  contextChat: BackendAdminFeedbackContextMessage[];
  contextFlights?: unknown;
  contextPage?: unknown;
};

export type AdminSessionItem = {
  id: string;
  displayId: string;
  userId: string | null;
  userLabel: string;
  createdAt: string | null;
  updatedAt: string | null;
  updatedLabel: string;
  relativeUpdated: string;
  messageCount: number;
  lastMessagePreview: string;
  status: "Active" | "Idle";
};

export type AdminConversationMessage = {
  id: string;
  role: string;
  content: string;
  createdAt: string | null;
  timeLabel: string;
};

export type AdminConversationCard = {
  id: string;
  displayId: string;
  userLabel: string;
  userId: string | null;
  status: "Active" | "Idle";
  messageCount: number;
  lastUpdated: string | null;
  lastUpdatedLabel: string;
  lastMessagePreview: string;
  messages: AdminConversationMessage[];
};

export type AdminAuthUser = {
  id: string;
  username: string;
  email: string | null;
  fullName: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type AdminAuthMeResponse = {
  admin: AdminAuthUser;
};

export type AdminSetupStatusResponse = {
  needsSetup: boolean;
};

export type AdminUsersListResponse = {
  admins: AdminAuthUser[];
};

export type AdminOverviewResponse = {
  generatedAt: string;
  generatedLabel: string;
  metrics: AdminMetricCard[];
  trend: AdminTrendPoint[];
  feedbackBreakdown: { status: UiFeedbackStatus; count: number }[];
  recentSessions: AdminSessionItem[];
  recentFeedback: AdminFeedbackItem[];
};

export type AdminFeedbackSummaryResponse = {
  generatedAt: string;
  generatedLabel: string;
  metrics: AdminMetricCard[];
  trend: { label: string; feedback: number }[];
  recentFeedback: AdminFeedbackItem[];
  categoryBreakdown: { label: string; count: number }[];
  priorityBreakdown: { label: UiFeedbackPriority; count: number }[];
  statusBreakdown: { label: UiFeedbackStatus; count: number }[];
};

export type AdminFeedbackListResponse = {
  generatedAt: string;
  generatedLabel: string;
  counts: { total: number; open: number; investigating: number; resolved: number; closed: number };
  items: AdminFeedbackItem[];
};

export type AdminRealtimeResponse = {
  generatedAt: string;
  generatedLabel: string;
  metrics: {
    activeSessions: number;
    loadedSessions: number;
    activeChats: number;
    messagesLastHour: number;
    avgMessagesPerConversation: number;
    authenticatedUsers: number;
    guestSessions: number;
  };
  systemHealth: {
    apiHealthStatus: "operational" | "degraded" | "down";
    apiLatencyMs: number | null;
    errorRatePct: number | null;
    uptimePct: number | null;
    endpointStatuses: Array<{
      name: string;
      status: "operational" | "degraded" | "down";
      responseTimeMs: number | null;
      errorRatePct: number | null;
      uptimePct: number | null;
    }>;
  };
  sessionChart: { label: string; messages: number }[];
  activityFeed: {
    id: string;
    action: string;
    userLabel: string;
    relativeTime: string;
    status: "Active" | "Idle";
  }[];
  activeChats: AdminConversationCard[];
};

export type BackendAdminDistributionItem = {
  label: string;
  count: number;
};

export type BackendAdminAnalyticsUserRow = {
  id: string;
  name: string;
  email: string;
  nationality: string | null;
  gender: string | null;
  role: string;
  status: string;
  created_at: string | null;
  last_active_at: string | null;
  session_count: number;
  message_count: number;
  search_count: number;
  trip_count: number;
  conversion_count?: number;
  alert_count: number;
  feedback_count: number;
  age?: number | null;
  profile_completion: number;
  engagement_score: number;
  cabin_class: string | null;
  seat_preference: string | null;
  flight_timing: string | null;
};

export type BackendAdminUsersAnalyticsResponse = {
  generated_at: string;
  totals: {
    total_users: number;
    active_users_last_30d: number;
    inactive_users_last_30d: number;
    new_users_last_7d: number;
    new_users_last_30d: number;
    users_with_feedback: number;
    users_with_trips: number;
    users_with_alerts: number;
    authenticated_sessions: number;
    guest_sessions: number;
    avg_searches_per_user: number;
    avg_messages_per_session: number;
    /** Mean chat messages attributed to registered users (from session aggregates). */
    avg_messages_per_user?: number;
    avg_sessions_per_user: number;
    messages_last_24h: number;
    total_searches: number;
    total_options?: number;
    redirect_messages: number;
    distinct_search_routes?: number;
  };
  growth_7d: Array<{
    date: string;
    new_users: number;
    active_users: number;
    sessions: number;
    searches: number;
  }>;
  distributions: {
    countries: BackendAdminDistributionItem[];
    genders: BackendAdminDistributionItem[];
    roles: BackendAdminDistributionItem[];
    statuses: BackendAdminDistributionItem[];
    cabin_classes: BackendAdminDistributionItem[];
    seat_preferences: BackendAdminDistributionItem[];
    flight_timings: BackendAdminDistributionItem[];
  };
  top_prompts: BackendAdminDistributionItem[];
  top_routes: BackendAdminDistributionItem[];
  top_search_routes?: BackendAdminDistributionItem[];
  users: BackendAdminAnalyticsUserRow[];
  age_distribution?: Array<{ range: string; count: number }>;
  aggregate_profile?: {
    avg_completion_pct: number;
    travel_prefs_pct: number;
    travel_prefs_users: number;
    completed_profiles_count: number;
  };
  /** Top users by engagement score (full user list, not limited to table page). */
  power_users?: BackendAdminAnalyticsUserRow[];
};

export type BackendAdminFunnelResponse = {
  generated_at: string;
  stages: Array<{
    key: string;
    label: string;
    count: number;
    percentage: number;
  }>;
  drop_offs: Array<{
    from_key: string;
    to_key: string;
    from_label: string;
    to_label: string;
    drop_count: number;
    drop_percentage: number;
  }>;
  trend_7d: Array<{
    date: string;
    conversations: number;
    searches: number;
    options: number;
    redirects: number;
    trips: number;
  }>;
  top_routes: BackendAdminDistributionItem[];
  top_search_routes?: BackendAdminDistributionItem[];
  top_prompts: BackendAdminDistributionItem[];
};

export type BackendAdminBehaviorResponse = {
  generated_at: string;
  totals: {
    session_count: number;
    active_sessions: number;
    authenticated_sessions: number;
    guest_sessions: number;
    avg_searches_per_session: number;
    avg_messages_per_session: number;
    avg_session_duration_seconds: number;
    messages_last_24h: number;
  };
  search_distribution: BackendAdminDistributionItem[];
  message_distribution: BackendAdminDistributionItem[];
  session_duration_distribution: BackendAdminDistributionItem[];
  hourly_activity: Array<{
    label: string;
    sessions: number;
    messages: number;
    searches: number;
  }>;
  top_prompts: BackendAdminDistributionItem[];
  top_routes: BackendAdminDistributionItem[];
  top_search_routes?: BackendAdminDistributionItem[];
  recent_activity: Array<{
    session_id: string;
    user_id: string | null;
    updated_at: string | null;
    message_count: number;
    search_count: number;
    last_message_preview: string;
    status: "Active" | "Idle";
  }>;
};

export type AdminUsersTableItem = {
  id: string;
  displayId: string;
  name: string;
  email: string;
  country: string;
  age: number | null;
  preferredClass: string;
  searches: number;
  conversions: number;
  joinDateLabel: string;
  lastActiveDateLabel: string;
  statusTone: "active" | "inactive";
  nationality: string;
  gender: string;
  role: string;
  status: string;
  joinedLabel: string;
  lastActiveLabel: string;
  sessionCount: number;
  messageCount: number;
  searchCount: number;
  tripCount: number;
  alertCount: number;
  feedbackCount: number;
  profileCompletion: number;
  engagementScore: number;
  cabinClass: string;
  seatPreference: string;
  flightTiming: string;
};

export type AdminUsersKpiCard = {
  id: string;
  title: string;
  value: string;
  change: string;
  trend: "up" | "down" | "flat";
  sparkline: Array<{ value: number }>;
  stroke: string;
};

export type AdminUsersPageResponse = {
  generatedAt: string;
  generatedLabel: string;
  /** Total registered users (for pagination copy). */
  totalUserCount: number;
  metrics: AdminMetricCard[];
  kpiCards: AdminUsersKpiCard[];
  growthTrend: Array<{
    label: string;
    newUsers: number;
    activeUsers: number;
    sessions: number;
    searches: number;
  }>;
  ageDistribution: Array<{ range: string; count: number }>;
  profileSummary: {
    avgCompletionPct: number;
    travelPrefsPct: number;
    travelPrefsUsers: number;
    completedProfilesCount: number;
    onboardingNote: string;
  };
  engagementOverTime: Array<{ label: string; searches: number; chats: number }>;
  sessionDuration: Array<{ duration: string; users: number }>;
  conversionSummary: {
    redirectRatePct: number;
    searchToRedirectPct: number;
    avgChatsPerUser: number;
    avgFlightPriceLabel: string;
  };
  deviceNote: string;
  powerUsers: AdminUsersTableItem[];
  distributions: {
    countries: BackendAdminDistributionItem[];
    genders: BackendAdminDistributionItem[];
    cabinClasses: BackendAdminDistributionItem[];
    seatPreferences: BackendAdminDistributionItem[];
    flightTimings: BackendAdminDistributionItem[];
  };
  topPrompts: BackendAdminDistributionItem[];
  topRoutes: BackendAdminDistributionItem[];
  topSearchRoutes: BackendAdminDistributionItem[];
  users: AdminUsersTableItem[];
};

export type AdminGrowthPageResponse = {
  generatedAt: string;
  generatedLabel: string;
  metrics: AdminMetricCard[];
  growthTrend: Array<{
    label: string;
    users: number;
    activeUsers: number;
    sessions: number;
    searches: number;
    redirects: number;
  }>;
  acquisitionBreakdown: BackendAdminDistributionItem[];
  funnelStages: Array<{
    label: string;
    count: number;
    percentage: number;
  }>;
  /** Saved trips in user DB (origin → destination). */
  topRoutes: BackendAdminDistributionItem[];
  /** Routes inferred from flight search assistant payloads in chat. */
  topSearchRoutes: BackendAdminDistributionItem[];
  topPrompts: BackendAdminDistributionItem[];
};

export type AdminFunnelPageResponse = {
  generatedAt: string;
  generatedLabel: string;
  metrics: AdminMetricCard[];
  stages: Array<{
    key: string;
    label: string;
    count: number;
    percentage: number;
  }>;
  trend: Array<{
    label: string;
    conversations: number;
    searches: number;
    redirects: number;
    trips: number;
  }>;
  dropOffs: Array<{
    id: string;
    label: string;
    dropCount: number;
    dropPercentage: number;
  }>;
  topRoutes: BackendAdminDistributionItem[];
  topPrompts: BackendAdminDistributionItem[];
};

// ── New shapes powering the Figma-parity pages ─────────────────────

export type BackendAdminAiPerformanceResponse = {
  generated_at: string;
  model_config: {
    provider: string;
    model: string;
    temperature: number;
    max_tokens: number;
    prompt_version: string;
    response_style: string;
  };
  kpis: {
    total_conversations: number;
    avg_messages: number;
    engaged_sessions: number;
    drop_off_rate: number;
    messages_last_24h: number;
    authenticated_sessions: number;
    guest_sessions: number;
    avg_response_time_ms: number | null;
    p95_response_time_ms: number | null;
    success_rate: number;
  };
  question_intents: Array<{
    intent: string;
    count: number;
    percentage: number;
    color: string;
  }>;
  quality: {
    successful: { count: number; percentage: number };
    partial: { count: number; percentage: number };
    failed: { count: number; percentage: number };
    out_of_context: { count: number; percentage: number };
  };
  hourly_load: Array<{
    time: string;
    requests: number;
    concurrent: number;
    searches: number;
  }>;
  conversion_funnel: Array<{
    stage: string;
    value: number;
    percentage: number;
  }>;
  flagged_responses: Array<{
    category: string;
    count: number;
    severity: string;
    example: string;
    status: string;
  }>;
  top_prompts: BackendAdminDistributionItem[];
};

export type BackendAdminFeedbackSummaryV2Response = {
  generated_at: string;
  totals: {
    total: number;
    new_today: number;
    open: number;
    in_review: number;
    resolved: number;
    dismissed: number;
    ai_related: number;
    avg_response_seconds: number | null;
  };
  categories: BackendAdminDistributionItem[];
  priorities: BackendAdminDistributionItem[];
  statuses: BackendAdminDistributionItem[];
  sentiments: BackendAdminDistributionItem[];
  sections: BackendAdminDistributionItem[];
  trend: Array<{ date: string; count: number }>;
  heatmap: Array<{
    section: string;
    count: number;
    percentage: number;
    trend: number;
    positive: number;
    neutral: number;
    negative: number;
  }>;
  hottest_section: string | null;
  trending_up_section: {
    section: string;
    trend: number;
  } | null;
  improving_section: {
    section: string;
    trend: number;
  } | null;
  recent: Array<{
    id: string;
    email: string | null;
    name: string | null;
    message_preview: string;
    category: string;
    priority: string;
    status: string;
    sentiment: string;
    section: string;
    created_at: string | null;
  }>;
  examples: {
    positive: string[];
    neutral: string[];
    negative: string[];
  };
};

export type BackendAdminRetentionResponse = {
  generated_at: string;
  cohorts: {
    day_1: { cohort: number; retained: number; rate: number };
    day_7: { cohort: number; retained: number; rate: number };
    day_30: { cohort: number; retained: number; rate: number };
  };
  returning_users: { count: number; percentage: number };
  session_split: { authenticated: number; guest: number; total: number };
};

export type BackendAdminApiMonitoringResponse = {
  generated_at: string;
  window?: string;
  totals: {
    total_requests: number;
    avg_latency_ms: number;
    error_rate_pct: number;
    uptime_pct: number;
    active_endpoints: number;
    total_endpoints: number;
  };
  endpoint_rows: Array<{
    id: string;
    name: string;
    provider: string;
    endpoint: string;
    status: "healthy" | "slow" | "error";
    requests24h: number;
    avgResponseTimeMs: number;
    p95Ms: number;
    p99Ms: number;
    errorRatePct: number;
    uptimePct: number;
  }>;
  request_volume: Array<{ label: string; requests: number }>;
  error_rate_trend: Array<{ label: string; rate: number }>;
  provider_usage: Array<{ provider: string; requests: number }>;
  external_provider_usage: Array<{
    provider: string;
    requestsWindow: number;
    requests24h: number;
    successWindow: number;
    failedWindow: number;
    monthlyRequests: number;
    quota: number;
    percentUsed: number;
    remaining: number;
    keyName: string | null;
    status: string;
    lastUsed: string | null;
    keyLast4?: string | null;
    costPerRequest: number;
    monthlyCost: number;
    currency: string;
  }>;
  success_failed: { success: number; failed: number };
  api_keys: Array<{
    provider: string;
    keyName: string;
    status: string;
    lastUsed: string | null;
    keyLast4?: string | null;
    requests24h: number;
    quotaDaily?: number;
    costPerRequest?: number;
    currency?: string;
  }>;
  rate_limits: Array<{
    provider: string;
    used: number;
    quota: number;
    percentUsed: number;
  }>;
  cost_monitoring: {
    currency: string;
    total_monthly_cost: number;
    avg_cost_per_request: number;
    monthly_breakdown: Array<{
      provider: string;
      requests: number;
      costPerRequest: number;
      monthlyCost: number;
    }>;
  };
  recent_errors: Array<{
    id: string;
    endpoint: string;
    timestamp: string | null;
    error: string;
    statusCode: number;
  }>;
};

// ── Rich page response shapes used by the Figma-parity React components ──

export type AdminPlatformMetricCard = {
  id: string;
  title: string;
  value: string;
  raw: number;
  trend: "up" | "down" | "flat";
  change: string;
  sparkline: number[];
  color: "blue" | "purple" | "green" | "emerald" | "orange" | "red" | "indigo";
  description: string;
};

export type AdminInlineMetric = {
  id: string;
  title: string;
  value: string;
  trend: "up" | "down" | "flat";
  change: string;
  description?: string;
};

export type AdminOverviewPageResponse = {
  generatedAt: string;
  generatedLabel: string;
  platformMetrics: AdminPlatformMetricCard[];
  aiMetrics: AdminInlineMetric[];
  searchMetrics: AdminInlineMetric[];
  redirectMetrics: AdminInlineMetric[];
  retentionMetrics: Array<{
    id: string;
    title: string;
    value: string;
    trend: "up" | "down" | "flat";
    change: string;
    color: "blue" | "purple" | "green" | "orange";
  }>;
  realTimeMetrics: Array<{
    id: string;
    title: string;
    value: string;
    subtitle: string;
    icon: "eye" | "users" | "messages" | "redirect";
    color: "blue" | "purple" | "green" | "orange";
  }>;
  systemSnapshot: Array<{
    id: string;
    title: string;
    value: string;
    trend: "up" | "down" | "flat";
    change: string;
    disabled?: boolean;
  }>;
  growthTrend: Array<{
    date: string;
    visitors: number;
    searches: number;
    redirects: number;
  }>;
  topRoutes: Array<{ id: string; route: string; searches: number; trend: "up" | "down" }>;
  topAirlines: Array<{ id: string; airline: string; searches: number; percentage: number }>;
  insights: Array<{
    id: string;
    title: string;
    description: string;
    impact: "positive" | "warning";
    metric: string;
  }>;
};

export type AdminFunnelStage = {
  id: string;
  name: string;
  count: number;
  percentage: number;
  color: string;
  bgColor: string;
  avgTime: string;
  dropOff?: number;
};

export type AdminFunnelSegment = {
  name: string;
  conversion: number;
  users: number;
  color: string;
};

export type AdminFunnelPageV2Response = {
  generatedAt: string;
  generatedLabel: string;
  stages: AdminFunnelStage[];
  conversionTrend: Array<{
    date: string;
    conversion: number;
    aiEngagement: number;
    searchRate: number;
  }>;
  countrySegments: AdminFunnelSegment[];
  registeredVsGuest: AdminFunnelSegment[];
  timeMetrics: Array<{
    time: string;
    aiStart: number;
    search: number;
    options: number;
    redirect: number;
  }>;
  pathAnalysis: Array<{
    path: string;
    count: number;
    percentage: number;
  }>;
  dropOffPoints: Array<{
    stage: string;
    dropOff: number;
    count: number;
    reason: string;
  }>;
  stageDetails: Record<
    string,
    {
      metrics: Array<{ label: string; value: string; color: string }>;
      listTitle: string;
      listItems: Array<{ label: string; value: number }>;
    }
  >;
  topRoutes: BackendAdminDistributionItem[];
  topPrompts: BackendAdminDistributionItem[];
};

export type AdminAIPerformancePageResponse = {
  generatedAt: string;
  generatedLabel: string;
  modelConfig: {
    provider: string;
    model: string;
    temperature: number;
    maxTokens: number;
    promptVersion: string;
    responseStyle: string;
  };
  kpis: {
    totalConversations: AdminInlineMetric;
    avgMessages: AdminInlineMetric;
    responseTime: AdminInlineMetric;
    successRate: AdminInlineMetric;
    dropOffRate: AdminInlineMetric;
  };
  questionIntents: Array<{
    intent: string;
    count: number;
    percentage: number;
    color: string;
  }>;
  quality: {
    successful: { count: number; percentage: number };
    partial: { count: number; percentage: number };
    failed: { count: number; percentage: number };
    outOfContext: { count: number; percentage: number };
  };
  hourlyLoad: Array<{
    time: string;
    requests: number;
    concurrent: number;
    searches: number;
  }>;
  conversionFunnel: Array<{
    stage: string;
    value: number;
    percentage: number;
  }>;
  flaggedResponses: Array<{
    category: string;
    count: number;
    severity: "critical" | "high" | "medium" | "low";
    example: string;
    status: string;
  }>;
  insights: Array<{
    id: string;
    title: string;
    description: string;
    impact: "high" | "medium";
    metric: string;
    icon: "message" | "target" | "chart" | "zap" | "calendar";
  }>;
  latencyNotice: string;
};

export type AdminFeedbackRecentRow = {
  id: string;
  displayId: string;
  email: string;
  name: string;
  category: string;
  priority: UiFeedbackPriority;
  status: UiFeedbackStatus;
  backendStatus: BackendFeedbackStatus;
  sentiment: "Positive" | "Neutral" | "Negative";
  section: string;
  submittedLabel: string;
  relativeSubmitted: string;
  messagePreview: string;
};

export type AdminFeedbackDashboardResponse = {
  generatedAt: string;
  generatedLabel: string;
  metrics: Array<{
    id: string;
    title: string;
    value: string;
    change: number;
    icon: "messages" | "trend-up" | "alert" | "check" | "clock" | "sparkles";
    iconColor: string;
    iconBgColor: string;
  }>;
  recent: AdminFeedbackRecentRow[];
  categories: Array<{ label: string; count: number; color: string }>;
  priorities: Array<{ label: string; count: number; percentage: number; color: string }>;
  sentimentTotals: { positive: number; neutral: number; negative: number };
};

export type AdminFeedbackInboxResponse = {
  generatedAt: string;
  generatedLabel: string;
  counts: {
    total: number;
    open: number;
    investigating: number;
    resolved: number;
    closed: number;
  };
  items: AdminFeedbackRecentRow[];
};

export type AdminFeedbackAnalyticsResponse = {
  generatedAt: string;
  generatedLabel: string;
  categoryData: Array<{ name: string; value: number; color: string }>;
  sentimentData: Array<{ name: string; value: number; color: string }>;
  trendData: Array<{ date: string; count: number }>;
  priorityData: Array<{ name: string; value: number; color: string }>;
};

export type AdminFeedbackSentimentResponse = {
  generatedAt: string;
  generatedLabel: string;
  positive: { count: number; percentage: number };
  neutral: { count: number; percentage: number };
  negative: { count: number; percentage: number };
  trend: Array<{ date: string; positive: number; neutral: number; negative: number }>;
  examples: {
    positive: string[];
    neutral: string[];
    negative: string[];
  };
};

export type AdminFeedbackAIInsightsResponse = {
  generatedAt: string;
  generatedLabel: string;
  metrics: {
    accuracy: { value: number; delta: number };
    confusing: { count: number; delta: number };
    missing: { count: number; delta: number };
    errors: { count: number; delta: number };
  };
  topIssues: Array<{
    issue: string;
    count: number;
    severity: "critical" | "high" | "medium" | "low";
  }>;
};

export type AdminFeedbackIssueTrackerResponse = {
  generatedAt: string;
  generatedLabel: string;
  columns: Array<{
    name: "Open" | "Investigating" | "Fix in Progress" | "Resolved" | "Closed";
    color: string;
    issues: Array<{
      id: string;
      displayId: string;
      summary: string;
      category: string;
      priority: UiFeedbackPriority;
      assigned: string;
    }>;
  }>;
};

export type AdminFeedbackHeatmapResponse = {
  generatedAt: string;
  generatedLabel: string;
  summary: {
    hottest: { area: string; count: number; percentage: number } | null;
    trendingUp: { area: string; trend: number } | null;
    improving: { area: string; trend: number } | null;
  };
  rows: Array<{
    area: string;
    feedback: number;
    percentage: number;
    trend: number;
    positive: number;
    neutral: number;
    negative: number;
    color: string;
  }>;
};

export type AdminFeedbackLiveChatResponse = {
  generatedAt: string;
  generatedLabel: string;
  metrics: {
    activeConversations: number;
    messagesPerMinute: number;
    avgResponseSeconds: number | null;
    failedResponses: number;
  };
  chats: AdminConversationCard[];
};

export type AdminBehaviorPageResponse = {
  generatedAt: string;
  generatedLabel: string;
  metrics: AdminMetricCard[];
  searchDistribution: BackendAdminDistributionItem[];
  messageDistribution: BackendAdminDistributionItem[];
  sessionDurationDistribution: BackendAdminDistributionItem[];
  activityTrend: Array<{
    label: string;
    sessions: number;
    messages: number;
    searches: number;
  }>;
  topRoutes: BackendAdminDistributionItem[];
  topPrompts: BackendAdminDistributionItem[];
  recentActivity: Array<{
    id: string;
    displayId: string;
    userLabel: string;
    updatedLabel: string;
    messageCount: number;
    searchCount: number;
    status: "Active" | "Idle";
    lastMessagePreview: string;
  }>;
};

export type AdminRetentionPageResponse = {
  generatedAt: string;
  generatedLabel: string;
  metrics: AdminMetricCard[];
  cohorts: Array<{
    label: string;
    cohort: number;
    retained: number;
    rate: number;
    color: string;
  }>;
  sessionSplit: Array<{
    label: string;
    count: number;
    percentage: number;
    color: string;
  }>;
  returningUsers: {
    count: number;
    percentage: number;
    description: string;
  };
  retentionTrend: Array<{
    label: string;
    rate: number;
  }>;
  notes: string[];
};

export type AdminApiMonitoringResponse = {
  generatedAt: string;
  generatedLabel: string;
  kpis: Array<{
    id: string;
    label: string;
    value: string;
    change: string;
    trend: "up" | "down" | "flat";
    tone: "blue" | "purple" | "green" | "orange" | "red";
    sparkline: Array<{ label: string; value: number }>;
  }>;
  endpointRows: Array<{
    id: string;
    name: string;
    provider: string;
    endpoint: string;
    status: "healthy" | "slow" | "error";
    requests24h: number;
    avgResponseTimeMs: number;
    p95Ms: number;
    p99Ms: number;
    errorRatePct: number;
    uptimePct: number;
  }>;
  requestVolume: Array<{ label: string; requests: number }>;
  errorRateTrend: Array<{ label: string; rate: number }>;
  providerUsage: Array<{ provider: string; requests: number; color: string }>;
  externalProviderUsage: Array<{
    provider: string;
    label: string;
    description: string;
    requestsWindow: number;
    requests24h: number;
    successWindow: number;
    failedWindow: number;
    monthlyRequests: number;
    quota: number;
    percentUsed: number;
    remaining: number;
    keyName: string | null;
    status: string;
    lastUsed: string | null;
    keyLast4?: string | null;
    costPerRequest: number;
    monthlyCost: number;
    currency: string;
    color: string;
  }>;
  successFailed: { success: number; failed: number };
  apiKeys: Array<{
    provider: string;
    keyName: string;
    status: string;
    lastUsed: string | null;
    keyLast4?: string | null;
    requests24h: number;
    quotaDaily?: number;
    remainingToday?: number;
    costPerRequest?: number;
    currency?: string;
  }>;
  rateLimits: Array<{
    provider: string;
    used: number;
    quota: number;
    percentUsed: number;
  }>;
  costMonitoring: {
    currency: string;
    totalMonthlyCost: number;
    avgCostPerRequest: number;
    monthlyBreakdown: Array<{
      provider: string;
      requests: number;
      costPerRequest: number;
      monthlyCost: number;
    }>;
  };
  activeAlerts: Array<{
    id: string;
    type: "warning" | "error" | "info";
    title: string;
    message: string;
    time: string;
  }>;
  errorLogs: Array<{
    id: string;
    endpoint: string;
    timestamp: string;
    error: string;
    statusCode: number;
  }>;
};
