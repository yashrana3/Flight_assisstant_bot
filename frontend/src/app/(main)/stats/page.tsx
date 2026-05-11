"use client";

import { useEffect, useMemo, useState } from "react";
import { useUser } from "@clerk/nextjs";
import AuthRequiredCard from "@/components/AuthRequiredCard";
import {
    TrendingUp,
    Award,
    Plane,
    Globe,
    Star,
    Flame,
    Trophy,
    Sparkles,
    Sunrise,
} from "lucide-react";

const DEFAULT_ACHIEVEMENTS = [
    { name: "Frequent Flyer", desc: "Completed 20+ flights", icon: Plane, unlocked: true },
    { name: "Globe Trotter", desc: "Visited 10+ countries", icon: Globe, unlocked: true },
    { name: "Early Bird", desc: "Took multiple early morning flights", icon: Sunrise, unlocked: true },
    { name: "Lounge Access", desc: "Premium travel member", icon: Star, unlocked: true },
    { name: "Long Haul Hero", desc: "Completed 10+ international flights", icon: Trophy, unlocked: true },
    { name: "Miles Master", desc: "Flew 50,000+ miles", icon: TrendingUp, unlocked: false },
];

const DEFAULT_LEVEL = {
    name: "Explorer",
    level: 4,
    currentMiles: 47320,
    nextLevelMiles: 60000,
    nextLevelName: "Adventurer",
};

const ACHIEVEMENT_ICON_MAP = {
    Plane,
    Globe,
    Sunrise,
    Star,
    Trophy,
    TrendingUp,
} as const;

type TravelStatsResponse = {
    stats: {
        total_flights: number;
        countries_visited: number;
        total_miles: number;
        travel_level: string;
        level_number: number;
        streak_years: number;
        flights_this_year: number;
        travel_personality: string;
    };
    achievements: Array<{
        name: string;
        desc: string;
        icon: keyof typeof ACHIEVEMENT_ICON_MAP;
        unlocked: boolean;
    }>;
};

