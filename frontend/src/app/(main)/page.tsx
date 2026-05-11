"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Search,
  Sparkles,
  TrendingUp,
} from "lucide-react";

const quickSuggestions = [
  { text: "Weekend deals from Delhi", icon: "🎯" },
  { text: "High-value flights for mile earning", icon: "💰" },
  { text: "Visa-free destinations for Indian passport holders", icon: "🌍" },
  { text: "Best time to fly to Dubai", icon: "⏰" },
  { text: "Premium cabin upgrade opportunities", icon: "✈️" },
];

export default function Home() {
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F8FAFC] via-white to-[#EEF2FF] flex flex-col">
      <div className="flex-1 flex items-center justify-center px-4 sm:px-6 py-8 pb-24 sm:py-0">
        <div className="max-w-[800px] w-full">
          {/* Hero Section */}
          <div
            className="text-center"
            style={{ animation: "fadeIn 0.6s ease-out" }}
          >
            <div className="mb-6 sm:mb-8">
              <h1
                className="text-[#0A2140] mb-2 sm:mb-3 px-2  text-xl sm:text-2xl md:text-3xl lg:text-4xl xl:text-5xl"
                style={{ fontWeight: "700" }}
              >
                Your AI Travel Assistant
              </h1>
              <p
                className="text-[#6B7280] px-4"
                style={{ fontSize: "16px" }}
              >
                Find the smartest flight options, tailored for you
              </p>
            </div>

            {/* Main Search Bar */}
            <div className="max-w-[700px] mx-auto mb-4 sm:mb-6">
              <div className="relative">
                <Search className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-[#6B7280]" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onClick={() => {
                    const params = new URLSearchParams({ fresh: "1" });
                    if (searchQuery) {
                      params.set("q", searchQuery);
                    }
                    window.location.href = `/chat?${params.toString()}`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const params = new URLSearchParams({ fresh: "1" });
                      if (searchQuery) {
                        params.set("q", searchQuery);
                      }
                      window.location.href = `/chat?${params.toString()}`;
                    }
                  }}
                  placeholder="Ask anything: Find flights from Delhi to Dubai next weekend"
                  className="w-full pl-10 sm:pl-12 pr-3 sm:pr-4 py-3 sm:py-3 text-sm sm:text-m rounded-2xl border-2 border-[#E5E7EB] focus:border-[#1D4ED8] focus:outline-none shadow-lg bg-white cursor-text"
                />
              </div>
            </div>

            {/* CTA Buttons */}
            <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 mb-8 sm:mb-12 px-4">
              <Link
                href="/chat?fresh=1"
                className="bg-[#1D4ED8] hover:bg-[#1E40AF] text-white flex items-center gap-1.5 sm:gap-2 h-10 sm:h-11 px-4 sm:px-6 text-sm sm:text-base font-medium rounded-lg transition-colors"
              >
                <Sparkles className="w-4 h-4 sm:w-5 sm:h-5" />
                Start with AI
              </Link>

              <Link
                href="/deals"
                className="text-[#374151] hover:bg-[#F3F4F6] flex items-center gap-1.5 sm:gap-2 h-10 sm:h-11 px-4 sm:px-6 text-sm sm:text-base font-medium rounded-lg transition-colors"
              >
                <TrendingUp className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                Track Prices
              </Link>
            </div>
          </div>

          {/* Quick Suggestions */}
          <div style={{ animation: "fadeIn 0.6s ease-out 0.1s both" }}>
            <h2
              className="text-[#0A2140] mb-3 sm:mb-4 text-center px-4"
              style={{ fontSize: "16px", fontWeight: "600" }}
            >
              ✨ AI-Powered Suggestions
            </h2>
            <div className="flex flex-wrap justify-center gap-2 sm:gap-3 px-2">
              {quickSuggestions.map((suggestion, idx) => (
                <Link
                  key={idx}
                  href={`/chat?fresh=1&q=${encodeURIComponent(suggestion.text)}`}
                  className="bg-white hover:bg-[#F9FAFB] border border-[#E5E7EB] rounded-full px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm text-[#374151] transition-all hover:shadow-md hover:border-[#0B5FFF] flex items-center gap-1.5 sm:gap-2"
                >
                  <span className="text-sm sm:text-base">
                    {suggestion.icon}
                  </span>
                  <span className="line-clamp-1">{suggestion.text}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
