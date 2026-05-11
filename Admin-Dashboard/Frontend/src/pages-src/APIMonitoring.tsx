"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  RefreshCw,
  Server,
  XCircle,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PageLoader } from "@/components/PageLoader";
import type { AdminApiMonitoringResponse } from "@/lib/admin-types";
import { useAdminData } from "@/lib/use-admin-data";

const toneMap = {
  blue: "bg-blue-50 text-blue-700",
  purple: "bg-purple-50 text-purple-700",
  green: "bg-emerald-50 text-emerald-700",
  orange: "bg-orange-50 text-orange-700",
  red: "bg-red-50 text-red-700",
};

export function APIMonitoring() {
  const [dateRange, setDateRange] = useState("7d");
  const { data, loading, error, refresh } = useAdminData<AdminApiMonitoringResponse>(
    `/api/admin/api-monitoring?range=${dateRange}`,
  );
  const [providerFilter, setProviderFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; });
  useEffect(() => {
    const timer = setInterval(() => { void refreshRef.current(); }, 10_000);
    return () => clearInterval(timer);
  }, []);

  const totals = useMemo(() => {
    const trend = data?.requestVolume ?? [];
    return {
      requests: trend.reduce((sum, item) => sum + item.requests, 0),
    };
  }, [data]);
  const windowLabel = useMemo(() => {
    if (dateRange === "15d") return "Last 15 days";
    if (dateRange === "30d") return "Last 30 days";
    return "Last 7 days";
  }, [dateRange]);
  const externalUsage = data?.externalProviderUsage ?? [];
  const providerLabelMap = useMemo(
    () => Object.fromEntries(externalUsage.map((item) => [item.provider, item.label])),
    [externalUsage],
  );
  const providerOptions = useMemo(() => {
    if (externalUsage.length > 0) {
      return externalUsage.map((item) => ({
        value: item.provider.toLowerCase(),
        label: item.label,
      }));
    }

    return Array.from(new Set((data?.endpointRows ?? []).map((row) => row.provider)))
      .filter(Boolean)
      .map((provider) => ({
        value: provider.toLowerCase(),
        label: provider,
      }));
  }, [data?.endpointRows, externalUsage]);

  const filteredEndpoints = (data?.endpointRows ?? []).filter((row) => {
    if (providerFilter !== "all" && row.provider.toLowerCase() !== providerFilter) {
      return false;
    }
    if (statusFilter !== "all") {
      if (statusFilter === "active" && row.status !== "healthy") {
        return false;
      }
      if (statusFilter === "idle" && row.status === "healthy") {
        return false;
      }
    }
    return true;
  });

  if (loading && !data) return <PageLoader />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">API Monitoring & Management</h1>
          <p className="mt-1 text-sm text-gray-600">
            Track health, request volume, latency, usage, and failures for the six monitored external providers only.
          </p>
        </div>
        <button
          onClick={() => void refresh()}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Clock className="h-4 w-4" />
            <select
              value={dateRange}
              onChange={(event) => setDateRange(event.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700"
            >
              <option value="7d">Last 7 days</option>
              <option value="15d">Last 15 days</option>
              <option value="30d">Last 30 days</option>
            </select>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Server className="h-4 w-4" />
            <select
              value={providerFilter}
              onChange={(event) => setProviderFilter(event.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700"
            >
              <option value="all">All providers</option>
              {providerOptions.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Activity className="h-4 w-4" />
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700"
            >
              <option value="all">All status</option>
              <option value="active">Healthy</option>
              <option value="idle">Slow/Error</option>
            </select>
          </div>
          <button className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
            <Download className="h-4 w-4" />
            Export Logs
          </button>
          <div className="ml-auto rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            Live external API usage refreshes every 10 seconds.
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        {data?.kpis.map((metric) => (
          <div key={metric.id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm text-gray-600">{metric.label}</p>
                <p className="mt-2 text-3xl font-semibold text-gray-900">{metric.value}</p>
                <p
                  className={`mt-2 text-xs font-semibold ${
                    metric.trend === "up"
                      ? "text-green-600"
                      : metric.trend === "down"
                        ? "text-red-600"
                        : "text-gray-500"
                  }`}
                >
                  {metric.change}
                </p>
              </div>
              <div className={`rounded-xl p-3 ${toneMap[metric.tone as keyof typeof toneMap]}`}>
                <Activity className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-3 h-10">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={metric.sparkline}>
                  <Area type="monotone" dataKey="value" stroke="#3B82F6" fill="#DBEAFE" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">External API Live Usage</h2>
            <p className="mt-1 text-sm text-gray-600">
              Live usage for the six tracked providers with {windowLabel.toLowerCase()} requests and 24h quota consumption.
            </p>
          </div>
          <div className="text-xs text-gray-500">Daily limit bars use the last 24 hours of provider traffic.</div>
        </div>
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {externalUsage.map((item) => (
            <div key={item.provider} className="rounded-xl border border-gray-200 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-lg font-semibold text-gray-900">{item.label}</p>
                  <p className="mt-1 text-sm text-gray-500">{item.description}</p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    item.status === "active"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {item.status}
                </span>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-500">{windowLabel}</p>
                  <p className="mt-1 text-2xl font-semibold text-gray-900">
                    {item.requestsWindow.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-500">Requests (24h)</p>
                  <p className="mt-1 text-2xl font-semibold text-gray-900">
                    {item.requests24h.toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-900">Daily quota used</span>
                  <span className="text-gray-600">
                    {item.requests24h.toLocaleString()} / {item.quota.toLocaleString()} ({item.percentUsed.toFixed(1)}%)
                  </span>
                </div>
                <div className="h-2 rounded-full bg-gray-100">
                  <div
                    className="h-2 rounded-full"
                    style={{
                      width: `${Math.min(item.percentUsed, 100)}%`,
                      backgroundColor: item.color,
                    }}
                  />
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-500">Remaining today</p>
                  <p className="mt-1 font-semibold text-gray-900">{item.remaining.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-gray-500">Monthly requests</p>
                  <p className="mt-1 font-semibold text-gray-900">{item.monthlyRequests.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-gray-500">Success (window)</p>
                  <p className="mt-1 font-semibold text-emerald-700">{item.successWindow.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-gray-500">Failed (window)</p>
                  <p className="mt-1 font-semibold text-red-600">{item.failedWindow.toLocaleString()}</p>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-500">API key</p>
                  <p className="mt-1 font-medium text-gray-900">{item.keyName ?? "Not detected yet"}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {item.keyLast4 ? `****${item.keyLast4}` : "Token hidden"}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500">Monthly cost</p>
                  <p className="mt-1 font-medium text-gray-900">
                    {item.currency} {item.monthlyCost.toFixed(2)}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    Last used {item.lastUsed ? new Date(item.lastUsed).toLocaleString() : "not yet"}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">External API Endpoint Monitoring</h2>
        <p className="mt-1 text-sm text-gray-600">
          Only outbound endpoints from the six tracked providers are listed here.
        </p>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[1040px]">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-sm text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">State</th>
                <th className="px-4 py-3 font-medium">Provider</th>
                <th className="px-4 py-3 font-medium">Endpoint</th>
                <th className="px-4 py-3 font-medium text-right">Requests (window)</th>
                <th className="px-4 py-3 font-medium text-right">Avg</th>
                <th className="px-4 py-3 font-medium text-right">P95</th>
                <th className="px-4 py-3 font-medium text-right">P99</th>
                <th className="px-4 py-3 font-medium text-right">Error</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Uptime</th>
              </tr>
            </thead>
            <tbody>
              {filteredEndpoints.map((item) => (
                <tr key={item.id} className="border-b border-gray-100">
                  <td className="px-4 py-4 text-sm">
                    {item.status === "healthy" ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : item.status === "slow" ? (
                      <AlertCircle className="h-4 w-4 text-amber-600" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-600" />
                    )}
                  </td>
                  <td className="px-4 py-4 text-sm font-medium text-gray-900">
                    {providerLabelMap[item.provider] ?? item.provider}
                  </td>
                  <td className="px-4 py-4 text-xs font-mono text-gray-600">{item.endpoint}</td>
                  <td className="px-4 py-4 text-sm text-gray-700 text-right">{item.requests24h.toLocaleString()}</td>
                  <td className="px-4 py-4 text-sm text-gray-700 text-right">{item.avgResponseTimeMs}ms</td>
                  <td className="px-4 py-4 text-sm text-gray-700 text-right">{item.p95Ms}ms</td>
                  <td className="px-4 py-4 text-sm text-gray-700 text-right">{item.p99Ms}ms</td>
                  <td className="px-4 py-4 text-sm text-gray-700 text-right">{item.errorRatePct}%</td>
                  <td className="px-4 py-4 text-sm text-gray-700">{item.status}</td>
                  <td className="px-4 py-4 text-sm text-gray-700 text-right">{item.uptimePct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredEndpoints.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500">
              No monitored external endpoints matched the current filters.
            </p>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Request Volume Analytics</h2>
          <p className="mt-1 text-sm text-gray-600">Request throughput grouped by monitoring window.</p>
          <div className="mt-6 h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data?.requestVolume ?? []}>
                <defs>
                  <linearGradient id="apiReqGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip />
                <Area type="monotone" dataKey="requests" stroke="#3B82F6" fill="url(#apiReqGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Error Rate Analytics</h2>
          <p className="mt-1 text-sm text-gray-600">Error trend with spike visibility.</p>
          <div className="mt-6 h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data?.errorRateTrend ?? []}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip />
                <Line type="monotone" dataKey="rate" stroke="#EF4444" strokeWidth={3} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm xl:col-span-2">
          <h2 className="text-lg font-semibold text-gray-900">Requests per External Provider</h2>
          <p className="mt-1 text-sm text-gray-600">
            Selected-window request volume across the six tracked external APIs.
          </p>
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.providerUsage ?? []} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis type="number" tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="provider" tickLine={false} axisLine={false} width={120} />
                  <Tooltip />
                  <Bar dataKey="requests" radius={[0, 8, 8, 0]}>
                    {(data?.providerUsage ?? []).map((row) => (
                      <Cell key={row.provider} fill={row.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={[
                    { name: "Success", count: data?.successFailed.success ?? 0 },
                    { name: "Failed", count: data?.successFailed.failed ?? 0 },
                  ]}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} />
                  <Tooltip />
                  <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                    <Cell fill="#10B981" />
                    <Cell fill="#EF4444" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <h2 className="text-lg font-semibold text-gray-900">Active Alerts</h2>
          </div>
          <div className="mt-6 space-y-4">
            {(data?.activeAlerts ?? []).map((alert) => (
              <div
                key={alert.id}
                className={`rounded-lg border p-4 text-sm ${
                  alert.type === "error"
                    ? "border-red-200 bg-red-50 text-red-800"
                    : alert.type === "warning"
                      ? "border-amber-200 bg-amber-50 text-amber-800"
                      : "border-blue-200 bg-blue-50 text-blue-800"
                }`}
              >
                <p className="font-medium">{alert.title}</p>
                <p className="mt-1">{alert.message}</p>
                <p className="mt-2 text-xs opacity-80">{alert.time}</p>
              </div>
            ))}
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="text-sm font-medium text-gray-900">Observed totals</p>
              <p className="mt-2 text-sm text-gray-600">
                {totals.requests.toLocaleString()} requests in current monitoring window.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">API Key Usage Records</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-sm text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">Provider</th>
                <th className="px-4 py-3 font-medium">Key Name</th>
                <th className="px-4 py-3 font-medium">Token</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Last Used</th>
                <th className="px-4 py-3 font-medium text-right">Requests (24h)</th>
                <th className="px-4 py-3 font-medium text-right">Used / Left</th>
              </tr>
            </thead>
            <tbody>
              {(data?.apiKeys ?? []).map((row) => (
                <tr key={row.keyName} className="border-b border-gray-100">
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {providerLabelMap[row.provider] ?? row.provider}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{row.keyName}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {row.keyLast4 ? `****${row.keyLast4}` : "N/A"}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">{row.status}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {row.lastUsed ? new Date(row.lastUsed).toLocaleString() : "Never"}
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-gray-700">{row.requests24h.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-sm text-gray-700">
                    {row.quotaDaily && row.quotaDaily > 0
                      ? `${row.requests24h.toLocaleString()} / ${(row.remainingToday ?? 0).toLocaleString()}`
                      : "N/A"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(data?.apiKeys.length ?? 0) === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500">No API key usage records collected yet.</p>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Daily API Limits</h2>
          <div className="mt-4 space-y-4">
            {externalUsage.map((row) => (
              <div key={row.provider}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-900">{providerLabelMap[row.provider] ?? row.provider}</span>
                  <span className="text-gray-600">
                    {row.requests24h.toLocaleString()} / {row.quota.toLocaleString()} ({row.percentUsed.toFixed(1)}%)
                  </span>
                </div>
                <div className="h-2 rounded-full bg-gray-100">
                  <div
                    className={`h-2 rounded-full ${
                      row.percentUsed > 90
                        ? "bg-red-500"
                        : row.percentUsed > 70
                          ? "bg-amber-500"
                          : "bg-emerald-500"
                    }`}
                    style={{ width: `${Math.min(row.percentUsed, 100)}%` }}
                  />
                </div>
              </div>
            ))}
            {externalUsage.length === 0 ? (
              <p className="text-sm text-gray-500">No rate-limit usage yet.</p>
            ) : null}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Cost Monitoring</h2>
          <div className="mt-2 text-sm text-gray-600">
            Total Monthly Cost:{" "}
            <span className="font-semibold text-gray-900">
              {data?.costMonitoring.currency} {data?.costMonitoring.totalMonthlyCost.toFixed(2)}
            </span>
          </div>
          <div className="mt-1 text-sm text-gray-600">
            Avg Cost / Request:{" "}
            <span className="font-semibold text-gray-900">
              {data?.costMonitoring.currency} {data?.costMonitoring.avgCostPerRequest.toFixed(6)}
            </span>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px]">
              <thead className="border-b border-gray-200 bg-gray-50 text-left text-sm text-gray-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Provider</th>
                  <th className="px-4 py-3 font-medium text-right">Requests</th>
                  <th className="px-4 py-3 font-medium text-right">Cost/Req</th>
                  <th className="px-4 py-3 font-medium text-right">Monthly</th>
                </tr>
              </thead>
              <tbody>
                {(data?.costMonitoring.monthlyBreakdown ?? []).map((row) => (
                  <tr key={row.provider} className="border-b border-gray-100">
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {providerLabelMap[row.provider] ?? row.provider}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-700">{row.requests.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-sm text-gray-700">
                      {data?.costMonitoring.currency} {row.costPerRequest.toFixed(6)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-gray-900">
                      {data?.costMonitoring.currency} {row.monthlyCost.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Recent Error Logs</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-sm text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">Endpoint</th>
                <th className="px-4 py-3 font-medium">Timestamp</th>
                <th className="px-4 py-3 font-medium">Error</th>
                <th className="px-4 py-3 font-medium text-right">Status Code</th>
              </tr>
            </thead>
            <tbody>
              {(data?.errorLogs ?? []).map((row) => (
                <tr key={row.id} className="border-b border-gray-100">
                  <td className="px-4 py-3 text-xs font-mono text-gray-700">{row.endpoint}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{row.timestamp}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{row.error}</td>
                  <td className="px-4 py-3 text-sm text-right font-semibold text-red-600">{row.statusCode}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data?.errorLogs.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500">No recent errors in current snapshot.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
