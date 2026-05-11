"use client";

import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";

export default function HomeCTA() {
    const router = useRouter();

    return (
        <section className="max-w-[900px] mx-auto px-5 pt-6 pb-16">
            <div className="bg-gradient-to-br from-indigo-500 to-violet-600 rounded-3xl px-10 py-12 text-center relative overflow-hidden">
                {/* Background decoration */}
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.15)_0%,transparent_60%)] pointer-events-none" />

                <h2 className="text-[1.8rem] font-extrabold text-white tracking-tight mb-3 relative z-10">
                    Ready to plan your dream trip?
                </h2>
                <p className="text-white/80 text-[15px] font-medium mb-7 max-w-[420px] mx-auto relative z-10">
                    Start chatting with our AI and get a complete travel plan in under 60 seconds.
                </p>
                <button
                    onClick={() => router.push("/chat?fresh=1")}
                    className="relative z-10 inline-flex items-center gap-2 bg-white text-indigo-600 font-bold text-[14px] py-3 px-7 rounded-xl hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 transition-all cursor-pointer border-none"
                >
                    Start Planning <ArrowRight size={16} />
                </button>
            </div>
        </section>
    );
}
