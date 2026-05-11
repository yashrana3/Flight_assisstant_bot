"use client";

import { Zap, Globe, ShieldCheck, Sparkles, Building2, TicketPercent } from "lucide-react";

const FEATURES = [
  {
    icon: <Sparkles className="text-indigo-500" size={24} />,
    title: "AI Itineraries",
    desc: "Personalized day-by-day plans built in seconds based on your vibe and budget.",
    bg: "bg-indigo-50",
    border: "border-indigo-100",
  },
  {
    icon: <Zap className="text-rose-500" size={24} />,
    title: "Live Price Tracking",
    desc: "Real-time alerts when flight prices drop, ensuring you never miss a great deal.",
    bg: "bg-rose-50",
    border: "border-rose-100",
  },
  {
    icon: <Globe className="text-teal-500" size={24} />,
    title: "Hidden Gems",
    desc: "Discover off-the-beaten-path locations only locals know about.",
    bg: "bg-teal-50",
    border: "border-teal-100",
  },
  {
    icon: <ShieldCheck className="text-emerald-500" size={24} />,
    title: "Visa Assistance",
    desc: "Instant insights on visa requirements, processing times, and document checklists.",
    bg: "bg-emerald-50",
    border: "border-emerald-100",
  },
  {
    icon: <Building2 className="text-sky-500" size={24} />,
    title: "Smart Stay curation",
    desc: "Hotel and Airbnb recommendations matched to your specific daily itinerary.",
    bg: "bg-sky-50",
    border: "border-sky-100",
  },
  {
    icon: <TicketPercent className="text-amber-500" size={24} />,
    title: "Flash Deals",
    desc: "Curated weekend getaway deals and last-minute flight steals.",
    bg: "bg-amber-50",
    border: "border-amber-100",
  },
];

export default function HomeFeatures() {
  return (
    <div className="max-w-[1100px] mx-auto px-5 pb-16">
      <div className="text-center mb-10">
        <h2 className="text-[2rem] font-extrabold text-slate-900 tracking-tight m-0 mb-3">
          Travel Smarter, Not Harder
        </h2>
        <p className="text-slate-500 text-[15px] font-medium m-0 max-w-[500px] mx-auto">
          Your AI assistant handles the painful parts of planning so you can focus on the experience.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {FEATURES.map((f, i) => (
          <div
            key={i}
            className="group bg-white border border-slate-200 rounded-3xl p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_8px_30px_rgba(15,23,42,0.06)] hover:border-indigo-100 cursor-default"
          >
            <div className={`w-12 h-12 rounded-2xl ${f.bg} border ${f.border} flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-300`}>
              {f.icon}
            </div>
            <h3 className="font-extrabold text-[16px] text-slate-900 mb-2">
              {f.title}
            </h3>
            <p className="text-slate-500 text-[13px] leading-relaxed">
              {f.desc}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
