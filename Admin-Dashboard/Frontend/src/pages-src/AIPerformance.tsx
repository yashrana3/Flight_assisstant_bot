"use client";

import {
  AlertTriangle,
  BarChart3,
  Calendar,
  CheckCircle,
  Clock,
  Lightbulb,
  MessageSquare,
  PieChart as PieIcon,
  RefreshCw,
  Settings,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  XCircle,
  Zap,
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
import type { AdminAIPerformancePageResponse } from "@/lib/admin-types";
import { useAdminData } from "@/lib/use-admin-data";

const insightIconMap = {
  message: MessageSquare,
  target: Target,
  chart: BarChart3,
  zap: Zap,
  calendar: Calendar,
} as const;

const severityToneMap: Record<string, string> = {
  critical: "bg-red-50 text-red-700 border-red-200",
  high: "bg-orange-50 text-orange-700 border-orange-200",
  medium: "bg-yellow-50 text-yellow-700 border-yellow-200",
  low: "bg-gray-50 text-gray-700 border-gray-200",
};

export function AIPerformance() {
  const { data, loading, error, refresh } =
    useAdminData<AdminAIPerformancePageResponse>("/api/admin/ai/performance");

  if (loading && !data) {
    return <PageLoader />;
  }

  const total =
    (data?.quality.successful.count ?? 0) +
    (data?.quality.partial.count ?? 0) +
    (data?.quality.failed.count ?? 0) +
    (data?.quality.outOfContext.count ?? 0) || 1;

  const qualityPieData = data
    ? [
        {
          name: "Successful",
          value: data.quality.successful.count,
          color: "#10B981",
        },
        {
          name: "Partial",
          value: data.quality.partial.count,
          color: "#F59E0B",
        },
        { name: "Failed", value: data.quality.failed.count, color: "#EF4444" },
        {
          name: "Out of context",
          value: data.quality.outOfContext.count,
          color: "#9CA3AF",
        },
      ]
    : [];

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-4 md:space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">
            AI Performance
          </h1>
          <p className="text-xs md:text-sm text-gray-600 mt-1">
            Live AI conversation KPIs, intent mix, quality heuristic and load
            — sourced from the chat DB.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
            Last updated: {data?.generatedLabel ?? "—"}
          </div>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-3 py-2 text-xs font-medium text-white hover:bg-purple-700"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="bg-white rounded-xl p-4 md:p-6 border border-gray-200 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <div className="p-2 bg-purple-100 rounded-lg">
            <Settings className="w-4 h-4 md:w-5 md:h-5 text-purple-600" />
          </div>
          <div>
            <h3 className="text-base md:text-lg font-semibold text-gray-900">
              AI Model Configuration
            </h3>
            <p className="text-xs text-gray-500">
              Read-only view of what the backend is currently configured with
              (env vars + prompt version).
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <ModelConfigCard label="Provider" value={data?.modelConfig.provider} />
          <ModelConfigCard label="Model" value={data?.modelConfig.model} />
          <ModelConfigCard
            label="Temperature"
            value={data?.modelConfig.temperature}
          />
          <ModelConfigCard
            label="Max tokens"
            value={data?.modelConfig.maxTokens}
          />
          <ModelConfigCard
            label="Prompt version"
            value={data?.modelConfig.promptVersion}
          />
          <ModelConfigCard
            label="Response style"
            value={data?.modelConfig.responseStyle}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 md:gap-6">
        {data
          ? [
              data.kpis.totalConversations,
              data.kpis.avgMessages,
              data.kpis.responseTime,
              data.kpis.successRate,
              data.kpis.dropOffRate,
            ].map((metric) => (
              <div
                key={metric.id}
                className="bg-white rounded-xl p-4 md:p-6 border border-gray-200 shadow-sm"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs md:text-sm text-gray-600">
                    {metric.title}
                  </span>
                  {metric.trend === "up" ? (
                    <TrendingUp className="w-3 h-3 text-green-600" />
                  ) : metric.trend === "down" ? (
                    <TrendingDown className="w-3 h-3 text-red-600" />
                  ) : null}
                </div>
                <div className="text-xl md:text-2xl font-bold text-gray-900">
                  {metric.value}
                </div>
                <p className="mt-2 text-[11px] text-gray-500">
                  {metric.change}
                </p>
              </div>
            ))
          : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <div className="bg-white rounded-xl p-4 md:p-6 border border-gray-200 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <PieIcon className="w-4 h-4 md:w-5 md:h-5 text-purple-600" />
            <h3 className="text-base md:text-lg font-semibold text-gray-900">
              Question Intent Analysis
            </h3>
          </div>
          {(data?.questionIntents ?? []).length === 0 ? (
            <p className="text-xs text-gray-500">
              No prompts captured yet. Intents will appear once users start
              chatting.
            </p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={data?.questionIntents ?? []}
                    dataKey="count"
                    nameKey="intent"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    label={(entry: { percent?: number }) =>
                      `${Math.round((entry.percent ?? 0) * 100)}%`
                    }
                  >
                    {data?.questionIntents.map((item) => (
                      <Cell key={item.intent} fill={item.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {data?.questionIntents.map((item) => (
                  <div
                    key={item.intent}
                    className="flex items-center gap-2 text-xs"
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="text-gray-700 flex-1 truncate">
                      {item.intent}
                    </span>
                    <span className="text-gray-500">{item.count}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="bg-white rounded-xl p-4 md:p-6 border border-gray-200 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle className="w-4 h-4 md:w-5 md:h-5 text-green-600" />
            <h3 className="text-base md:text-lg font-semibold text-gray-900">
              Conversation Quality
            </h3>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <QualityCard
              label="Successful"
              percentage={data?.quality.successful.percentage ?? 0}
              count={data?.quality.successful.count ?? 0}
              tone="bg-green-50 text-green-700 border-green-200"
              icon={<CheckCircle className="w-3.5 h-3.5" />}
            />
            <QualityCard
              label="Partial"
              percentage={data?.quality.partial.percentage ?? 0}
              count={data?.quality.partial.count ?? 0}
              tone="bg-yellow-50 text-yellow-700 border-yellow-200"
              icon={<Clock className="w-3.5 h-3.5" />}
            />
            <QualityCard
              label="Failed"
              percentage={data?.quality.failed.percentage ?? 0}
              count={data?.quality.failed.count ?? 0}
              tone="bg-red-50 text-red-700 border-red-200"
              icon={<XCircle className="w-3.5 h-3.5" />}
            />
            <QualityCard
              label="Out of context"
              percentage={data?.quality.outOfContext.percentage ?? 0}
              count={data?.quality.outOfContext.count ?? 0}
              tone="bg-gray-50 text-gray-700 border-gray-200"
              icon={<AlertTriangle className="w-3.5 h-3.5" />}
            />
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie
                data={qualityPieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={40}
                outerRadius={70}
                paddingAngle={2}
              >
                {qualityPieData.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => `${value} (${Math.round((Number(value) / total) * 100)}%)`} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white rounded-xl p-4 md:p-6 border border-gray-200 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Clock className="w-4 h-4 md:w-5 md:h-5 text-blue-600" />
          <div>
            <h3 className="text-base md:text-lg font-semibold text-gray-900">
              Hourly AI Load
            </h3>
            <p className="text-xs text-gray-500">
              Chat DB sessions, messages and flight searches grouped by hour of
              the day.
            </p>
          </div>
        </div>
        {(data?.hourlyLoad ?? []).length === 0 ? (
          <p className="text-xs text-gray-500">
            No hourly activity captured yet.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={data?.hourlyLoad ?? []}>
              <defs>
                <linearGradient id="reqGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="time" stroke="#9CA3AF" style={{ fontSize: 10 }} />
              <YAxis stroke="#9CA3AF" style={{ fontSize: 10 }} />
              <Tooltip
                contentStyle={{
                  fontSize: "11px",
                  borderRadius: "8px",
                  border: "1px solid #E5E7EB",
                }}
              />
              <Legend />
              <Area
                type="monotone"
                dataKey="requests"
                stroke="#3b82f6"
                fill="url(#reqGrad)"
                name="Messages"
              />
              <Area
                type="monotone"
                dataKey="concurrent"
                stroke="#8b5cf6"
                fillOpacity={0}
                name="Sessions"
              />
              <Area
                type="monotone"
                dataKey="searches"
                stroke="#10b981"
                fillOpacity={0}
                name="Searches"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <div className="bg-white rounded-xl p-4 md:p-6 border border-gray-200 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-4 h-4 md:w-5 md:h-5 text-green-600" />
            <h3 className="text-base md:text-lg font-semibold text-gray-900">
              AI Conversion Funnel
            </h3>
          </div>
          {(data?.conversionFunnel ?? []).length === 0 ? (
            <p className="text-xs text-gray-500">
              No funnel signals captured yet.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data?.conversionFunnel ?? []} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis type="number" stroke="#9CA3AF" style={{ fontSize: 10 }} />
                <YAxis
                  dataKey="stage"
                  type="category"
                  width={160}
                  stroke="#9CA3AF"
                  style={{ fontSize: 10 }}
                />
                <Tooltip />
                <Bar
                  dataKey="value"
                  fill="#8b5cf6"
                  radius={[0, 4, 4, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
          <p className="mt-2 text-[11px] text-gray-500">
            {data?.latencyNotice}
          </p>
        </div>

        <div className="bg-white rounded-xl p-4 md:p-6 border border-gray-200 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 md:w-5 md:h-5 text-red-600" />
            <h3 className="text-base md:text-lg font-semibold text-gray-900">
              Flagged Responses
            </h3>
          </div>
          <div className="space-y-3">
            {(data?.flaggedResponses ?? []).length === 0 ? (
              <p className="text-xs text-gray-500">
                No AI-related feedback flagged yet.
              </p>
            ) : null}
            {data?.flaggedResponses.map((item, idx) => (
              <div
                key={`${item.category}-${idx}`}
                className={`p-3 rounded-lg border ${severityToneMap[item.severity] ?? severityToneMap.medium}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold">
                    {item.category}
                  </span>
                  <span className="text-xs">
                    {item.count} report{item.count === 1 ? "" : "s"}
                  </span>
                </div>
                <p className="text-xs text-gray-700 line-clamp-2">
                  {item.example || "No example captured."}
                </p>
                <p className="text-[11px] text-gray-500 mt-1">
                  Status: {item.status}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl p-4 md:p-6 border border-gray-200 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Lightbulb className="w-4 h-4 md:w-5 md:h-5 text-yellow-600" />
          <h3 className="text-base md:text-lg font-semibold text-gray-900">
            AI Insights
          </h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(data?.insights ?? []).map((insight) => {
            const Icon = insightIconMap[insight.icon] ?? Sparkles;
            return (
              <div
                key={insight.id}
                className={`p-4 rounded-lg border ${
                  insight.impact === "high"
                    ? "bg-purple-50 border-purple-200"
                    : "bg-gray-50 border-gray-200"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`p-2 rounded-lg ${
                      insight.impact === "high"
                        ? "bg-purple-100 text-purple-600"
                        : "bg-gray-200 text-gray-600"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-sm font-semibold text-gray-900 mb-1">
                      {insight.title}
                    </h4>
                    <p className="text-xs md:text-sm text-gray-600 mb-2">
                      {insight.description}
                    </p>
                    <div className="inline-flex items-center gap-2 px-2 py-1 bg-white text-gray-700 rounded text-xs font-medium border border-gray-200">
                      <Target className="w-3 h-3" />
                      {insight.metric}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ModelConfigCard({
  label,
  value,
}: {
  label: string;
  value: string | number | undefined;
}) {
  return (
    <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
      <p className="text-[11px] text-gray-500 uppercase tracking-wide">
        {label}
      </p>
      <p className="text-sm font-semibold text-gray-900 mt-1 break-words">
        {value ?? "—"}
      </p>
    </div>
  );
}

function QualityCard({
  label,
  percentage,
  count,
  tone,
  icon,
}: {
  label: string;
  percentage: number;
  count: number;
  tone: string;
  icon: React.ReactNode;
}) {
  return (
    <div className={`p-3 rounded-lg border ${tone}`}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs font-semibold">{label}</span>
      </div>
      <div className="text-xl font-bold">{percentage}%</div>
      <div className="text-[11px] text-gray-500">{count} sessions</div>
    </div>
  );
}
