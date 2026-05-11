"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

const destinations = [
    { name: "Dubai", country: "UAE", price: "₹18,499", tag: "Best Seller", gradient: "from-indigo-500 to-violet-500" },
    { name: "Bali", country: "Indonesia", price: "₹24,300", tag: "Trending", gradient: "from-indigo-500 to-violet-500" },
    { name: "Paris", country: "France", price: "₹34,500", tag: "Romantic", gradient: "from-indigo-500 to-violet-500" },
    { name: "Tokyo", country: "Japan", price: "₹32,800", tag: "Popular", gradient: "from-indigo-500 to-violet-500" },
    { name: "Maldives", country: "Indian Ocean", price: "₹42,000", tag: "Luxury", gradient: "from-indigo-500 to-violet-500" },
];

export default function HomeTrending() {
    return (
        <section className="max-w-[1100px] mx-auto px-5 py-14">
            <div className="flex items-end justify-between mb-8">
                <div>
                    <h2 className="text-[1.8rem] font-extrabold text-slate-900 tracking-tight mb-2">
                        Trending Destinations
                    </h2>
                    <p className="text-slate-500 text-[14px] font-medium">
                        Popular picks from Indian travelers this month
                    </p>
                </div>
                <Link href="/deals" className="flex items-center gap-1.5 text-[13px] font-semibold text-indigo-600 hover:text-indigo-700 transition-colors">
                    View all deals <ArrowRight size={14} />
                </Link>
            </div>

            <div className="grid grid-cols-5 gap-4">
                {destinations.map((d, i) => (
                    <Link key={i} href={`/chat?q=${encodeURIComponent(`Plan a trip to ${d.name}`)}`} className="group block">
                        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
                            {/* Gradient placeholder for destination image */}
                            <div className={`bg-gradient-to-br ${d.gradient} h-28 flex items-end p-3 relative`}>
                                <span className="bg-white/20 backdrop-blur-sm text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                                    {d.tag}
                                </span>
                            </div>
                            <div className="p-3.5">
                                <div className="font-extrabold text-[15px] text-slate-900 mb-0.5 group-hover:text-indigo-600 transition-colors">{d.name}</div>
                                <div className="text-[11px] text-slate-400 mb-2">{d.country}</div>
                                <div className="flex items-center justify-between">
                                    <span className="font-extrabold text-[15px] text-indigo-600">{d.price}</span>
                                    <span className="text-[10px] text-slate-400">round trip</span>
                                </div>
                            </div>
                        </div>
                    </Link>
                ))}
            </div>
        </section>
    );
}
