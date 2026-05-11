"use client";

import { useState, useRef, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { MoreVertical, Edit2, Trash2, Calendar, MapPin, Plane, Hotel, Sparkles } from "lucide-react";
import { toast } from "sonner";
import AuthRequiredCard from "@/components/AuthRequiredCard";

// const initialItineraries = [
//     {
//         id: 1,
//         title: "European Summer Adventure",
//         type: "Multi-City",
//         dateRange: "Jun 15 - Jul 2, 2025",
//         destinations: ["Paris", "Rome", "Barcelona"],
//         duration: "18 days",
//         flights: 3,
//         hotels: 4,
//         activities: 12,
//         status: "Planned",
//         aiSuggestion: "Consider adding a day trip to Versailles from Paris and booking skip-the-line tickets for the Colosseum in Rome.",
//         details: {
//             flights: [
//                 { from: "New York", to: "Paris", date: "Jun 15, 2025", airline: "Air France", flightNumber: "AF 007" },
//                 { from: "Paris", to: "Rome", date: "Jun 21, 2025", airline: "Alitalia", flightNumber: "AZ 321" },
//                 { from: "Rome", to: "Barcelona", date: "Jun 27, 2025", airline: "Vueling", flightNumber: "VY 6104" },
//                 { from: "Barcelona", to: "New York", date: "Jul 2, 2025", airline: "United", flightNumber: "UA 58" },
//             ],
//             hotels: [
//                 { name: "Hotel du Louvre", location: "Paris", checkIn: "Jun 15", checkOut: "Jun 21" },
//                 { name: "Rome Cavalieri", location: "Rome", checkIn: "Jun 21", checkOut: "Jun 27" },
//                 { name: "W Barcelona", location: "Barcelona", checkIn: "Jun 27", checkOut: "Jul 2" },
//             ],
//             activities: [
//                 "Eiffel Tower Visit", "Louvre Museum Tour", "Seine River Cruise",
//                 "Vatican Museums", "Colosseum & Forum", "Sagrada Familia",
//                 "Park Güell", "Gothic Quarter Walking Tour",
//             ],
//         },
//     },
//     {
//         id: 2,
//         title: "Quick Business Trip to Tokyo",
//         type: "Round Trip",
//         dateRange: "Apr 8 - Apr 12, 2025",
//         destinations: ["Tokyo"],
//         duration: "5 days",
//         flights: 1,
//         hotels: 1,
//         activities: 3,
//         status: "Booked",
//         aiSuggestion: "Add JR Pass for convenient travel around Tokyo. Consider extending by 1 day to visit Mount Fuji.",
//         details: {
//             flights: [
//                 { from: "San Francisco", to: "Tokyo", date: "Apr 8, 2025", airline: "ANA", flightNumber: "NH 107" },
//                 { from: "Tokyo", to: "San Francisco", date: "Apr 12, 2025", airline: "ANA", flightNumber: "NH 108" },
//             ],
//             hotels: [{ name: "Park Hyatt Tokyo", location: "Shinjuku", checkIn: "Apr 8", checkOut: "Apr 12" }],
//             activities: ["Business Conference - Shibuya", "TeamLab Borderless", "Tsukiji Fish Market"],
//         },
//     },
//     {
//         id: 3,
//         title: "Caribbean Beach Getaway",
//         type: "Package Deal",
//         dateRange: "Feb 14 - Feb 21, 2025",
//         destinations: ["Cancun", "Tulum"],
//         duration: "7 days",
//         flights: 1,
//         hotels: 2,
//         activities: 8,
//         status: "Planned",
//         aiSuggestion: "Book a cenote diving experience in Tulum and consider renting a car for exploring the Riviera Maya.",
//         details: {
//             flights: [
//                 { from: "Chicago", to: "Cancun", date: "Feb 14, 2025", airline: "United", flightNumber: "UA 1457" },
//                 { from: "Cancun", to: "Chicago", date: "Feb 21, 2025", airline: "United", flightNumber: "UA 1458" },
//             ],
//             hotels: [
//                 { name: "Live Aqua Beach Resort", location: "Cancun", checkIn: "Feb 14", checkOut: "Feb 18" },
//                 { name: "Be Tulum Hotel", location: "Tulum", checkIn: "Feb 18", checkOut: "Feb 21" },
//             ],
//             activities: ["Snorkeling at Isla Mujeres", "Chichen Itza Day Trip", "Beach Relaxation", "Tulum Ruins Tour", "Cenote Swimming", "Playa del Carmen Shopping"],
//         },
//     },
// ];

function getStatusColor(status: string) {
    switch (status) {
        case "Booked": return "bg-[#DBEAFE] text-[#1E40AF]";
        case "Planned": return "bg-[#FEF3C7] text-[#92400E]";
        case "Saved": return "bg-[#E0E7FF] text-[#3730A3]";
        default: return "bg-[#F3F4F6] text-[#374151]";
    }
}

type ItineraryDetails = {
    days: Array<{
        day: string;
        title: string;
        agenda: string;
        estimated_budget_inr?: string;
    }>;
    flights: Array<{
        from: string;
        to: string;
        date: string;
        airline: string;
        flightNumber: string;
    }>;
    hotels: Array<{
        name: string;
        location: string;
        checkIn: string;
        checkOut: string;
    }>;
    activities: string[];
};

type Itinerary = {
    id: number | string;
    title: string;
    type: string;
    dateRange: string;
    destinations: string[];
    duration: string;
    flights: number;
    hotels: number;
    activities: number;
    status: string;
    aiSuggestion: string;
    details: ItineraryDetails;
};

function parseDayPlansFromSuggestion(aiSuggestion: string) {
    const lines = (aiSuggestion || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

    const dayPlans: ItineraryDetails["days"] = [];

    for (const line of lines) {
        const match = line.match(
            /^(?:[-*]\s*)?(Day\s*\d+)\s*[:\-]\s*(.+?)(?:\s*[—-]\s*|\s+-\s+)(.+)$/i,
        );
        if (!match) continue;

        dayPlans.push({
            day: match[1].replace(/\s+/g, " ").trim(),
            title: match[2].trim(),
            agenda: match[3].trim(),
        });
    }

    return dayPlans;
}

function getResolvedDayPlans(itinerary: Itinerary) {
    const savedDayPlans = itinerary.details?.days || [];
    if (savedDayPlans.length > 0) {
        return savedDayPlans;
    }

    return parseDayPlansFromSuggestion(itinerary.aiSuggestion);
}

export default function ItinerariesPage() {
    const { isLoaded, isSignedIn } = useUser();

    const [itineraries, setItineraries] = useState<Itinerary[]>([]);
    const [openKebabMenu, setOpenKebabMenu] = useState<number | string | null>(null);
    const [selectedItinerary, setSelectedItinerary] = useState<Itinerary | null>(null);
    const [isAIGeneratedCandidate, setIsAIGeneratedCandidate] = useState(false);

    const [tripDetails, setTripDetails] = useState("");
    const [isGenerating, setIsGenerating] = useState(false);
    const [isLoadingItineraries, setIsLoadingItineraries] = useState(false);
    const [isSavingItinerary, setIsSavingItinerary] = useState(false);
    const kebabRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (kebabRef.current && !kebabRef.current.contains(event.target as Node)) {
                setOpenKebabMenu(null);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    useEffect(() => {
        if (!isLoaded || !isSignedIn) return;
        setIsLoadingItineraries(true);

        fetch("/api/itineraries", { cache: "no-store" })
            .then(async (res) => {
                if (!res.ok) {
                    const data = await res.json().catch(() => null);
                    throw new Error(data?.detail ?? "Failed to load itineraries");
                }
                return res.json();
            })
            .then((data) => {
                setItineraries(data?.itineraries ?? []);
            })
            .catch((err) => {
                toast.error(
                    err instanceof Error ? err.message : "Failed to load itineraries",
                );
                setItineraries([]);
            })
            .finally(() => setIsLoadingItineraries(false));
    }, [isLoaded, isSignedIn]);

    if (!isLoaded) {
        return (
            <div className="min-h-screen bg-white">
                <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-24 lg:pb-8">
                    <div className="rounded-xl border border-[#E5E7EB] bg-white p-8 text-center text-[#6B7280]">
                        Loading your itineraries...
                    </div>
                </div>
            </div>
        );
    }

    if (!isSignedIn) {
        return (
            <AuthRequiredCard
                title="Log in to view itineraries"
                description="Saved itineraries are tied to your account. Sign in to open and manage your travel plans here."
                redirectUrl="/itineraries"
            />
        );
    }

    return (
        <div className="min-h-screen bg-white">
            <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-24 lg:pb-8">
                <div style={{ animation: "fadeIn 0.5s ease-out" }}>
                    {/* Header */}
                    <div className="mb-6 sm:mb-8">
                        <h1 className="text-[#0A2140] mb-2" style={{ fontSize: "24px", fontWeight: "600" }}>
                            My Itineraries
                        </h1>
                        <p className="text-[#6B7280] text-sm sm:text-base">
                            Manage your saved travel plans and itineraries
                        </p>
                    </div>

                    {/* AI Generate */}
                    <div className="mb-6 sm:mb-8">
                        <div className="bg-gradient-to-r from-[#EFF6FF] to-[#DBEAFE] border border-[#93C5FD] rounded-xl p-4 sm:p-5">
                            <div className="flex items-start gap-3">
                                <div className="p-2 bg-[#0B5FFF] rounded-lg flex-shrink-0">
                                    <Sparkles className="w-5 h-5 text-white" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h2 className="text-[#0A2140] text-base sm:text-lg font-semibold">
                                        Create Itinerary With AI
                                    </h2>
                                    <p className="text-[#374151] text-sm mt-1">
                                        Enter your trip details, then click <span className="font-semibold">Generate With AI</span>.
                                    </p>

                                    <label
                                        className="block text-[#0A2140] text-sm font-semibold mt-4 mb-2"
                                    >
                                        Your trip details
                                    </label>
                                    <textarea
                                        value={tripDetails}
                                        onChange={(e) => setTripDetails(e.target.value)}
                                        rows={4}
                                        placeholder="Example: 6 days in Paris & Rome, mid-June, budget ₹60k, like museums + food, want 1 romantic dinner."
                                        className="w-full rounded-xl border border-[#E5E7EB] px-4 py-3 text-sm text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8] resize-none"
                                    />

                                    <div className="mt-4 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-end">
                                        <button
                                            type="button"
                                            onClick={() => setTripDetails("")}
                                            className="px-4 py-2 rounded-lg text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6] border-none cursor-pointer"
                                            disabled={isGenerating}
                                        >
                                            Clear
                                        </button>
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                if (!tripDetails.trim()) {
                                                    toast.error("Please enter your trip details.");
                                                    return;
                                                }
                                                setIsGenerating(true);
                                                const toastId = toast.loading("Generating itinerary with AI…");

                                                try {
                                                    const message = [
                                                        "Create a personalized day-by-day travel itinerary for the user.",
                                                        "Do NOT search for flights or prices. Focus on itinerary only.",
                                                        "Return ONLY plain text itinerary (no JSON, no extra commentary).",
                                                        "Trip details:",
                                                        tripDetails.trim(),
                                                    ].join("\n");

                                                    const res = await fetch("/api/chat", {
                                                        method: "POST",
                                                        headers: { "Content-Type": "application/json" },
                                                        body: JSON.stringify({
                                                            message,
                                                            history: [],
                                                        }),
                                                    });

                                                    const data = await res.json().catch(() => null);
                                                    if (!res.ok) {
                                                        throw new Error(
                                                            data?.detail ??
                                                                "AI itinerary generation failed.",
                                                        );
                                                    }

                                                    const itineraryText =
                                                        typeof data?.text === "string"
                                                            ? data.text
                                                            : "AI generated an itinerary. (No text returned)";

                                                    const candidate: Itinerary = {
                                                        id: Date.now(),
                                                        title: "AI Itinerary",
                                                        type: "Custom",
                                                        dateRange: "—",
                                                        destinations: ["Your Trip"],
                                                        duration: "—",
                                                        flights: 0,
                                                        hotels: 0,
                                                        activities: 0,
                                                        status: "Planned",
                                                        aiSuggestion: itineraryText,
                                                        details: {
                                                            days: parseDayPlansFromSuggestion(itineraryText),
                                                            flights: [],
                                                            hotels: [],
                                                            activities: [],
                                                        },
                                                    };

                                                    setSelectedItinerary(candidate);
                                                    setIsAIGeneratedCandidate(true);
                                                    toast.success(
                                                        "Itinerary generated. Review and save when ready.",
                                                        { id: toastId },
                                                    );
                                                } catch (err) {
                                                    toast.error(
                                                        err instanceof Error
                                                            ? err.message
                                                            : "AI generation failed.",
                                                        { id: toastId },
                                                    );
                                                } finally {
                                                    setIsGenerating(false);
                                                }
                                            }}
                                            disabled={isGenerating}
                                            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-[#1D4ED8] hover:bg-[#1E40AF] disabled:opacity-50 border-none cursor-pointer"
                                        >
                                            {isGenerating ? "Generating…" : "Generate With AI"}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Itinerary Cards Grid */}
                    {isLoadingItineraries ? (
                        <div className="rounded-xl border border-[#E5E7EB] bg-white p-8 text-center text-[#6B7280] mb-6">
                            Loading itineraries…
                        </div>
                    ) : null}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                        {itineraries.map((itinerary, idx) => (
                            <div
                                key={itinerary.id}
                                className="bg-white border border-[#E5E7EB] rounded-xl p-4 sm:p-6 cursor-pointer hover:border-[#0B5FFF] transition-all hover:shadow-md relative animate-slide-up"
                                style={{ animationDelay: `${idx * 0.1}s` }}
                                onClick={() => {
                                    setSelectedItinerary(itinerary);
                                    setIsAIGeneratedCandidate(false);
                                }}
                            >
                                {/* Kebab Menu */}
                                <div className="absolute top-4 right-4 kebab-menu" ref={openKebabMenu === itinerary.id ? kebabRef : null}>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setOpenKebabMenu(openKebabMenu === itinerary.id ? null : itinerary.id);
                                        }}
                                        className="p-2 hover:bg-[#F9FAFB] rounded-lg transition-colors cursor-pointer border-none bg-transparent"
                                    >
                                        <MoreVertical className="w-5 h-5 text-[#6B7280]" />
                                    </button>
                                    {openKebabMenu === itinerary.id && (
                                        <div
                                            className="absolute right-0 top-10 w-48 bg-white rounded-lg shadow-lg border border-[#E5E7EB] py-2 z-10"
                                            style={{ animation: "dropdownFadeIn 0.15s ease-out" }}
                                        >
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setOpenKebabMenu(null); }}
                                                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[#374151] hover:bg-[#F9FAFB] transition-colors cursor-pointer border-none bg-transparent"
                                            >
                                                <Edit2 className="w-4 h-4" /> Edit
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    void (async () => {
                                                        const toastId = toast.loading(
                                                            "Deleting itinerary…",
                                                        );
                                                        try {
                                                            const res = await fetch(
                                                                `/api/itineraries/${encodeURIComponent(
                                                                    itinerary.id,
                                                                )}`,
                                                                { method: "DELETE" },
                                                            );
                                                            const data = await res
                                                                .json()
                                                                .catch(() => null);
                                                            if (!res.ok) {
                                                                throw new Error(
                                                                    data?.detail ??
                                                                        "Delete failed",
                                                                );
                                                            }
                                                            setItineraries((prev) =>
                                                                prev.filter(
                                                                    (i) => i.id !== itinerary.id,
                                                                ),
                                                            );
                                                            toast.success(
                                                                "Itinerary deleted.",
                                                                { id: toastId },
                                                            );
                                                        } catch (err) {
                                                            toast.error(
                                                                err instanceof Error
                                                                    ? err.message
                                                                    : "Delete failed.",
                                                                { id: toastId },
                                                            );
                                                        } finally {
                                                            setOpenKebabMenu(null);
                                                        }
                                                    })();
                                                }}
                                                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[#DC2626] hover:bg-[#FEF2F2] transition-colors cursor-pointer border-none bg-transparent"
                                            >
                                                <Trash2 className="w-4 h-4" /> Delete
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {/* Card Content */}
                                <div className="pr-10 sm:pr-12">
                                    <div className="flex items-start justify-between mb-3">
                                        <div className="flex-1">
                                            <h3 className="text-[#0A2140] mb-1 pr-2" style={{ fontSize: "16px", fontWeight: "600" }}>
                                                {itinerary.title}
                                            </h3>
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className={`${getStatusColor(itinerary.status)} px-2 py-0.5 rounded-full text-xs font-medium`}>
                                                    {itinerary.status}
                                                </span>
                                                <span className="text-[#6B7280] text-xs sm:text-sm">{itinerary.type}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 text-[#6B7280] mb-3 sm:mb-4 flex-wrap">
                                        <Calendar className="w-4 h-4 flex-shrink-0" />
                                        <span className="text-xs sm:text-sm">{itinerary.dateRange}</span>
                                        <span className="text-xs sm:text-sm">• {itinerary.duration}</span>
                                    </div>

                                    <div className="flex items-center gap-2 mb-3 sm:mb-4">
                                        <MapPin className="w-4 h-4 text-[#0B5FFF] flex-shrink-0" />
                                        <span className="text-xs sm:text-sm text-[#374151] line-clamp-1">
                                            {itinerary.destinations.join(" → ")}
                                        </span>
                                    </div>

                                    <div className="flex items-center gap-3 sm:gap-4 text-xs sm:text-sm text-[#6B7280] flex-wrap">
                                        <div className="flex items-center gap-1.5">
                                            <Plane className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                                            <span>{itinerary.flights} {itinerary.flights === 1 ? "Flight" : "Flights"}</span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <Hotel className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                                            <span>{itinerary.hotels} {itinerary.hotels === 1 ? "Hotel" : "Hotels"}</span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <MapPin className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                                            <span>{itinerary.activities} Activities</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Detail Modal */}
            {selectedItinerary && (
                <div
                    className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
                    onClick={() => {
                        setSelectedItinerary(null);
                        setIsAIGeneratedCandidate(false);
                    }}
                >
                    <div
                        className="bg-white rounded-2xl max-w-[860px] w-full max-h-[88vh] overflow-y-auto p-5 sm:p-6"
                        onClick={(e) => e.stopPropagation()}
                        style={{ animation: "fadeIn 0.2s ease-out" }}
                    >
                        <div className="mb-5 pb-4 border-b border-[#E5E7EB]">
                            <h2 className="text-[#0A2140] mb-1" style={{ fontSize: "20px", fontWeight: "700" }}>
                                {selectedItinerary.title}
                            </h2>
                            <div className="flex flex-wrap items-center gap-2 text-[#6B7280] text-xs sm:text-sm">
                                <Calendar className="w-3.5 h-3.5" />
                                <span>{selectedItinerary.dateRange} • {selectedItinerary.duration}</span>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                                <span className="px-2.5 py-1 rounded-full text-[11px] bg-[#F5F3FF] text-[#6D28D9] border border-[#DDD6FE]">
                                    {getResolvedDayPlans(selectedItinerary).length} Day Plans
                                </span>
                                <span className="px-2.5 py-1 rounded-full text-[11px] bg-[#EFF6FF] text-[#0B5FFF] border border-[#BFDBFE]">
                                    {(selectedItinerary.details?.flights || []).length} Flights
                                </span>
                                <span className="px-2.5 py-1 rounded-full text-[11px] bg-[#ECFDF3] text-[#047857] border border-[#A7F3D0]">
                                    {(selectedItinerary.details?.hotels || []).length} Hotels
                                </span>
                                <span className="px-2.5 py-1 rounded-full text-[11px] bg-[#FFF7ED] text-[#C2410C] border border-[#FED7AA]">
                                    {(selectedItinerary.details?.activities || []).length} Activities
                                </span>
                            </div>
                        </div>

                        {/* AI Suggestion */}
                        <div className="bg-gradient-to-r from-[#EFF6FF] to-[#DBEAFE] border border-[#93C5FD] rounded-xl p-3 sm:p-4 mb-6">
                            <div className="flex items-start gap-2 sm:gap-3">
                                <div className="p-1.5 sm:p-2 bg-[#0B5FFF] rounded-lg flex-shrink-0">
                                    <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h4 className="text-[#0A2140] mb-1" style={{ fontSize: "13px", fontWeight: "600" }}>AI Suggestions</h4>
                                    <p className="text-[#374151] text-xs sm:text-sm leading-relaxed">{selectedItinerary.aiSuggestion}</p>
                                </div>
                            </div>
                        </div>

                        {/* Day-by-day Plan */}
                        <div className="mb-6 rounded-xl border border-[#E5E7EB] bg-white p-4">
                            <h4 className="text-[#0A2140] mb-3 flex items-center gap-2" style={{ fontSize: "14px", fontWeight: "700" }}>
                                <Calendar className="w-4 h-4 text-[#7C3AED]" />
                                Day-by-Day Plan ({getResolvedDayPlans(selectedItinerary).length})
                            </h4>
                            <div className="space-y-3">
                                {getResolvedDayPlans(selectedItinerary).length === 0 && (
                                    <div className="bg-[#F9FAFB] rounded-lg p-3 text-xs sm:text-sm text-[#6B7280]">
                                        No day-by-day plan was saved for this itinerary yet.
                                    </div>
                                )}
                                {getResolvedDayPlans(selectedItinerary).map((plan, i) => (
                                    <div key={`${plan.day}-${i}`} className="rounded-lg border border-[#E5E7EB] bg-[#FCFCFF] p-3 sm:p-4">
                                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                            <div>
                                                <div className="text-[#7C3AED] text-xs font-semibold uppercase tracking-wide">
                                                    {plan.day}
                                                </div>
                                                <div className="text-[#0A2140] font-medium text-sm sm:text-base">
                                                    {plan.title}
                                                </div>
                                            </div>
                                            {plan.estimated_budget_inr ? (
                                                <span className="inline-flex w-fit rounded-full bg-[#F3E8FF] px-2.5 py-1 text-[11px] font-medium text-[#6B21A8]">
                                                    Budget INR {plan.estimated_budget_inr}
                                                </span>
                                            ) : null}
                                        </div>
                                        <p className="mt-2 text-xs leading-relaxed text-[#4B5563] sm:text-sm">
                                            {plan.agenda}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Flights */}
                        <div className="mb-6 rounded-xl border border-[#E5E7EB] bg-white p-4">
                            <h4 className="text-[#0A2140] mb-3 flex items-center gap-2" style={{ fontSize: "14px", fontWeight: "700" }}>
                                <Plane className="w-4 h-4 text-[#0B5FFF]" />
                                Flights ({(selectedItinerary.details?.flights || []).length})
                            </h4>
                            <div className="space-y-2">
                                {(selectedItinerary.details?.flights || []).length === 0 && (
                                    <div className="bg-[#F9FAFB] rounded-lg p-3 text-xs sm:text-sm text-[#6B7280]">
                                        No flight segments saved for this itinerary.
                                    </div>
                                )}
                                {(selectedItinerary.details?.flights || []).map((flight, i) => (
                                    <div key={i} className="bg-[#F9FAFB] rounded-lg p-3 sm:p-4">
                                        <div className="text-[#0A2140] font-medium mb-1 text-sm">{flight.from} → {flight.to}</div>
                                        <div className="text-xs sm:text-sm text-[#6B7280]">{flight.airline} {flight.flightNumber} • {flight.date}</div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Hotels */}
                        <div className="mb-6 rounded-xl border border-[#E5E7EB] bg-white p-4">
                            <h4 className="text-[#0A2140] mb-3 flex items-center gap-2" style={{ fontSize: "14px", fontWeight: "700" }}>
                                <Hotel className="w-4 h-4 text-[#0B5FFF]" />
                                Hotels ({(selectedItinerary.details?.hotels || []).length})
                            </h4>
                            <div className="space-y-2">
                                {(selectedItinerary.details?.hotels || []).length === 0 && (
                                    <div className="bg-[#F9FAFB] rounded-lg p-3 text-xs sm:text-sm text-[#6B7280]">
                                        No hotel recommendations saved for this itinerary.
                                    </div>
                                )}
                                {(selectedItinerary.details?.hotels || []).map((hotel, i) => (
                                    <div key={i} className="bg-[#F9FAFB] rounded-lg p-3 sm:p-4">
                                        <div className="text-[#0A2140] font-medium mb-1 text-sm">{hotel.name}</div>
                                        <div className="text-xs sm:text-sm text-[#6B7280]">{hotel.location} • {hotel.checkIn} to {hotel.checkOut}</div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Activities */}
                        <div className="mb-6 rounded-xl border border-[#E5E7EB] bg-white p-4">
                            <h4 className="text-[#0A2140] mb-3 flex items-center gap-2" style={{ fontSize: "14px", fontWeight: "700" }}>
                                <MapPin className="w-4 h-4 text-[#0B5FFF]" />
                                Activities ({(selectedItinerary.details?.activities || []).length})
                            </h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {(selectedItinerary.details?.activities || []).length === 0 && (
                                    <div className="sm:col-span-2 bg-[#F9FAFB] rounded-lg p-3 text-xs sm:text-sm text-[#6B7280]">
                                        No activities saved for this itinerary yet.
                                    </div>
                                )}
                                {(selectedItinerary.details?.activities || []).map((activity, i) => (
                                    <div key={i} className="bg-[#F9FAFB] rounded-lg p-2.5 sm:p-3 text-xs sm:text-sm text-[#374151]">
                                        {activity}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-end">
                            {isAIGeneratedCandidate && (
                                <div className="w-full sm:w-auto p-3 rounded-lg border border-[#E5E7EB] bg-[#FAFAFA]">
                                    <p className="text-[#0A2140] text-sm font-semibold mb-2">
                                        Do you want to save this itinerary?
                                    </p>
                                    <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-end">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSelectedItinerary(null);
                                                setIsAIGeneratedCandidate(false);
                                            }}
                                            className="px-4 py-2 rounded-lg text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6] border-none cursor-pointer"
                                        >
                                            No
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (!selectedItinerary) return;
                                                void (async () => {
                                                    setIsSavingItinerary(true);
                                                    const toastId = toast.loading(
                                                        "Saving itinerary…",
                                                    );
                                                    try {
                                                        const res = await fetch(
                                                            "/api/itineraries",
                                                            {
                                                                method: "POST",
                                                                headers: {
                                                                    "Content-Type":
                                                                        "application/json",
                                                                },
                                                                body: JSON.stringify({
                                                                    title:
                                                                        selectedItinerary.title,
                                                                    type:
                                                                        selectedItinerary.type,
                                                                    dateRange:
                                                                        selectedItinerary.dateRange,
                                                                    duration:
                                                                        selectedItinerary.duration,
                                                                    destinations:
                                                                        selectedItinerary.destinations,
                                                                    flights:
                                                                        selectedItinerary.flights,
                                                                    hotels:
                                                                        selectedItinerary.hotels,
                                                                    activities:
                                                                        selectedItinerary.activities,
                                                                    status: "Saved",
                                                                    aiSuggestion:
                                                                        selectedItinerary.aiSuggestion,
                                                                    details:
                                                                        selectedItinerary.details,
                                                                }),
                                                            },
                                                        );
                                                        const data = await res
                                                            .json()
                                                            .catch(() => null);
                                                        if (!res.ok) {
                                                            throw new Error(
                                                                data?.detail ??
                                                                    "Save failed",
                                                            );
                                                        }

                                                        const savedItinerary =
                                                            data?.itinerary as Itinerary;
                                                        setItineraries((prev) => [
                                                            savedItinerary,
                                                            ...prev,
                                                        ]);
                                                        setSelectedItinerary(
                                                            savedItinerary,
                                                        );
                                                        setIsAIGeneratedCandidate(false);
                                                        toast.success(
                                                            "Itinerary saved.",
                                                            { id: toastId },
                                                        );
                                                    } catch (err) {
                                                        toast.error(
                                                            err instanceof Error
                                                                ? err.message
                                                                : "Save failed.",
                                                            { id: toastId },
                                                        );
                                                    } finally {
                                                        setIsSavingItinerary(false);
                                                    }
                                                })();
                                            }}
                                            disabled={isSavingItinerary}
                                            className="px-6 py-2 rounded-lg text-sm font-medium text-white bg-[#0B5FFF] hover:bg-[#0847CC] border-none cursor-pointer disabled:opacity-50"
                                        >
                                            Yes, save
                                        </button>
                                    </div>
                                </div>
                            )}
                            <button
                                onClick={() => {
                                    setSelectedItinerary(null);
                                    setIsAIGeneratedCandidate(false);
                                }}
                                className="bg-[#0B5FFF] hover:bg-[#0847CC] text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer border-none"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
