"use client";

import { useState } from "react";
import {
  Activity,
  BarChart3,
  Calendar,
  ChevronDown,
  ExternalLink,
  Eye,
  Filter,
  Lightbulb,
  MessageSquare,
  Plane,
  RefreshCw,
  Search,
  Target,
  TrendingDown,
  TrendingUp,
  UserCheck,
  Users,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PageLoader } from "@/components/PageLoader";
import type {
  AdminInlineMetric,
  AdminOverviewPageResponse,
  AdminPlatformMetricCard,
} from "@/lib/admin-types";
import { useAdminData } from "@/lib/use-admin-data";

type ColorKey = AdminPlatformMetricCard["color"];

const colorClasses: Record<ColorKey, { bg: string; text: string; stroke: string }> = {
  blue: { bg: "bg-blue-100", text: "text-blue-600", stroke: "#3b82f6" },
  purple: { bg: "bg-purple-100", text: "text-purple-600", stroke: "#8b5cf6" },
  green: { bg: "bg-green-100", text: "text-green-600", stroke: "#10b981" },
  emerald: { bg: "bg-emerald-100", text: "text-emerald-600", stroke: "#10b981" },
  orange: { bg: "bg-orange-100", text: "text-orange-600", stroke: "#f59e0b" },
  red: { bg: "bg-red-100", text: "text-red-600", stroke: "#ef4444" },
  indigo: { bg: "bg-indigo-100", text: "text-indigo-600", stroke: "#6366f1" },
};

const retentionGradient: Record<"blue" | "purple" | "green" | "orange", string> = {
  blue: "bg-gradient-to-r from-blue-50 to-blue-50/50 border-blue-100",
  purple: "bg-gradient-to-r from-purple-50 to-purple-50/50 border-purple-100",
  green: "bg-gradient-to-r from-green-50 to-green-50/50 border-green-100",
  orange: "bg-gradient-to-r from-orange-50 to-orange-50/50 border-orange-100",
};

const realTimeIconMap = {
  eye: Eye,
  users: Users,
  messages: MessageSquare,
  redirect: ExternalLink,
} as const;

type Trend = "up" | "down" | "flat";

function TrendBadge({ trend, change }: { trend: Trend; change: string }) {
  const color =
    trend === "up"
      ? "text-green-600"
      : trend === "down"
      ? "text-red-600"
      : "text-gray-500";
  const Icon = trend === "down" ? TrendingDown : TrendingUp;
  return (
    <div className={`flex items-center gap-1 text-xs font-medium ${color}`}>
      {trend === "flat" ? null : <Icon className="w-3 h-3" />}
      {change}
    </div>
  );
}

function PlatformMetricCard({ metric }: { metric: AdminPlatformMetricCard }) {
  const colors = colorClasses[metric.color] ?? colorClasses.blue;
  const sparklineData = metric.sparkline.map((value, index) => ({
    value,
    index,
  }));
  return (
    <div className="bg-white rounded-xl p-4 md:p-6 border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`p-2 ${colors.bg} rounded-lg`}>
            <Users className={`w-3 h-3 md:w-4 md:h-4 ${colors.text}`} />
          </div>
          <div className="text-xs md:text-sm text-gray-600">{metric.title}</div>
        </div>
        <TrendBadge trend={metric.trend} change={metric.change} />
      </div>
      <div className="text-xl md:text-2xl font-bold text-gray-900 mb-3">
        {metric.value}
      </div>
      {sparklineData.length > 0 ? (
        <ResponsiveContainer width="100%" height={40}>
          <LineChart data={sparklineData}>
            <Line
              type="monotone"
              dataKey="value"
              stroke={colors.stroke}
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-10 rounded bg-gray-50" />
      )}
      <p className="mt-2 text-[11px] text-gray-500">{metric.description}</p>
    </div>
  );
}

function InlineMetricRow({ metric }: { metric: AdminInlineMetric }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-600">{metric.title}</span>
        <TrendBadge trend={metric.trend} change={metric.change} />
      </div>
      <div className="text-lg md:text-xl font-bold text-gray-900">{metric.value}</div>
    </div>
  );
}

