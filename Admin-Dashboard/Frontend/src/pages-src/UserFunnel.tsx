"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Calendar,
  ChevronDown,
  Clock,
  Download,
  Filter,
  Globe,
  RefreshCw,
  Smartphone,
  TrendingDown,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PageLoader } from "@/components/PageLoader";
import type { AdminFunnelPageV2Response } from "@/lib/admin-types";
import { useAdminData } from "@/lib/use-admin-data";

type Stage = AdminFunnelPageV2Response["stages"][number];

export function UserFunnel() {
  const [dateRange, setDateRange] = useState("7d");
  const { data, loading, error } =
    useAdminData<AdminFunnelPageV2Response>(`/api/admin/funnel?range=${dateRange}`);

  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [countryFilter, setCountryFilter] = useState("all");
  const [routeFilter, setRouteFilter] = useState("all");
  const [airlineFilter, setAirlineFilter] = useState("all");

  if (loading && !data) {
    return <PageLoader />;
  }

  const stages = data?.stages ?? [];
  const activeStage: Stage | undefined = stages.find(
    (stage) => stage.id === selectedStage,
  );
  const redirectStageId = stages.find((stage) =>
    stage.id.toLowerCase().includes("redirect"),
  )?.id;
  const routeOptions = (data?.topRoutes ?? []).map((item) => item.label);
  const airlineOptions =
    redirectStageId && data?.stageDetails[redirectStageId]
      ? data.stageDetails[redirectStageId].listItems.map((item) => item.label)
      : [];

  const stageDetails = activeStage
    ? data?.stageDetails[activeStage.id]
    : undefined;
  const filteredStageDetails =
    activeStage && stageDetails
      ? {
          ...stageDetails,
          listItems: stageDetails.listItems.filter((item) => {
            if (activeStage.id === stages[0]?.id && countryFilter !== "all") {
              return item.label === countryFilter;
            }
            if (
              (activeStage.id === stages[2]?.id || activeStage.id === stages[3]?.id) &&
              routeFilter !== "all"
            ) {
              return item.label === routeFilter;
            }
            if (activeStage.id === redirectStageId && airlineFilter !== "all") {
              return item.label === airlineFilter;
            }
            return true;
          }),
        }
      : stageDetails;
  const filteredCountrySegments =
    countryFilter === "all"
      ? data?.countrySegments ?? []
      : (data?.countrySegments ?? []).filter((country) => country.name === countryFilter);

  const overallConv = (() => {
    if (stages.length < 2) return 0;
    const first = stages[0]?.count || 1;
    const last = stages[stages.length - 1]?.count || 0;
    return Math.round((last / first) * 100);
  })();
  const totalDropOff = Math.max(100 - overallConv, 0);

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-4 md:space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">
            Advanced Funnel Analytics
          </h1>
          <p className="text-xs md:text-sm text-gray-600 mt-1">
            Live conversion journey from visitors through redirects — computed
            from chat sessions, searches, and recorded redirects.
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
          <button
            disabled
            className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-400 text-xs md:text-sm rounded-lg cursor-not-allowed"
          >
            <Download className="w-3 h-3 md:w-4 md:h-4" />
            <span>Export</span>
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-gray-500" />
            <select
              value={dateRange}
              onChange={(event) => setDateRange(event.target.value)}
              className="text-xs md:text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="7d">Last 7 days</option>
              <option value="15d">Last 15 days</option>
              <option value="30d">Last 30 days</option>
            </select>
          </div>

          <label className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
            <input
              type="checkbox"
              checked={compareEnabled}
              onChange={(event) => setCompareEnabled(event.target.checked)}
              className="w-3.5 h-3.5"
            />
            <span className="text-xs md:text-sm text-gray-700 font-medium">
              Compare
            </span>
          </label>

          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-xs md:text-sm"
          >
            <Filter className="w-4 h-4 text-gray-500" />
            <span>Filters</span>
            <ChevronDown className="w-4 h-4 text-gray-500" />
          </button>

        </div>

        {showFilters ? (
          <div className="mt-4 pt-4 border-t border-gray-200 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {/* Device filter disabled: device telemetry is not available in funnel payload. */}
            <div>
              <label className="text-xs text-gray-600 mb-1.5 block font-medium">
                Country
              </label>
              <select
                value={countryFilter}
                onChange={(event) => setCountryFilter(event.target.value)}
                className="w-full text-xs md:text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All countries</option>
                {(data?.countrySegments ?? []).map((country) => (
                  <option key={country.name} value={country.name}>
                    {country.name}
                  </option>
                ))}
              </select>
            </div>
            {/* Traffic source filter disabled: source/UTM data is not tracked yet. */}
            <div>
              <label className="text-xs text-gray-600 mb-1.5 block font-medium">
                Airline
              </label>
              <select
                value={airlineFilter}
                onChange={(event) => setAirlineFilter(event.target.value)}
                className="w-full text-xs md:text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All airlines</option>
                {airlineOptions.map((airline) => (
                  <option key={airline} value={airline}>
                    {airline}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-600 mb-1.5 block font-medium">
                Route
              </label>
              <select
                value={routeFilter}
                onChange={(event) => setRouteFilter(event.target.value)}
                className="w-full text-xs md:text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All routes</option>
                {routeOptions.map((route) => (
                  <option key={route} value={route}>
                    {route}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : null}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4 md:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-3 gap-3">
          <div>
            <h2 className="text-sm md:text-base font-semibold text-gray-900">
              Conversion Rate Trends
            </h2>
            <p className="text-xs text-gray-500">
              Search rate, AI engagement, and redirect conversion over the last
              week.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <LegendDot color="bg-blue-500" label="Conversion" />
            <LegendDot color="bg-purple-500" label="AI Engagement" />
            <LegendDot color="bg-green-500" label="Search Rate" />
          </div>
        </div>
        <div className="h-48 md:h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data?.conversionTrend ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="date" stroke="#9CA3AF" style={{ fontSize: 10 }} />
              <YAxis stroke="#9CA3AF" style={{ fontSize: 10 }} />
              <Tooltip
                contentStyle={{
                  fontSize: "11px",
                  borderRadius: "8px",
                  border: "1px solid #E5E7EB",
                }}
              />
              <Line
                type="monotone"
                dataKey="conversion"
                stroke="#3B82F6"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
              <Line
                type="monotone"
                dataKey="aiEngagement"
                stroke="#8B5CF6"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
              <Line
                type="monotone"
                dataKey="searchRate"
                stroke="#10B981"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 md:gap-6">
        <div className="xl:col-span-2 bg-white rounded-lg border border-gray-200 p-4 md:p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">
            User Journey Funnel
          </h2>
          <div className="space-y-2">
            {stages.map((stage, index) => (
              <div key={stage.id}>
                <div
                  onClick={() => setSelectedStage(stage.id)}
                  className={`cursor-pointer group p-2 rounded-lg border transition-all ${
                    selectedStage === stage.id
                      ? "bg-blue-50 border-blue-300 shadow-sm"
                      : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-5 h-5 rounded-full ${stage.bgColor} flex items-center justify-center text-white text-xs font-bold`}
                      >
                        {index + 1}
                      </div>
                      <div>
                        <h3 className="text-xs font-semibold text-gray-900">
                          {stage.name}
                        </h3>
                        <p className="text-xs text-gray-500">{stage.avgTime}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="text-base font-bold text-gray-900">
                          {stage.count.toLocaleString()}
                        </div>
                        <div className="text-xs text-gray-500">users</div>
                      </div>
                      <div className="text-right">
                        <div className="text-base font-bold text-gray-900">
                          {stage.percentage}%
                        </div>
                        <div className="text-xs text-gray-500">of total</div>
                      </div>
                      {stage.dropOff !== undefined ? (
                        <div
                          className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded ${
                            stage.dropOff > 0 ? "bg-red-50" : "bg-green-50"
                          }`}
                        >
                          {stage.dropOff > 0 ? (
                            <TrendingDown className="w-3 h-3 text-red-600" />
                          ) : (
                            <TrendingUp className="w-3 h-3 text-green-600" />
                          )}
                          <span
                            className={`text-xs font-semibold ${
                              stage.dropOff > 0
                                ? "text-red-600"
                                : "text-green-600"
                            }`}
                          >
                            {stage.dropOff > 0
                              ? `-${stage.dropOff}`
                              : `+${Math.abs(stage.dropOff)}`}
                            %
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="relative h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full transition-all duration-300 flex items-center justify-end pr-2"
                      style={{
                        width: `${Math.min(stage.percentage, 100)}%`,
                        backgroundColor: stage.color,
                      }}
                    >
                      <span className="text-xs font-semibold text-white">
                        {stage.percentage}%
                      </span>
                    </div>
                  </div>
                </div>
                {index < stages.length - 1 ? (
                  <div className="flex justify-center py-1">
                    <ArrowRight className="w-4 h-4 text-gray-400" />
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-gray-200">
            <div className="text-center p-2 bg-gray-50 rounded">
              <div className="text-xs text-gray-600 mb-0.5">Overall Conv.</div>
              <div className="text-lg font-bold text-gray-900">
                {overallConv}%
              </div>
            </div>
            <div className="text-center p-2 bg-red-50 rounded">
              <div className="text-xs text-gray-600 mb-0.5">Total Drop-off</div>
              <div className="text-lg font-bold text-red-600">
                {totalDropOff}%
              </div>
            </div>
            <div className="text-center p-2 bg-blue-50 rounded">
              <div className="text-xs text-gray-600 mb-0.5">Avg Journey</div>
              <div className="text-lg font-bold text-gray-900">
                {stages.at(-1)?.avgTime ?? "—"}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          {activeStage && filteredStageDetails ? (
            <>
              <div className="bg-gradient-to-r from-blue-50 to-purple-50 px-3 py-2 border-b border-gray-200 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">
                  {activeStage.name} · Stage Insights
                </h3>
                <button onClick={() => setSelectedStage(null)}>
                  <X className="w-4 h-4 text-gray-600 hover:text-gray-900" />
                </button>
              </div>
              <div className="p-3 space-y-3 max-h-[500px] overflow-y-auto">
                <div className="grid grid-cols-1 gap-1.5">
                  {filteredStageDetails.metrics.map((metric, idx) => (
                    <div
                      key={`${metric.label}-${idx}`}
                      className="p-2 rounded bg-gray-50 border border-gray-100"
                    >
                      <div className="text-xs text-gray-600">{metric.label}</div>
                      <div className="text-base font-bold text-gray-900">
                        {metric.value}
                      </div>
                    </div>
                  ))}
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-gray-900 mb-1.5">
                    {stageDetails.listTitle}
                  </h4>
                  <div className="space-y-1">
                    {filteredStageDetails.listItems.length === 0 ? (
                      <p className="text-xs text-gray-500">
                        No data captured for this stage yet.
                      </p>
                    ) : null}
                    {filteredStageDetails.listItems.map((item, idx) => (
                      <div
                        key={`${item.label}-${idx}`}
                        className="flex justify-between items-center p-1.5 bg-gray-50 rounded text-xs"
                      >
                        <span className="text-gray-900">{item.label}</span>
                        <span className="font-semibold text-gray-700">
                          {item.value.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full p-6">
              <div className="text-center">
                <BarChart3 className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                <p className="text-xs text-gray-500">Select a funnel stage</p>
                <p className="text-xs text-gray-400">to view detailed insights</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
          <div className="flex items-center gap-1.5 mb-3">
            <Globe className="w-4 h-4 text-gray-600" />
            <h3 className="text-sm font-semibold text-gray-900">
              Conversion by Country
            </h3>
          </div>
          <div className="space-y-2">
            {(data?.countrySegments ?? []).length === 0 ? (
              <p className="text-xs text-gray-500">
                No country data captured yet.
              </p>
            ) : null}
            {filteredCountrySegments.map((country) => (
              <div key={country.name}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs text-gray-700">{country.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">
                      {country.users.toLocaleString()} users
                    </span>
                    <span className="text-xs font-semibold text-gray-900">
                      {country.conversion}%
                    </span>
                  </div>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div
                    className="h-2 rounded-full transition-all"
                    style={{
                      width: `${country.conversion}%`,
                      backgroundColor: country.color,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
          <div className="flex items-center gap-1.5 mb-3">
            <Smartphone className="w-4 h-4 text-gray-600" />
            <h3 className="text-sm font-semibold text-gray-900">
              Registered vs Guest Sessions
            </h3>
          </div>
          <div className="space-y-2">
            {data?.registeredVsGuest.map((segment) => (
              <div key={segment.name}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs text-gray-700">{segment.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">
                      {segment.users.toLocaleString()} sessions
                    </span>
                    <span className="text-xs font-semibold text-gray-900">
                      {segment.conversion}%
                    </span>
                  </div>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div
                    className="h-2 rounded-full transition-all"
                    style={{
                      width: `${segment.conversion}%`,
                      backgroundColor: segment.color,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-gray-500">
            Traffic-source breakdowns require a UTM/referrer column on sessions
            — not tracked yet. This card shows the split we can measure today.
          </p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
          <div className="flex items-center gap-1.5 mb-3">
            <TrendingUp className="w-4 h-4 text-gray-600" />
            <h3 className="text-sm font-semibold text-gray-900">
              Top Prompts
            </h3>
          </div>
          <div className="space-y-1.5">
            {(data?.topPrompts ?? []).length === 0 ? (
              <p className="text-xs text-gray-500">
                No prompt signals captured yet.
              </p>
            ) : null}
            {data?.topPrompts.map((item, idx) => (
              <div
                key={`${item.label}-${idx}`}
                className="flex justify-between items-center p-1.5 bg-gray-50 rounded"
              >
                <span className="text-xs text-gray-900 truncate" title={item.label}>
                  {item.label}
                </span>
                <span className="text-xs font-semibold text-gray-700">
                  {item.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">
            User Journey Paths
          </h3>
          <div className="space-y-2">
            {(data?.pathAnalysis ?? []).length === 0 ? (
              <p className="text-xs text-gray-500">
                No path data available yet.
              </p>
            ) : null}
            {data?.pathAnalysis.map((path, idx) => (
              <div
                key={`${path.path}-${idx}`}
                className="p-2 bg-gray-50 rounded-lg border border-gray-200"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium text-gray-900">
                    {path.path}
                  </span>
                  <span className="text-xs font-semibold text-blue-600">
                    {path.count.toLocaleString()} users
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                    <div
                      className="bg-blue-500 h-1.5 rounded-full transition-all"
                      style={{ width: `${Math.min(path.percentage, 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-600">
                    {path.percentage}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center gap-1.5 mb-3">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <h3 className="text-sm font-semibold text-gray-900">
              Biggest Drop-Off Points
            </h3>
          </div>
          <div className="space-y-2">
            {(data?.dropOffPoints ?? []).length === 0 ? (
              <p className="text-xs text-gray-500">
                No drop-offs detected yet.
              </p>
            ) : null}
            {data?.dropOffPoints.map((point, idx) => (
              <div
                key={`${point.stage}-${idx}`}
                className="p-2 bg-red-50 rounded-lg border border-red-200"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-gray-900">
                    {point.stage}
                  </span>
                  <div className="flex items-center gap-1">
                    <TrendingDown className="w-3.5 h-3.5 text-red-600" />
                    <span className="text-sm font-bold text-red-600">
                      -{point.dropOff}%
                    </span>
                  </div>
                </div>
                <p className="text-xs text-gray-600 mb-1">{point.reason}</p>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">
                    {point.count.toLocaleString()} users lost
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center gap-1.5 mb-3">
            <Clock className="w-4 h-4 text-gray-600" />
            <h3 className="text-sm font-semibold text-gray-900">
              Time to Convert
            </h3>
            <span className="text-xs text-gray-500">
              Cumulative percentage over time (approximation from stage counts)
            </span>
          </div>
          <div className="h-48 md:h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data?.timeMetrics ?? []}>
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
                <Area
                  type="monotone"
                  dataKey="redirect"
                  stackId="1"
                  stroke="#F97316"
                  fill="#F97316"
                  fillOpacity={0.6}
                />
                <Area
                  type="monotone"
                  dataKey="options"
                  stackId="1"
                  stroke="#F59E0B"
                  fill="#F59E0B"
                  fillOpacity={0.6}
                />
                <Area
                  type="monotone"
                  dataKey="search"
                  stackId="1"
                  stroke="#10B981"
                  fill="#10B981"
                  fillOpacity={0.6}
                />
                <Area
                  type="monotone"
                  dataKey="aiStart"
                  stackId="1"
                  stroke="#8B5CF6"
                  fill="#8B5CF6"
                  fillOpacity={0.6}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-4 gap-2 mt-3">
            {stages.slice(1).map((stage) => (
              <div
                key={`time-${stage.id}`}
                className="text-center p-2 bg-gray-50 rounded"
              >
                <div className="text-xs text-gray-600 mb-0.5">
                  {stage.name}
                </div>
                <div className="text-sm font-bold text-gray-900">
                  {stage.avgTime}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center gap-1.5 mb-3">
            <Zap className="w-4 h-4 text-purple-600" />
            <h3 className="text-sm font-semibold text-gray-900">
              Registered vs Guest Conversion
            </h3>
          </div>
          <div className="space-y-3">
            {data?.registeredVsGuest.map((segment) => (
              <div
                key={`impact-${segment.name}`}
                className={`p-3 rounded-lg border ${
                  segment.name.includes("Registered")
                    ? "bg-purple-50 border-purple-200"
                    : "bg-gray-50 border-gray-200"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-gray-900">
                    {segment.name}
                  </span>
                  <span className="text-xs text-gray-600">
                    {segment.users.toLocaleString()} sessions
                  </span>
                </div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex-1 bg-gray-200 rounded-full h-2">
                    <div
                      className="h-2 rounded-full"
                      style={{
                        width: `${segment.conversion}%`,
                        backgroundColor: segment.color,
                      }}
                    />
                  </div>
                  <span className="text-sm font-bold text-gray-900">
                    {segment.conversion}%
                  </span>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[11px] text-gray-500">
            True AI-attributed conversion lift requires tagging sessions as
            AI-influenced (not persisted yet). This card shows the registered /
            guest split we can measure today.
          </p>
        </div>
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-2 h-2 rounded-full ${color}`} />
      <span className="text-xs text-gray-600">{label}</span>
    </div>
  );
}
