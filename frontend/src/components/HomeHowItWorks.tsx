import { MessageCircleMore, MapPinned, Plane } from "lucide-react";

const steps = [
    {
        step: "01",
        icon: <MessageCircleMore size={24} className="text-indigo-500" />,
        title: "Tell Us What You Want",
        desc: "Type a natural language query — where you want to go, your budget, travel style, and dates.",
    },
    {
        step: "02",
        icon: <MapPinned size={24} className="text-indigo-500" />,
        title: "Get a Full Plan",
        desc: "Our AI builds a day-by-day itinerary with places to visit, costs, visa tips, and local insights.",
    },
    {
        step: "03",
        icon: <Plane size={24} className="text-indigo-500" />,
        title: "Book & Go",
        desc: "Find the best-priced flights, save your documents, and jet off with everything organized.",
    },
];

export default function HomeHowItWorks() {
    return (
        <section className="max-w-[1000px] mx-auto px-5 py-14">
            <div className="text-center mb-10">
                <h2 className="text-[1.8rem] font-extrabold text-slate-900 tracking-tight mb-2">
                    How It Works
                </h2>
                <p className="text-slate-500 text-[14px] font-medium max-w-[420px] mx-auto">
                    Three steps to your perfect trip — no research rabbit-holes required.
                </p>
            </div>

            <div className="grid grid-cols-3 gap-6">
                {steps.map((s, i) => (
                    <div key={i} className="relative text-center">
                        {/* Connector line */}
                        {i < steps.length - 1 && (
                            <div className="hidden lg:block absolute top-10 left-[calc(50%+40px)] w-[calc(100%-80px)] h-px bg-indigo-200 z-0" />
                        )}
                        <div className="relative z-10 flex flex-col items-center">
                            <div className="w-20 h-20 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center mb-5">
                                {s.icon}
                            </div>
                            <div className="text-[11px] text-indigo-500 font-bold mb-2 tracking-wider">STEP {s.step}</div>
                            <h3 className="font-extrabold text-[16px] text-slate-900 mb-2">{s.title}</h3>
                            <p className="text-slate-500 text-[13px] leading-relaxed max-w-[250px] mx-auto">{s.desc}</p>
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}
