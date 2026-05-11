"use client";

import { RefreshCw } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Line, ComposedChart } from "recharts";

import { PageLoader } from "@/components/PageLoader";
import type { AdminGrowthPageResponse } from "@/lib/admin-types";
import { useAdminData } from "@/lib/use-admin-data";

export function RouteTrends() {
  const { data, loading, error, refresh } = useAdminData<AdminGrowthPageResponse>("/api/admin/growth");

  if (loading && !data) return <PageLoader />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Route Trends</h1>
          <p className="mt-1 text-sm text-gray-600">Live search-route and booked-route trends from admin analytics.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600">Last updated: {data?.generatedLabel ?? "Unavailable"}</div>
          <button onClick={() => window.location.reload()} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
      </div>
      {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="mb-1 text-lg font-semibold text-gray-900">Search & Redirect Trend (7 days)</h3>
          <p className="mb-4 text-sm text-gray-600">Search and redirect movement from funnel trend.</p>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data?.growthTrend ?? []}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip />
                <Bar dataKey="searches" fill="#2563eb" radius={[6, 6, 0, 0]} />
                <Line type="monotone" dataKey="redirects" stroke="#059669" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="mb-1 text-lg font-semibold text-gray-900">Top Searched Routes</h3>
          <p className="mb-4 text-sm text-gray-600">Routes inferred from flight search messages.</p>
          <div className="space-y-3">
            {(data?.topSearchRoutes ?? []).slice(0, 10).map((item) => (
              <div key={item.label}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-700">{item.label}</span>
                  <span className="text-gray-500">{item.count}</span>
                </div>
                <div className="h-2 rounded-full bg-gray-100">
                  <div className="h-2 rounded-full bg-indigo-500" style={{ width: `${Math.max(4, (item.count / Math.max((data?.topSearchRoutes?.[0]?.count ?? 1), 1)) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="mb-1 text-lg font-semibold text-gray-900">Top Booked Routes (Saved Trips)</h3>
        <p className="mb-4 text-sm text-gray-600">Origin-destination pairs from user trips.</p>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data?.topRoutes ?? []} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" />
              <YAxis type="category" dataKey="label" width={220} />
              <Tooltip />
              <Bar dataKey="count" fill="#7c3aed" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