export default function TravelStatsPage() {
    const { isLoaded, isSignedIn } = useUser();
    const [statsData, setStatsData] = useState({
        totalFlights: 23,
        countriesVisited: 12,
        totalMiles: 47320,
        travelLevel: DEFAULT_LEVEL.name,
        levelNumber: DEFAULT_LEVEL.level,
        streakYears: 3,
        flightsThisYear: 7,
        travelPersonality: "Globe Trotter",
    });
    const [achievements, setAchievements] = useState(DEFAULT_ACHIEVEMENTS);
    const [statsLoading, setStatsLoading] = useState(true);

    useEffect(() => {
        if (!isLoaded || !isSignedIn) return;
        const loadStats = async () => {
            setStatsLoading(true);
            try {
                const res = await fetch("/api/travel-stats", { cache: "no-store" });
                const data = (await res.json()) as TravelStatsResponse;
                if (!res.ok) {
                    throw new Error("Failed to load travel stats.");
                }

                setStatsData({
                    totalFlights: data.stats.total_flights ?? 0,
                    countriesVisited: data.stats.countries_visited ?? 0,
                    totalMiles: data.stats.total_miles ?? 0,
                    travelLevel: data.stats.travel_level || DEFAULT_LEVEL.name,
                    levelNumber: data.stats.level_number || 1,
                    streakYears: data.stats.streak_years ?? 0,
                    flightsThisYear: data.stats.flights_this_year ?? 0,
                    travelPersonality: data.stats.travel_personality || "Traveler",
                });

                const nextAchievements = (data.achievements ?? []).map((achievement) => ({
                    name: achievement.name,
                    desc: achievement.desc,
                    icon:
                        ACHIEVEMENT_ICON_MAP[achievement.icon] ??
                        Sparkles,
                    unlocked: Boolean(achievement.unlocked),
                }));
                if (nextAchievements.length > 0) {
                    setAchievements(nextAchievements);
                }
            } catch {
                // Keep defaults on load failure.
            } finally {
                setStatsLoading(false);
            }
        };
        void loadStats();
    }, [isLoaded, isSignedIn]);

    const currentLevel = useMemo(() => {
        const nextLevelMiles = Math.max(60000, Math.ceil((statsData.totalMiles + 1) / 10000) * 10000);
        const nextLevelName = nextLevelMiles >= 100000 ? "Voyager" : "Adventurer";
        return {
            name: statsData.travelLevel,
            level: statsData.levelNumber,
            currentMiles: statsData.totalMiles,
            nextLevelMiles,
            nextLevelName,
        };
    }, [statsData]);

    const stats = useMemo(
        () => [
            { label: "Total Flights", value: statsData.totalFlights.toLocaleString(), icon: Plane },
            { label: "Countries Visited", value: statsData.countriesVisited.toLocaleString(), icon: Globe },
            { label: "Total Miles Flown", value: statsData.totalMiles.toLocaleString(), icon: TrendingUp },
            {
                label: "Achievements Unlocked",
                value: achievements.filter((achievement) => achievement.unlocked).length.toString(),
                icon: Award,
            },
        ],
        [achievements, statsData],
    );

    const progressPercentage = Math.min(
        100,
        (currentLevel.currentMiles / Math.max(currentLevel.nextLevelMiles, 1)) * 100,
    );

    if (!isLoaded || (isSignedIn && statsLoading)) {
        return (
            <div className="min-h-screen bg-[#FAFAFA]">
                <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-24 lg:pb-8">
                    <div className="rounded-xl border border-[#E5E7EB] bg-white p-8 text-center text-[#6B7280]">
                        Loading your travel stats...
                    </div>
                </div>
            </div>
        );
    }

    if (!isSignedIn) {
        return (
            <AuthRequiredCard
                title="Log in to view travel stats"
                description="Travel stats and milestones are account-based. Sign in to unlock your progress, achievements, and insights."
                redirectUrl="/stats"
            />
        );
    }

    return (
        <div className="min-h-screen bg-[#FAFAFA]">
            <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-24 lg:pb-8">
                <div style={{ animation: "fadeIn 0.5s ease-out" }}>
                    {/* Page Header */}
                    <div className="mb-6 sm:mb-8">
                        <div className="flex items-center gap-2 sm:gap-3 mb-2">
                            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-white border border-[#E5E7EB] flex items-center justify-center flex-shrink-0">
                                <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-[#1D4ED8]" />
                            </div>
                            <h1 className="text-[#111827]" style={{ fontSize: "24px", fontWeight: "700" }}>
                                Travel Stats & Achievements
                            </h1>
                        </div>
                        <p className="text-[#6B7280] text-sm sm:text-base sm:ml-[52px]">Your travel journey at a glance</p>
                    </div>

                    {/* Primary Stats Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
                        {stats.map((stat, idx) => {
                            const Icon = stat.icon;
                            return (
                                <div
                                    key={idx}
                                    className="bg-white rounded-xl p-4 sm:p-5 border border-[#E5E7EB] hover:border-[#D1D5DB] transition-colors animate-slide-up"
                                    style={{ animationDelay: `${idx * 0.1}s` }}
                                >
                                    <Icon className="w-4 h-4 sm:w-5 sm:h-5 text-[#9CA3AF] mb-2 sm:mb-3" />
                                    <p className="text-[#111827] mb-0.5 sm:mb-1" style={{ fontSize: "22px", fontWeight: "700" }}>
                                        {stat.value}
                                    </p>
                                    <p className="text-[#6B7280] text-xs sm:text-sm">{stat.label}</p>
                                </div>
                            );
                        })}
                    </div>

                    {/* Two Column Layout */}
                    <div className="grid lg:grid-cols-3 gap-4 sm:gap-6 mb-4 sm:mb-6">
                        {/* Left Column */}
                        <div className="lg:col-span-2 space-y-4 sm:space-y-6">
                            {/* Travel Level */}
                            <div className="bg-white rounded-xl p-4 sm:p-6 border border-[#E5E7EB]">
                                <div className="flex items-center gap-2 mb-3 sm:mb-4">
                                    <Trophy className="w-4 h-4 sm:w-5 sm:h-5 text-[#1D4ED8]" />
                                    <h2 className="text-[#111827]" style={{ fontSize: "16px", fontWeight: "600" }}>Travel Level</h2>
                                </div>
                                <div className="mb-3 sm:mb-4">
                                    <p className="text-[#111827] mb-1" style={{ fontSize: "20px", fontWeight: "700" }}>
                                        {currentLevel.name} — Level {currentLevel.level}
                                    </p>
                                    <p className="text-[#6B7280] text-xs sm:text-sm">Progress to {currentLevel.nextLevelName} Level</p>
                                </div>
                                <div className="space-y-2">
                                    <div className="w-full h-2 bg-[#E5E7EB] rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-[#1D4ED8] rounded-full transition-all duration-500"
                                            style={{ width: `${progressPercentage}%` }}
                                        />
                                    </div>
                                    <div className="flex items-center justify-between text-xs sm:text-sm">
                                        <span className="text-[#6B7280]">
                                            {currentLevel.currentMiles.toLocaleString()} / {currentLevel.nextLevelMiles.toLocaleString()} miles
                                        </span>
                                        <span className="text-[#1D4ED8]" style={{ fontWeight: "600" }}>
                                            {Math.round(progressPercentage)}%
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* World Exploration */}
                            <div className="bg-white rounded-xl p-4 sm:p-6 border border-[#E5E7EB]">
                                <div className="flex items-center gap-2 mb-3 sm:mb-4">
                                    <Globe className="w-4 h-4 sm:w-5 sm:h-5 text-[#1D4ED8]" />
                                    <h2 className="text-[#111827]" style={{ fontSize: "16px", fontWeight: "600" }}>World Exploration</h2>
                                </div>
                                <div className="bg-[#F9FAFB] rounded-lg p-6 sm:p-8 mb-3 sm:mb-4 flex items-center justify-center">
                                    <div className="text-center">
                                        <Globe className="w-16 h-16 sm:w-20 sm:h-20 text-[#D1D5DB] mx-auto mb-3 sm:mb-4" />
                                        <p className="text-[#9CA3AF] text-xs sm:text-sm">World map visualization</p>
                                    </div>
                                </div>
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-0">
                                    <div>
                                        <p className="text-[#111827]" style={{ fontSize: "18px", fontWeight: "700" }}>
                                            {statsData.countriesVisited.toLocaleString()} / 195
                                        </p>
                                        <p className="text-[#6B7280] text-xs sm:text-sm">Countries Visited</p>
                                    </div>
                                    <div className="sm:text-right">
                                        <p className="text-[#6B7280] text-xs sm:text-sm italic">
                                            You have explored{" "}
                                            <span className="text-[#111827]" style={{ fontWeight: "600" }}>
                                                {Math.round((statsData.countriesVisited / 195) * 100)}%
                                            </span>{" "}
                                            of the world.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Miles Flown */}
                            <div className="bg-white rounded-xl p-4 sm:p-6 border border-[#E5E7EB]">
                                <div className="flex items-center gap-2 mb-3 sm:mb-4">
                                    <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-[#1D4ED8]" />
                                    <h2 className="text-[#111827]" style={{ fontSize: "16px", fontWeight: "600" }}>Miles Flown</h2>
                                </div>
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-0">
                                    <div>
                                        <p className="text-[#111827] mb-1" style={{ fontSize: "28px", fontWeight: "700" }}>
                                            {statsData.totalMiles.toLocaleString()}
                                        </p>
                                        <p className="text-[#6B7280] text-xs sm:text-sm">Total miles</p>
                                    </div>
                                    <div className="sm:text-right">
                                        <p className="text-[#6B7280] text-xs sm:text-sm mb-1">Equivalent to traveling</p>
                                        <p className="text-[#111827]" style={{ fontSize: "18px", fontWeight: "700" }}>1.9x</p>
                                        <p className="text-[#6B7280] text-xs sm:text-sm">around Earth</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Right Column */}
                        <div className="space-y-4 sm:space-y-6">
                            {/* Next Milestone */}
                            <div className="bg-white rounded-xl p-4 sm:p-5 border border-[#E5E7EB]">
                                <div className="flex items-center gap-2 mb-2 sm:mb-3">
                                    <Star className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#1D4ED8]" />
                                    <h3 className="text-[#6B7280] text-xs uppercase tracking-wide" style={{ fontWeight: "600" }}>Next Milestone</h3>
                                </div>
                                <p className="text-[#111827] mb-1 sm:mb-2" style={{ fontSize: "15px", fontWeight: "600" }}>Frequent Flyer Badge</p>
                                <p className="text-[#6B7280] text-xs sm:text-sm mb-2 sm:mb-3">
                                    {Math.max(0, 25 - statsData.totalFlights)} more flights needed to unlock
                                </p>
                                <div className="w-full h-1.5 bg-[#E5E7EB] rounded-full overflow-hidden">
                                    <div className="h-full bg-[#1D4ED8] rounded-full" style={{ width: "67%" }} />
                                </div>
                            </div>

                            {/* Travel Streak */}
                            <div className="bg-white rounded-xl p-4 sm:p-5 border border-[#E5E7EB]">
                                <div className="flex items-center gap-2 mb-2 sm:mb-3">
                                    <Flame className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#1D4ED8]" />
                                    <h3 className="text-[#6B7280] text-xs uppercase tracking-wide" style={{ fontWeight: "600" }}>Travel Streak</h3>
                                </div>
                                <p className="text-[#111827] mb-1 sm:mb-2" style={{ fontSize: "20px", fontWeight: "700" }}>
                                    {statsData.streakYears} years
                                </p>
                                <p className="text-[#6B7280] text-xs sm:text-sm">Consecutive years of flying</p>
                                <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-[#E5E7EB]">
                                    <p className="text-[#6B7280] text-xs sm:text-sm">
                                        Flights this year:{" "}
                                        <span className="text-[#111827]" style={{ fontWeight: "600" }}>
                                            {statsData.flightsThisYear}
                                        </span>
                                    </p>
                                </div>
                            </div>

                            {/* Travel Personality */}
                            <div className="bg-white rounded-xl p-4 sm:p-5 border border-[#E5E7EB]">
                                <div className="flex items-center gap-2 mb-2 sm:mb-3">
                                    <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#1D4ED8]" />
                                    <h3 className="text-[#6B7280] text-xs uppercase tracking-wide" style={{ fontWeight: "600" }}>Travel Personality</h3>
                                </div>
                                <p className="text-[#111827] mb-1 sm:mb-2" style={{ fontSize: "16px", fontWeight: "600" }}>
                                    {statsData.travelPersonality}
                                </p>
                                <p className="text-[#6B7280] text-xs sm:text-sm">
                                    You frequently explore international destinations and prefer long-haul travel.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* AI Insight */}
                    <div className="bg-[#F3F4F6] rounded-xl p-4 sm:p-5 border border-[#E5E7EB] mb-4 sm:mb-6">
                        <div className="flex items-start gap-2 sm:gap-3">
                            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-white border border-[#E5E7EB] flex items-center justify-center flex-shrink-0 mt-0.5">
                                <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#1D4ED8]" />
                            </div>
                            <div className="min-w-0">
                                <h3 className="text-[#111827] mb-1 sm:mb-2" style={{ fontSize: "13px", fontWeight: "600" }}>AI Travel Insight</h3>
                                <p className="text-[#6B7280] text-xs sm:text-sm leading-relaxed">
                                    You mostly fly in the morning and frequently choose Emirates or Qatar Airways.
                                    Based on your travel pace, you could reach the Adventurer level within two more trips.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Achievements */}
                    <div>
                        <h2 className="text-[#111827] mb-3 sm:mb-4" style={{ fontSize: "18px", fontWeight: "600" }}>
                            Your Achievements
                        </h2>
                        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                            {achievements.map((achievement, idx) => {
                                const Icon = achievement.icon;
                                return (
                                    <div
                                        key={idx}
                                        className={`bg-white rounded-xl p-4 sm:p-5 border ${achievement.unlocked
                                                ? "border-[#E5E7EB] hover:border-[#D1D5DB]"
                                                : "border-[#E5E7EB] opacity-50"
                                            } transition-all animate-slide-up`}
                                        style={{ animationDelay: `${0.5 + idx * 0.05}s` }}
                                    >
                                        <div className="flex items-start gap-3 sm:gap-4">
                                            <div
                                                className={`w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${achievement.unlocked
                                                        ? "bg-[#EFF6FF] border border-[#DBEAFE]"
                                                        : "bg-[#F9FAFB] border border-[#E5E7EB]"
                                                    }`}
                                            >
                                                <Icon
                                                    className={`w-4 h-4 sm:w-5 sm:h-5 ${achievement.unlocked ? "text-[#1D4ED8]" : "text-[#9CA3AF]"
                                                        }`}
                                                />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <h3 className="text-[#111827] mb-0.5 sm:mb-1" style={{ fontSize: "14px", fontWeight: "600" }}>
                                                    {achievement.name}
                                                </h3>
                                                <p className="text-[#6B7280] text-xs sm:text-sm">{achievement.desc}</p>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