export function Overview() {
  const [dateRange, setDateRange] = useState("7d");
  const { data, loading, error } =
    useAdminData<AdminOverviewPageResponse>(`/api/admin/overview?range=${dateRange}`);
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  if (loading && !data) {
    return <PageLoader />;
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6">
      <div className="mb-2 md:mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">
            Platform Overview
          </h1>
          <p className="text-xs md:text-sm text-gray-600 mt-1">
            Live summary of platform performance, retention, and travel demand.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
            Last updated: {data?.generatedLabel ?? "—"}
          </div>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700"
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

      <div className="bg-white rounded-xl p-3 md:p-4 border border-gray-200 shadow-sm">
        <div className="block lg:hidden">
          <button
            onClick={() => setShowMobileFilters(!showMobileFilters)}
            className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700"
          >
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-500" />
              <span>Filters</span>
            </div>
            <ChevronDown
              className={`w-4 h-4 transition-transform ${
                showMobileFilters ? "rotate-180" : ""
              }`}
            />
          </button>
          {showMobileFilters && (
            <div className="mt-3 space-y-3">
              <FilterRow
                icon={<Calendar className="w-4 h-4 text-gray-500 flex-shrink-0" />}
                value={dateRange}
                onChange={setDateRange}
                options={[
                  ["7d", "Last 7 Days"],
                  ["15d", "Last 15 Days"],
                  ["30d", "Last 30 Days"],
                ]}
              />
              {/* Country filter disabled: overview payload has no country dimension. */}
              {/* Device filter disabled until backend device telemetry is available.
              <FilterRow
                icon={<Smartphone className="w-4 h-4 text-gray-500 flex-shrink-0" />}
                value={deviceFilter}
                onChange={setDeviceFilter}
                options={[
                  ["all", "All Devices"],
                  ["mobile", "Mobile"],
                  ["desktop", "Desktop"],
                  ["tablet", "Tablet"],
                ]}
              />
              */}
              {/* Traffic source filter disabled: source/UTM is not present in overview payload. */}
            </div>
          )}
        </div>
        <div className="hidden lg:flex items-center gap-3 xl:gap-4 flex-wrap">
          <FilterInline
            icon={<Calendar className="w-4 h-4 text-gray-500" />}
            value={dateRange}
            onChange={setDateRange}
            options={[
              ["7d", "Last 7 Days"],
              ["15d", "Last 15 Days"],
              ["30d", "Last 30 Days"],
            ]}
          />
          {/* Country filter disabled: overview payload has no country dimension. */}
          {/* Device filter disabled until backend device telemetry is available.
          <FilterInline
            icon={<Smartphone className="w-4 h-4 text-gray-500" />}
            value={deviceFilter}
            onChange={setDeviceFilter}
            options={[
              ["all", "All Devices"],
              ["mobile", "Mobile"],
              ["desktop", "Desktop"],
              ["tablet", "Tablet"],
            ]}
          />
          */}
          {/* Traffic source filter disabled: source/UTM is not present in overview payload. */}
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-4 h-4 md:w-5 md:h-5 text-blue-600" />
          <h2 className="text-base md:text-lg font-semibold text-gray-900">
            Platform User Metrics
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 md:gap-6">
          {data?.platformMetrics.map((metric) => (
            <PlatformMetricCard key={metric.id} metric={metric} />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
        <div className="bg-white rounded-xl p-4 md:p-6 border border-gray-200 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 bg-purple-100 rounded-lg">
              <MessageSquare className="w-3 h-3 md:w-4 md:h-4 text-purple-600" />
            </div>
            <h3 className="text-xs md:text-sm font-semibold text-gray-900">
              AI Engagement
            </h3>
          </div>
          <div className="space-y-4">
            {data?.aiMetrics.map((metric) => (
              <InlineMetricRow key={metric.id} metric={metric} />
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 md:p-6 border border-gray-200 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Search className="w-3 h-3 md:w-4 md:h-4 text-blue-600" />
            </div>
            <h3 className="text-xs md:text-sm font-semibold text-gray-900">
              Flight Search Activity
            </h3>
          </div>
          <div className="space-y-4">
            {data?.searchMetrics.map((metric) => (
              <InlineMetricRow key={metric.id} metric={metric} />
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 md:p-6 border border-gray-200 shadow-sm lg:col-span-2 xl:col-span-1">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 bg-green-100 rounded-lg">
              <ExternalLink className="w-3 h-3 md:w-4 md:h-4 text-green-600" />
            </div>
            <h3 className="text-xs md:text-sm font-semibold text-gray-900">
              Redirect Performance
            </h3>
          </div>
          <div className="space-y-4">
            {data?.redirectMetrics.map((metric) => (
              <InlineMetricRow key={metric.id} metric={metric} />
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl p-4 md:p-6 border border-gray-200 shadow-sm">
        <div className="flex items-center gap-2 mb-4 md:mb-6">
          <BarChart3 className="w-4 h-4 md:w-5 md:h-5 text-blue-600" />
          <h3 className="text-base md:text-lg font-semibold text-gray-900">
            Platform Growth Trend
          </h3>
        </div>
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={data?.growthTrend ?? []}>
            <defs>
              <linearGradient id="visitorsGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: "#6b7280" }}
              stroke="#9ca3af"
            />
            <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} stroke="#9ca3af" />
            <Tooltip
              contentStyle={{
                backgroundColor: "white",
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
                fontSize: "12px",
              }}
            />
            <Area
              type="monotone"
              dataKey="visitors"
              stroke="#3b82f6"
              strokeWidth={2}
              fill="url(#visitorsGradient)"
              name="Active users"
            />
            <Area
              type="monotone"
              dataKey="searches"
              stroke="#10b981"
              strokeWidth={2}
              fill="transparent"
              name="Searches"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <div className="bg-white rounded-xl p-4 md:p-6 border border-gray-200 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 bg-indigo-100 rounded-lg">
              <UserCheck className="w-4 h-4 md:w-5 md:h-5 text-indigo-600" />
            </div>
            <h3 className="text-base md:text-lg font-semibold text-gray-900">
              Retention Metrics
            </h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {data?.retentionMetrics.map((metric) => (
              <div
                key={metric.id}
                className={`p-4 rounded-lg border ${retentionGradient[metric.color]}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs md:text-sm text-gray-700">
                    {metric.title}
                  </span>
                  <TrendBadge trend={metric.trend} change={metric.change} />
                </div>
                <div className="text-xl md:text-2xl font-bold text-gray-900">
                  {metric.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 md:p-6 border border-gray-200 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 bg-green-100 rounded-lg">
              <Activity className="w-4 h-4 md:w-5 md:h-5 text-green-600" />
            </div>
            <div className="flex items-center gap-2">
              <h3 className="text-base md:text-lg font-semibold text-gray-900">
                Real-Time Activity
              </h3>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span className="text-xs text-green-600 font-medium">Live</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {data?.realTimeMetrics.map((metric) => {
              const Icon = realTimeIconMap[metric.icon];
              const colors = colorClasses[metric.color] ?? colorClasses.blue;
              return (
                <div
                  key={metric.id}
                  className={`p-4 rounded-lg border ${retentionGradient[metric.color]}`}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`p-2 ${colors.bg} rounded-lg`}>
                      <Icon className={`w-3 h-3 md:w-4 md:h-4 ${colors.text}`} />
                    </div>
                    <span className="text-xs md:text-sm text-gray-700">
                      {metric.title}
                    </span>
                  </div>
                  <div className="text-2xl md:text-3xl font-bold text-gray-900">
                    {metric.value}
                  </div>
                  <div className="text-xs text-gray-600 mt-1">{metric.subtitle}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl p-4 md:p-6 border border-gray-200 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-green-100 rounded-lg">
              <Zap className="w-4 h-4 md:w-5 md:h-5 text-green-600" />
            </div>
            <h3 className="text-base md:text-lg font-semibold text-gray-900">
              System Performance Snapshot
            </h3>
          </div>
          <span className="text-[11px] text-gray-400">
            Requires APM integration (not tracked yet)
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {data?.systemSnapshot.map((metric) => (
            <div
              key={metric.id}
              className="p-4 bg-gray-50 rounded-lg border border-dashed border-gray-300"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs md:text-sm text-gray-600">
                  {metric.title}
                </span>
                <span className="text-xs text-gray-400">{metric.change}</span>
              </div>
              <div className="text-xl md:text-2xl font-bold text-gray-400">
                {metric.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <div className="bg-white rounded-xl p-4 md:p-6 border border-gray-200 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Plane className="w-4 h-4 md:w-5 md:h-5 text-blue-600" />
            </div>
            <h3 className="text-base md:text-lg font-semibold text-gray-900">
              Top Searched Routes
            </h3>
          </div>
          <div className="space-y-3">
            {(data?.topRoutes ?? []).length === 0 ? (
              <p className="text-xs text-gray-500">
                No route searches tracked yet.
              </p>
            ) : null}
            {data?.topRoutes.map((route, index) => (
              <div
                key={route.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200 hover:shadow-md transition-shadow"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-6 h-6 md:w-8 md:h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                      index === 0
                        ? "bg-yellow-100 text-yellow-800"
                        : index === 1
                        ? "bg-gray-200 text-gray-700"
                        : index === 2
                        ? "bg-orange-100 text-orange-700"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {index + 1}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      {route.route}
                    </div>
                    <div className="text-xs text-gray-600">
                      {route.searches.toLocaleString()} searches
                    </div>
                  </div>
                </div>
                <div
                  className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                    route.trend === "up"
                      ? "bg-green-100 text-green-800"
                      : "bg-red-100 text-red-800"
                  }`}
                >
                  {route.trend === "up" ? (
                    <TrendingUp className="w-3 h-3" />
                  ) : (
                    <TrendingDown className="w-3 h-3" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 md:p-6 border border-gray-200 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 bg-purple-100 rounded-lg">
              <Plane className="w-4 h-4 md:w-5 md:h-5 text-purple-600" />
            </div>
            <h3 className="text-base md:text-lg font-semibold text-gray-900">
              Top Mentioned Airlines (from prompts)
            </h3>
          </div>
          {(data?.topAirlines ?? []).length === 0 ? (
            <div className="flex h-52 items-center justify-center text-xs text-gray-500">
              No airline mentions detected in recent prompts yet.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data?.topAirlines ?? []} layout="horizontal">
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11, fill: "#6b7280" }}
                  stroke="#9ca3af"
                />
                <YAxis
                  dataKey="airline"
                  type="category"
                  tick={{ fontSize: 11, fill: "#6b7280" }}
                  stroke="#9ca3af"
                  width={120}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "white",
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                />
                <Bar dataKey="searches" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl p-4 md:p-6 border border-gray-200 shadow-sm">
        <div className="flex items-center gap-2 mb-4 md:mb-6">
          <div className="p-2 bg-yellow-100 rounded-lg">
            <Lightbulb className="w-4 h-4 md:w-5 md:h-5 text-yellow-600" />
          </div>
          <h3 className="text-base md:text-lg font-semibold text-gray-900">
            Platform Insights
          </h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(data?.insights ?? []).map((insight) => (
            <div
              key={insight.id}
              className="p-4 bg-gradient-to-br from-gray-50 to-white rounded-lg border border-gray-200 hover:shadow-lg transition-shadow"
            >
              <div className="flex items-start gap-3">
                <div
                  className={`p-2 rounded-lg flex-shrink-0 ${
                    insight.impact === "positive"
                      ? "bg-green-100"
                      : "bg-orange-100"
                  }`}
                >
                  <Lightbulb
                    className={`w-3 h-3 md:w-4 md:h-4 ${
                      insight.impact === "positive"
                        ? "text-green-600"
                        : "text-orange-600"
                    }`}
                  />
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-semibold text-gray-900 mb-2">
                    {insight.title}
                  </h4>
                  <p className="text-xs md:text-sm text-gray-600 mb-3">
                    {insight.description}
                  </p>
                  <div className="inline-flex items-center gap-2 px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-medium">
                    <Target className="w-3 h-3" />
                    {insight.metric}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FilterInline({
  icon,
  value,
  onChange,
  options,
}: {
  icon: React.ReactNode;
  value: string;
  onChange: (next: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {options.map(([optionValue, label]) => (
          <option key={optionValue} value={optionValue}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}

function FilterRow({
  icon,
  value,
  onChange,
  options,
}: {
  icon: React.ReactNode;
  value: string;
  onChange: (next: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {options.map(([optionValue, label]) => (
          <option key={optionValue} value={optionValue}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
