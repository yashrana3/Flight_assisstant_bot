"use client";

import Link from "next/link";
import {
    LayoutDashboard,
    TrendingUp,
    Brain,
    Search,
    ExternalLink,
    MapPin,
    Users,
    UserCheck,
    Activity,
    BarChart3,
    UsersRound,
    Radio,
    Settings as SettingsIcon,
    Bell,
    MessageSquare,
    Inbox,
    Monitor,
    PieChart,
    Lightbulb,
    Bug,
    Heart,
    Flame,
    Menu,
    X,
    ChevronDown
} from "lucide-react";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAdminData } from "@/lib/use-admin-data";
import type { AdminAuthMeResponse } from "@/lib/admin-types";
import { clearAdminClientCache } from "@/lib/admin-session";

const menuItems = [
    { path: "/", label: "Overview", icon: LayoutDashboard, exact: true },
    { path: "/user-funnel", label: "User Funnel", icon: TrendingUp },
    { path: "/ai-performance", label: "AI Performance", icon: Brain },
    { path: "/flight-search", label: "Flight Search Intelligence", icon: Search },
    { path: "/redirect-analytics", label: "Redirect Analytics", icon: ExternalLink },
    { path: "/route-trends", label: "Route Trends", icon: MapPin },
    { path: "/user-behavior", label: "User Behavior", icon: Users },
    { path: "/retention", label: "Retention", icon: UserCheck },
    { path: "/platform-health", label: "Platform Health", icon: Activity },
    { path: "/growth-metrics", label: "Growth Metrics", icon: BarChart3 },
    { path: "/users", label: "Users", icon: UsersRound },
    { path: "/api-monitoring", label: "API Monitoring", icon: Radio },
    { path: "/real-time", label: "Real-Time Monitoring", icon: Activity },
    {
        label: "Feedback & Support",
        icon: MessageSquare,
        isSection: true,
        children: [
            { path: "/feedback/dashboard", label: "Feedback Dashboard", icon: LayoutDashboard },
            { path: "/feedback/inbox", label: "Feedback Inbox", icon: Inbox },
            { path: "/feedback/live-chat", label: "Live Chat Monitor", icon: Monitor },
            { path: "/feedback/analytics", label: "Feedback Analytics", icon: PieChart },
            { path: "/feedback/ai-insights", label: "AI Feedback Insights", icon: Lightbulb },
            { path: "/feedback/issues", label: "Issue Tracker", icon: Bug },
            { path: "/feedback/sentiment", label: "Sentiment Analysis", icon: Heart },
            { path: "/feedback/heatmap", label: "Feedback Heatmap", icon: Flame },
        ]
    },
    { path: "/settings", label: "Settings", icon: SettingsIcon },
];

interface DashboardLayoutProps {
    children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
    const pathname = usePathname();
    if (pathname === "/sign-in") {
        return <>{children}</>;
    }

    return <DashboardShell>{children}</DashboardShell>;
}

