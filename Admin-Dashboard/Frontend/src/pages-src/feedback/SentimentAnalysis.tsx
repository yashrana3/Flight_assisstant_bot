"use client";

import { Frown, Meh, RefreshCw, Smile, TrendingUp } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PageLoader } from "@/components/PageLoader";
import type { AdminFeedbackSentimentResponse } from "@/lib/admin-types";
import { useAdminData } from "@/lib/use-admin-data";

export function SentimentAnalysis() {
  const { data, loading, error, refresh } =
    useAdminData<AdminFeedbackSentimentResponse>("/api/admin/feedback/sentiment");

  if (loading && !data) return <PageLoader />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900">Sentiment Analysis</h2>
          <p className="text-sm text-gray-600 mt-1">
            Track user sentiment in feedback
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600">
            Last updated: {data?.generatedLabel ?? "Unavailable"}
          </div>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600">Positive Feedback</span>
            <Smile className="w-6 h-6 text-green-600" />
          </div>
          <div className="text-3xl font-semibold text-gray-900 mb-1">
            {data?.positive.count ?? 0}
          </div>
          <div className="flex items-center gap-1 text-sm">
            <TrendingUp className="w-4 h-4 text-green-600" />
            <span className="text-green-600 font-medium">
              {data?.positive.percentage ?? 0}%
            </span>
          </div>
          <div className="mt-3 text-sm text-gray-600">of classified feedback</div>
        </div>

        <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600">Neutral Feedback</span>
            <Meh className="w-6 h-6 text-yellow-600" />
          </div>
          <div className="text-3xl font-semibold text-gray-900 mb-1">
            {data?.neutral.count ?? 0}
          </div>
          <div className="flex items-center gap-1 text-sm">
            <TrendingUp className="w-4 h-4 text-gray-600" />
            <span className="text-gray-600 font-medium">
              {data?.neutral.percentage ?? 0}%
            </span>
          </div>
          <div className="mt-3 text-sm text-gray-600">of classified feedback</div>
        </div>

        <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600">Negative Feedback</span>
            <Frown className="w-6 h-6 text-red-600" />
          </div>
          <div className="text-3xl font-semibold text-gray-900 mb-1">
            {data?.negative.count ?? 0}
          </div>
          <div className="flex items-center gap-1 text-sm">
            <TrendingUp className="w-4 h-4 text-red-600" />
            <span className="text-red-600 font-medium">
              {data?.negative.percentage ?? 0}%
            </span>
          </div>
          <div className="mt-3 text-sm text-gray-600">of classified feedback</div>
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Sentiment Trend Over Time
        </h3>
        <div className="h-96">
          {data?.trend.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="date" stroke="#9CA3AF" style={{ fontSize: "12px" }} />
                <YAxis stroke="#9CA3AF" style={{ fontSize: "12px" }} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="positive"
                  stroke="#10B981"
                  strokeWidth={3}
                  name="Positive"
                />
                <Line
                  type="monotone"
                  dataKey="neutral"
                  stroke="#F59E0B"
                  strokeWidth={3}
                  name="Neutral"
                />
                <Line
                  type="monotone"
                  dataKey="negative"
                  stroke="#EF4444"
                  strokeWidth={3}
                  name="Negative"
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="flex h-full items-center justify-center text-sm text-gray-500">
              No sentiment trend data yet.
            </p>
          )}
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Per-day sentiment is approximated from the feedback trend and the current
          sentiment mix. Once each feedback item is timestamped with its sentiment
          this chart will become exact.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-green-50 rounded-xl p-6 border border-green-200">
          <h4 className="font-semibold text-green-900 mb-3">Recent Positive Feedback</h4>
          <div className="space-y-2">
            {data?.examples.positive.length ? (
              data.examples.positive.map((text, idx) => (
                <p
                  key={`pos-${idx}`}
                  className="text-sm text-green-800 p-2 bg-white rounded border border-green-100"
                >
                  &quot;{text}&quot;
                </p>
              ))
            ) : (
              <p className="text-sm text-green-700">No positive feedback yet.</p>
            )}
          </div>
        </div>

        <div className="bg-yellow-50 rounded-xl p-6 border border-yellow-200">
          <h4 className="font-semibold text-yellow-900 mb-3">Recent Neutral Feedback</h4>
          <div className="space-y-2">
            {data?.examples.neutral.length ? (
              data.examples.neutral.map((text, idx) => (
                <p
                  key={`neu-${idx}`}
                  className="text-sm text-yellow-800 p-2 bg-white rounded border border-yellow-100"
                >
                  &quot;{text}&quot;
                </p>
              ))
            ) : (
              <p className="text-sm text-yellow-700">No neutral feedback yet.</p>
            )}
          </div>
        </div>

        <div className="bg-red-50 rounded-xl p-6 border border-red-200">
          <h4 className="font-semibold text-red-900 mb-3">Recent Negative Feedback</h4>
          <div className="space-y-2">
            {data?.examples.negative.length ? (
              data.examples.negative.map((text, idx) => (
                <p
                  key={`neg-${idx}`}
                  className="text-sm text-red-800 p-2 bg-white rounded border border-red-100"
                >
                  &quot;{text}&quot;
                </p>
              ))
            ) : (
              <p className="text-sm text-red-700">No negative feedback yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
