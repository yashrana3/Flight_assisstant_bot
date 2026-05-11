"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send, Sparkles } from "lucide-react";

const QUICK_PROMPTS = [
  "Plan a 5-day Tokyo trip under ₹90k",
  "Best beach destinations from Delhi in April",
  "Cheapest flights to Dubai this weekend",
  "7-day Europe itinerary for couples",
];

export default function HomeHero() {
  const [input, setInput] = useState("");
  const router = useRouter();

  const handleSend = (msg?: string) => {
    const t = msg || input.trim();
    if (!t) return;
    router.push(`/chat?fresh=1&q=${encodeURIComponent(t)}`);
  };

  return (
    <section className="relative overflow-hidden pt-16 pb-20 px-5">
      {/* Subtle gradient glow */}
      <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-[radial-gradient(ellipse,rgba(99,102,241,0.15)_0%,transparent_65%)] pointer-events-none" />

      <div className="relative max-w-[780px] mx-auto text-center">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/25 rounded-full py-1.5 px-4 mb-6 text-[12px] font-semibold text-indigo-600">
          <Sparkles size={13} />
          AI-Powered Travel Planning
        </div>

        {/* Headline */}
        <h1 className="text-[clamp(2.2rem,5.5vw,3.6rem)] font-extrabold leading-[1.1] tracking-tight text-slate-900 mb-5">
          Plan your next trip{" "}
          <span className="bg-gradient-to-r from-indigo-500 via-violet-500 to-sky-400 bg-clip-text text-transparent">
            in seconds
          </span>
        </h1>

        <p className="text-[16px] text-slate-500 font-medium leading-relaxed mb-10 max-w-[520px] mx-auto">
          Just tell our AI where you want to go. Get personalized itineraries,
          real-time flight prices, and hidden gems — instantly.
        </p>

        {/* Search box */}
        <div className="bg-white border border-slate-200 rounded-2xl flex items-center py-3 px-4 gap-3 max-w-[640px] mx-auto shadow-[0_16px_48px_rgba(15,23,42,0.08),0_0_0_1px_rgba(99,102,241,0.08)] mb-5 focus-within:ring-2 focus-within:ring-indigo-200 focus-within:border-indigo-300 transition-all">
          <Sparkles size={18} className="text-indigo-400 flex-shrink-0" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Ask anything — flights, itineraries, visa info, deals..."
            className="flex-1 bg-transparent border-none outline-none text-slate-900 text-[14px] placeholder:text-slate-400"
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim()}
            className={`flex items-center gap-2 py-2.5 px-5 rounded-xl border-none cursor-pointer text-[13px] font-bold transition-all whitespace-nowrap ${input.trim()
                ? "bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-md hover:shadow-lg hover:-translate-y-0.5"
                : "bg-slate-100 text-slate-400 cursor-default"
              }`}
          >
            <Send size={14} />
            Ask AI
          </button>
        </div>

        {/* Quick prompts */}
        <div className="flex flex-wrap justify-center gap-2">
          {QUICK_PROMPTS.map((p, i) => (
            <button
              key={i}
              onClick={() => handleSend(p)}
              className="bg-white/60 border border-slate-200 rounded-full py-1.5 px-3.5 text-[12px] font-medium text-slate-600 hover:border-indigo-200 hover:text-indigo-700 hover:bg-indigo-50/50 hover:-translate-y-0.5 transition-all cursor-pointer"
            >
              {p}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