function initialsFromName(value: string | null | undefined) {
    const parts = (value ?? "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "SA";
    return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}

function DashboardShell({ children }: DashboardLayoutProps) {
    const router = useRouter();
    const [expandedSections, setExpandedSections] = useState<string[]>(["Feedback & Support"]);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const pathname = usePathname();
    const adminSession = useAdminData<AdminAuthMeResponse>("/api/admin/auth/me", { staleMs: 60_000 });

    useEffect(() => {
        if (adminSession.loading) return;
        const err = adminSession.error?.toLowerCase() ?? "";
        const unauthorized =
            err.includes("401") ||
            err.includes("unauthorized") ||
            err.includes("not authenticated");
        if (!unauthorized || adminSession.data) return;

        clearAdminClientCache();
        void fetch("/api/admin/auth/sign-out", {
            method: "POST",
            credentials: "include",
        }).finally(() => {
            router.replace("/sign-in");
        });
    }, [adminSession.loading, adminSession.error, adminSession.data, router]);

    const admin = adminSession.data?.admin;
    const adminName = admin?.fullName || "Super Admin";
    const adminSubLabel = admin?.username ? `@${admin.username}` : admin?.email || "super_admin";
    const adminInitials = initialsFromName(adminName);

    const toggleSection = (label: string) => {
        setExpandedSections(prev =>
            prev.includes(label)
                ? prev.filter(s => s !== label)
                : [...prev, label]
        );
    };

    const isActive = (path: string, exact?: boolean) => {
        if (exact) return pathname === path;
        return pathname === path || pathname.startsWith(path + "/");
    };

    return (
        <div className="flex h-screen bg-gray-50">
            {/* Mobile Sidebar Overlay */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-40 lg:hidden"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside className={`
        fixed lg:static inset-y-0 left-0 z-50
        w-64 bg-white border-r border-gray-200 flex flex-col
        transform transition-transform duration-300 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
                <div className="p-4 md:p-6 border-b border-gray-200 flex items-center justify-between">
                    <div>
                        <h1 className="text-lg md:text-xl font-semibold text-gray-900">Book With AI</h1>
                        <p className="text-xs md:text-sm text-gray-500 mt-1">Admin Dashboard</p>
                    </div>
                    {/* Mobile Close Button */}
                    <button
                        onClick={() => setSidebarOpen(false)}
                        className="lg:hidden p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <nav className="flex-1 overflow-y-auto p-4">
                    <ul className="space-y-1">
                        {menuItems.map((item) => {
                            if (item.isSection && item.children) {
                                const Icon = item.icon;
                                const isExpanded = expandedSections.includes(item.label);
                                return (
                                    <li key={item.label}>
                                        <button
                                            onClick={() => toggleSection(item.label)}
                                            className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                                        >
                                            <div className="flex items-center gap-3">
                                                <Icon className="w-5 h-5" />
                                                <span className="font-medium">{item.label}</span>
                                            </div>
                                            <ChevronDown
                                                className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                            />
                                        </button>
                                        {isExpanded && (
                                            <ul className="mt-1 ml-6 space-y-1">
                                                {item.children.map((child) => {
                                                    const ChildIcon = child.icon;
                                                    const active = isActive(child.path);
                                                    return (
                                                        <li key={child.path}>
                                                            <Link
                                                                href={child.path}
                                                                onClick={() => setSidebarOpen(false)}
                                                                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${active
                                                                        ? "bg-blue-50 text-blue-600 font-medium"
                                                                        : "text-gray-700 hover:bg-gray-50"
                                                                    }`}
                                                            >
                                                                <ChildIcon className="w-4 h-4" />
                                                                <span>{child.label}</span>
                                                            </Link>
                                                        </li>
                                                    );
                                                })}
                                            </ul>
                                        )}
                                    </li>
                                );
                            }

                            const Icon = item.icon;
                            if (!item.path) return null;
                            const active = isActive(item.path, item.exact);
                            return (
                                <li key={item.path}>
                                    <Link
                                        href={item.path}
                                        onClick={() => setSidebarOpen(false)}
                                        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${active
                                                ? "bg-blue-50 text-blue-600 font-medium"
                                                : "text-gray-700 hover:bg-gray-50"
                                            }`}
                                    >
                                        <Icon className="w-5 h-5" />
                                        <span>{item.label}</span>
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                </nav>
            </aside>

            {/* Main Content */}
            <div className="flex-1 flex flex-col">
                {/* Header */}
                <header className="bg-white border-b border-gray-200 px-3 md:px-6 py-3 md:py-4">
                    <div className="flex items-center justify-between gap-3">
                        {/* Mobile Menu Button */}
                        <button
                            onClick={() => setSidebarOpen(true)}
                            className="lg:hidden p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
                        >
                            <Menu className="w-5 h-5" />
                        </button>

                        <div className="flex-1" />

                        {/* Right Side Actions */}
                        <div className="flex items-center gap-2 md:gap-4">
                            {/* Notifications */}
                            <a
                                href="https://analytics.google.com/"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hidden sm:inline-flex items-center gap-2 px-3 py-2 text-sm text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
                                title="Open Google Analytics 4"
                            >
                                <ExternalLink className="w-4 h-4" />
                                GA4
                            </a>

                            {/* Notifications */}
                            <button className="relative p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                                <Bell className="w-4 h-4 md:w-5 md:h-5" />
                                <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
                            </button>

                            {/* Profile Avatar */}
                            <Link
                                href="/settings"
                                className="hidden md:flex items-center gap-3 pl-3 border-l border-gray-200 hover:opacity-90 transition-opacity"
                            >
                                <div className="text-right">
                                    <div className="text-sm font-medium text-gray-900">{adminName}</div>
                                    <div className="text-xs text-gray-500">{adminSubLabel}</div>
                                </div>
                                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center text-white font-medium">
                                    {adminInitials}
                                </div>
                            </Link>
                        </div>
                    </div>
                </header>

                {/* Main Content Area */}
                <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6">
                    {children}
                </main>
            </div>
        </div>
    );
}
