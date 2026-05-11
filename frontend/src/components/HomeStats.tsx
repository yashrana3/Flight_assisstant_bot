import { Users, Plane, MapPinned, Star } from "lucide-react";

const stats = [
    { icon: <Users size={18} className="text-indigo-500" />, value: "52,000+", label: "Travelers Assisted" },
    { icon: <Plane size={18} className="text-indigo-500" />, value: "1.2M+", label: "Flights Searched" },
    { icon: <MapPinned size={18} className="text-indigo-500" />, value: "180+", label: "Destinations Covered" },
    { icon: <Star size={18} className="text-indigo-500" />, value: "4.9", label: "User Rating" },
];

export default function HomeStats() {
    return (
        <section className="max-w-[900px] mx-auto px-5 py-6">
            <div className="bg-white border border-slate-200 rounded-2xl px-8 py-5 flex items-center justify-between gap-6">
                {stats.map((s, i) => (
                    <div key={i} className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
                            {s.icon}
                        </div>
                        <div>
                            <div className="font-extrabold text-[18px] text-slate-900 leading-tight">{s.value}</div>
                            <div className="text-[11px] text-slate-500 font-medium">{s.label}</div>
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}
