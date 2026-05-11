"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import {
    Plus,
    TrendingDown,
    TrendingUp,
    Bell,
    MoreVertical,
    Edit2,
    Pause,
    Play,
    Trash2,
    ExternalLink,
    X,
} from "lucide-react";
import { toast } from "sonner";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import AuthRequiredCard from "@/components/AuthRequiredCard";

interface PriceAlertFromApi {
    id: string;
    origin: string;
    destination: string;
    route: string;
    currentPrice: number | null;
    lowestPrice: number | null;
    trend: string | null;
    changePct: string | null;
    airline: string | null;
    dateRange: string | null;
    active: boolean;
    currency: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    analysisSummary?: string | null;
    priceOutlook?: string | null;
    timingHint?: string | null;
    livePriceSource?: string | null;
    livePriceCheckedAt?: string | null;
    departureDate?: string | null;
    returnDate?: string | null;
    liveSearchAvailable?: boolean | null;
    bookUrl?: string | null;
}

type ManualAlertFormState = {
    origin: string;
    destination: string;
    airline: string;
    trip_type: "one_way" | "round_trip";
    departure_date: string;
    return_date: string;
};

const INITIAL_MANUAL_ALERT_FORM: ManualAlertFormState = {
    origin: "",
    destination: "",
    airline: "",
    trip_type: "one_way",
    departure_date: "",
    return_date: "",
};

function formatCurrency(amount: number | null, currency: string | null): string {
    if (amount === null) return "—";

    const code = (currency ?? "USD").toUpperCase();

    try {
        const locale = code === "USD" ? "en-US" : "en-IN";
        return new Intl.NumberFormat(locale, {
            style: "currency",
            currency: code,
            maximumFractionDigits: 0,
        }).format(amount);
    } catch {
        const fallbackSymbol = code === "INR" ? "₹" : code === "USD" ? "$" : `${code} `;
        const locale = code === "USD" ? "en-US" : "en-IN";
        return `${fallbackSymbol}${amount.toLocaleString(locale)}`;
    }
}

function normalizeTrend(trend: string | null): "down" | "up" | "flat" {
    if (trend === "down" || trend === "up") {
        return trend;
    }
    return "flat";
}

function formatChange(changePct: string | null, trend: "down" | "up" | "flat"): string {
    if (!changePct) return "Tracking";

    const withPercent = changePct.includes("%") ? changePct : `${changePct}%`;
    if (withPercent.startsWith("+") || withPercent.startsWith("-")) {
        return withPercent;
    }
    if (trend === "down") return `-${withPercent}`;
    if (trend === "up") return `+${withPercent}`;
    return withPercent;
}

function formatDateRange(dateRange: string | null): string {
    return dateRange?.trim() || "Any dates";
}

function getTripTypeLabel(alert: Pick<PriceAlertFromApi, "departureDate" | "returnDate" | "dateRange">): string {
    if (alert.returnDate) return "Round trip";
    if (alert.departureDate || alert.dateRange) return "One-way";
    return "Flexible";
}

function PriceSnapshot({ alert }: { alert: PriceAlertFromApi }) {
    const points = [
        { label: "Current", value: alert.currentPrice, color: "bg-[#0B5FFF]" },
        { label: "Lowest", value: alert.lowestPrice, color: "bg-[#10B981]" },
    ].filter((point): point is { label: string; value: number; color: string } => point.value !== null);

    if (points.length === 0) {
        return (
            <div className="rounded-lg border border-[#E5E7EB] bg-gradient-to-r from-[#F9FAFB] to-[#F3F4F6] px-3 py-3 text-xs text-[#6B7280]">
                No tracked price points are available for this alert yet.
            </div>
        );
    }

    const maxValue = Math.max(...points.map((point) => point.value), 1);

    return (
        <div className="rounded-lg border border-[#E5E7EB] bg-gradient-to-r from-[#F9FAFB] to-[#F3F4F6] px-3 py-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {points.map((point) => (
                    <div key={point.label} className="flex items-end gap-3 min-w-0">
                        <div className="h-12 w-8 rounded-lg bg-white border border-[#E5E7EB] flex items-end p-1">
                            <div
                                className={`w-full rounded-md ${point.color}`}
                                style={{
                                    height: `${Math.max((point.value / maxValue) * 100, 20)}%`,
                                }}
                            />
                        </div>
                        <div className="min-w-0">
                            <p className="text-[11px] text-[#6B7280]">{point.label}</p>
                            <p className="text-sm text-[#0A2140] truncate" style={{ fontWeight: "600" }}>
                                {formatCurrency(point.value, alert.currency)}
                            </p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default function PriceAlertsPage() {
    const router = useRouter();
    const { isLoaded, isSignedIn } = useUser();
    const [alerts, setAlerts] = useState<PriceAlertFromApi[]>([]);
    const [loadingAlerts, setLoadingAlerts] = useState(true);
    const [alertsError, setAlertsError] = useState<string | null>(null);
    const [isManualAlertModalOpen, setIsManualAlertModalOpen] = useState(false);
    const [savingManualAlert, setSavingManualAlert] = useState(false);
    const [editingAlertId, setEditingAlertId] = useState<string | null>(null);
    const [manualAlertForm, setManualAlertForm] = useState<ManualAlertFormState>(
        INITIAL_MANUAL_ALERT_FORM,
    );

    useEffect(() => {
        let cancelled = false;

        if (!isLoaded) return;

        if (!isSignedIn) {
            setAlerts([]);
            setAlertsError(null);
            setLoadingAlerts(false);
            return;
        }

        const loadAlerts = async () => {
            setLoadingAlerts(true);
            setAlertsError(null);

            try {
                // Fast path: load DB snapshot first to avoid blocking on live refresh.
                const snapshotUrl = new URL("/api/price-alerts", window.location.origin);
                snapshotUrl.searchParams.set("refresh", "false");
                const snapshotRes = await fetch(snapshotUrl.toString(), { cache: "no-store" });
                const snapshotData = await snapshotRes.json().catch(() => null);

                if (!snapshotRes.ok) {
                    throw new Error(snapshotData?.detail ?? "Failed to load price alerts.");
                }

                if (!cancelled) {
                    setAlerts(snapshotData?.alerts ?? []);
                    setLoadingAlerts(false);
                }

                // Background path: try live refresh and silently update UI when it succeeds.
                const liveUrl = new URL("/api/price-alerts", window.location.origin);
                liveUrl.searchParams.set("refresh", "true");
                const liveRes = await fetch(liveUrl.toString(), { cache: "no-store" });
                const liveData = await liveRes.json().catch(() => null);
                if (!liveRes.ok || cancelled) return;

                setAlerts(liveData?.alerts ?? []);
            } catch (err) {
                if (!cancelled) {
                    setAlerts([]);
                    setAlertsError(
                        err instanceof Error
                            ? err.message
                            : "Failed to load price alerts."
                    );
                }
            } finally {
                if (!cancelled) {
                    setLoadingAlerts(false);
                }
            }
        };

        void loadAlerts();

        return () => {
            cancelled = true;
        };
    }, [isLoaded, isSignedIn]);

    const closeManualAlertModal = () => {
        if (savingManualAlert) return;
        setEditingAlertId(null);
        setIsManualAlertModalOpen(false);
    };

    const handleManualAlertFieldChange = (
        field: keyof ManualAlertFormState,
        value: string,
    ) => {
        setManualAlertForm((currentForm) => {
            const nextForm = {
                ...currentForm,
                [field]: value,
            };
            if (field === "trip_type" && value === "one_way") {
                nextForm.return_date = "";
            }
            return nextForm;
        });
    };

    const handleEditAlert = (alert: PriceAlertFromApi) => {
        router.push(`/deals/edit?id=${encodeURIComponent(alert.id)}`);
    };

    const handleManualEditAlert = (alert: PriceAlertFromApi) => {
        setEditingAlertId(alert.id);
        setManualAlertForm({
            origin: alert.origin,
            destination: alert.destination,
            airline: alert.airline ?? "",
            trip_type: alert.returnDate ? "round_trip" : "one_way",
            departure_date: alert.departureDate?.slice(0, 10) ?? "",
            return_date: alert.returnDate?.slice(0, 10) ?? "",
        });
        setIsManualAlertModalOpen(true);
    };

    const handleAddAlert = () => {
        if (!isSignedIn) {
            router.push("/sign-up?redirect_url=/deals");
            return;
        }
        setEditingAlertId(null);
        setManualAlertForm(INITIAL_MANUAL_ALERT_FORM);
        setIsManualAlertModalOpen(true);
    };

    const handleManualAlertSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        if (!manualAlertForm.origin.trim() || !manualAlertForm.destination.trim()) {
            toast.error("Origin and destination are required.");
            return;
        }
        if (!manualAlertForm.departure_date) {
            toast.error("Departure date is required.");
            return;
        }
        if (manualAlertForm.trip_type === "round_trip" && !manualAlertForm.return_date) {
            toast.error("Return date is required for a round trip.");
            return;
        }

        setSavingManualAlert(true);
        const isEditing = Boolean(editingAlertId);
        const toastId = toast.loading(isEditing ? "Updating alert…" : "Saving alert…");
        const dateRange = manualAlertForm.trip_type === "round_trip"
            ? `${manualAlertForm.departure_date} to ${manualAlertForm.return_date}`
            : manualAlertForm.departure_date;

        try {
            const res = await fetch(
                isEditing
                    ? `/api/price-alerts/${encodeURIComponent(editingAlertId as string)}`
                    : "/api/price-alerts/ai-create",
                {
                    method: isEditing ? "PATCH" : "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(
                        isEditing
                            ? {
                                origin: manualAlertForm.origin.trim(),
                                destination: manualAlertForm.destination.trim(),
                                airline: manualAlertForm.airline.trim(),
                                date_range: dateRange,
                                refresh_live: true,
                            }
                            : {
                                instruction: [
                                    `Create a price alert from ${manualAlertForm.origin.trim()} to ${manualAlertForm.destination.trim()}.`,
                                    manualAlertForm.airline.trim()
                                        ? `Airline: ${manualAlertForm.airline.trim()}.`
                                        : "Any airline.",
                                    manualAlertForm.trip_type === "round_trip"
                                        ? `Round trip dates: ${manualAlertForm.departure_date} to ${manualAlertForm.return_date}.`
                                        : `Departure date: ${manualAlertForm.departure_date}.`,
                                    "Keep the alert active.",
                                ].join(" "),
                            },
                    ),
                },
            );
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                throw new Error(data?.detail ?? (isEditing ? "Failed to update alert." : "Failed to save alert."));
            }

            const alertsRes = await fetch("/api/price-alerts?refresh=true", { cache: "no-store" });
            const alertsData = await alertsRes.json().catch(() => null);
            if (alertsRes.ok && Array.isArray(alertsData?.alerts)) {
                setAlerts(alertsData.alerts);
            }

            setEditingAlertId(null);
            setManualAlertForm(INITIAL_MANUAL_ALERT_FORM);
            setIsManualAlertModalOpen(false);
            toast.success(isEditing ? "Alert updated." : "Alert added.", { id: toastId });
        } catch (err) {
            toast.error(
                err instanceof Error ? err.message : (isEditing ? "Failed to update alert." : "Failed to save alert."),
                { id: toastId },
            );
        } finally {
            setSavingManualAlert(false);
        }
    };

    const handleToggleAlert = async (alert: PriceAlertFromApi) => {
        const nextActiveState = !alert.active;
        const toastId = toast.loading(nextActiveState ? "Resuming alert…" : "Pausing alert…");

        try {
            const res = await fetch(`/api/price-alerts/${encodeURIComponent(alert.id)}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    is_active: nextActiveState,
                    refresh_live: nextActiveState,
                }),
            });
            const data = await res.json().catch(() => null);

            if (!res.ok) {
                throw new Error(data?.detail ?? "Failed to update alert.");
            }

            setAlerts((currentAlerts) =>
                currentAlerts.map((currentAlert) =>
                    currentAlert.id === alert.id
                        ? { ...currentAlert, ...data.alert }
                        : currentAlert
                )
            );
            toast.success(nextActiveState ? "Alert resumed." : "Alert paused.", {
                id: toastId,
            });
        } catch (err) {
            toast.error(
                err instanceof Error ? err.message : "Failed to update alert.",
                { id: toastId }
            );
        }
    };

    const handleDeleteAlert = async (alert: PriceAlertFromApi) => {
        const toastId = toast.loading("Deleting alert…");

        try {
            const res = await fetch(`/api/price-alerts/${encodeURIComponent(alert.id)}`, {
                method: "DELETE",
            });
            const data = await res.json().catch(() => null);

            if (!res.ok) {
                throw new Error(data?.detail ?? "Failed to delete alert.");
            }

            setAlerts((currentAlerts) =>
                currentAlerts.filter((currentAlert) => currentAlert.id !== alert.id)
            );
            toast.success("Alert deleted.", { id: toastId });
        } catch (err) {
            toast.error(
                err instanceof Error ? err.message : "Failed to delete alert.",
                { id: toastId }
            );
        }
    };

    const handleBookAlert = (alert: PriceAlertFromApi) => {
        if (!alert.bookUrl) {
            toast.error("This alert needs a departure date before it can open a booking page.");
            return;
        }

        window.location.assign(alert.bookUrl);
    };

    const isLoading = !isLoaded || loadingAlerts;

    if (!isLoaded) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-[#F8FAFC] to-[#F1F5F9]">
                <div className="max-w-[1200px] mx-auto px-6 py-8 pb-24 lg:pb-8">
                    <div className="bg-white rounded-lg border border-[#E5E7EB] p-6 text-center text-[#6B7280]">
                        Loading your alerts…
                    </div>
                </div>
            </div>
        );
    }

    if (!isSignedIn) {
        return (
            <AuthRequiredCard
                title="Log in to manage alerts"
                description="Price alerts are stored in your account, so guests cannot open this page. Sign in to view, edit, and create flight alerts."
                redirectUrl="/deals"
            />
        );
    }

    const activeAlertsCount = alerts.filter((alert) => alert.active).length;
    const downwardAlerts = alerts.filter(
        (alert) => normalizeTrend(alert.trend) === "down"
    );
    const actionableAlerts = alerts.filter((alert) => {
        if (!alert.active) return false;
        const trendDown = normalizeTrend(alert.trend) === "down";
        const lowOutlook = (alert.priceOutlook || "").toLowerCase() === "low";
        return trendDown || lowOutlook;
    });
    const lowestTrackedAlert = alerts.reduce<PriceAlertFromApi | null>((lowest, alert) => {
        if (alert.lowestPrice === null) return lowest;
        if (!lowest || lowest.lowestPrice === null || alert.lowestPrice < lowest.lowestPrice) {
            return alert;
        }
        return lowest;
    }, null);

    const insightTitle = isLoading
        ? "Loading live alerts"
        : !isSignedIn
            ? "Sign in to sync alerts"
            : alertsError
                ? "Could not load alerts"
                : alerts.length === 0
                    ? "No alerts yet"
                    : "Live alert summary";

    const insightText = isLoading
        ? "Pulling your saved price alerts from the database."
        : !isSignedIn
            ? "Your saved price alerts live in your account. Sign in to view and manage them here."
            : alertsError
                ? alertsError
                : alerts.length === 0
                    ? "You do not have any saved price alerts yet. Create one with AI and it will appear here once it is stored."
                    : `${activeAlertsCount} active alert${activeAlertsCount === 1 ? "" : "s"}${downwardAlerts.length > 0 ? `, with ${downwardAlerts.length} route${downwardAlerts.length === 1 ? "" : "s"} currently trending down.` : "."}${lowestTrackedAlert ? ` Lowest tracked fare so far: ${formatCurrency(lowestTrackedAlert.lowestPrice, lowestTrackedAlert.currency)} for ${lowestTrackedAlert.route}.` : ""}`;

    const insightIsPositive = downwardAlerts.length > 0;

    return (
        <div className="min-h-screen bg-gradient-to-br from-[#F8FAFC] to-[#F1F5F9]">
            <div className="max-w-[1200px] mx-auto px-6 py-8 pb-24 lg:pb-8">
                <div style={{ animation: "fadeIn 0.5s ease-out" }}>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4 sm:gap-0">
                        <div>
                            <h1 className="text-[#0A2140] mb-1 sm:mb-2 text-2xl sm:text-[32px]" style={{ fontWeight: "700" }}>
                                Smart Price Alerts
                            </h1>
                            <p className="text-[#6B7280] text-sm sm:text-base">Track flight prices and get notified of the best deals</p>
                        </div>
                        <button
                            className="bg-[#1D4ED8] w-full sm:w-auto justify-center hover:bg-[#1E40AF] text-white flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer border-none"
                            onClick={handleAddAlert}
                        >
                            <Plus className="w-4 h-4" />
                            Add Alert
                        </button>
                    </div>

                    {isManualAlertModalOpen && (
                        <div
                            className="fixed inset-0 z-50 bg-[#0F172A]/55 px-4 py-6 sm:px-6 overflow-y-auto"
                            onClick={closeManualAlertModal}
                        >
                            <div className="mx-auto max-w-3xl">
                                <form
                                    onSubmit={handleManualAlertSubmit}
                                    onClick={(event) => event.stopPropagation()}
                                    className="rounded-[28px] border border-[#D7E3F4] bg-white shadow-[0_30px_90px_rgba(15,23,42,0.18)]"
                                >
                                    <div className="flex items-start justify-between gap-4 border-b border-[#E5E7EB] px-5 py-5 sm:px-7">
                                        <div>
                                            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#1D4ED8]">
                                                Manual Alert Entry
                                            </p>
                                            <h2 className="mt-2 text-2xl font-semibold text-[#0A2140]">
                                                {editingAlertId ? "Edit alert manually" : "Add an alert without AI"}
                                            </h2>
                                            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6B7280]">
                                                Update the route and dates directly here.
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={closeManualAlertModal}
                                            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#E5E7EB] bg-white text-[#6B7280] transition-colors hover:border-[#CBD5E1] hover:text-[#111827] cursor-pointer"
                                            aria-label="Close manual alert form"
                                        >
                                            <X className="h-5 w-5" />
                                        </button>
                                    </div>

                                    <div className="grid grid-cols-1 gap-4 px-5 py-5 sm:grid-cols-2 sm:px-7 sm:py-6">
                                        <label className="block">
                                            <span className="mb-2 block text-sm font-medium text-[#0A2140]">Origin</span>
                                            <input
                                                type="text"
                                                value={manualAlertForm.origin}
                                                onChange={(event) => handleManualAlertFieldChange("origin", event.target.value)}
                                                className="w-full rounded-xl border border-[#D1D5DB] px-4 py-3 text-sm text-[#111827] outline-none transition-colors focus:border-[#1D4ED8]"
                                                placeholder="DEL or New Delhi"
                                                required
                                            />
                                        </label>
                                        <label className="block">
                                            <span className="mb-2 block text-sm font-medium text-[#0A2140]">Destination</span>
                                            <input
                                                type="text"
                                                value={manualAlertForm.destination}
                                                onChange={(event) => handleManualAlertFieldChange("destination", event.target.value)}
                                                className="w-full rounded-xl border border-[#D1D5DB] px-4 py-3 text-sm text-[#111827] outline-none transition-colors focus:border-[#1D4ED8]"
                                                placeholder="DXB or Dubai"
                                                required
                                            />
                                        </label>
                                        <label className="block">
                                            <span className="mb-2 block text-sm font-medium text-[#0A2140]">Airline</span>
                                            <input
                                                type="text"
                                                value={manualAlertForm.airline}
                                                onChange={(event) => handleManualAlertFieldChange("airline", event.target.value)}
                                                className="w-full rounded-xl border border-[#D1D5DB] px-4 py-3 text-sm text-[#111827] outline-none transition-colors focus:border-[#1D4ED8]"
                                                placeholder="Any airline"
                                            />
                                        </label>
                                        <label className="block">
                                            <span className="mb-2 block text-sm font-medium text-[#0A2140]">Trip type</span>
                                            <select
                                                value={manualAlertForm.trip_type}
                                                onChange={(event) => handleManualAlertFieldChange("trip_type", event.target.value)}
                                                className="w-full rounded-xl border border-[#D1D5DB] bg-white px-4 py-3 text-sm text-[#111827] outline-none transition-colors focus:border-[#1D4ED8]"
                                            >
                                                <option value="one_way">One way</option>
                                                <option value="round_trip">Round trip</option>
                                            </select>
                                        </label>
                                        <label className="block">
                                            <span className="mb-2 block text-sm font-medium text-[#0A2140]">Departure date</span>
                                            <input
                                                type="date"
                                                value={manualAlertForm.departure_date}
                                                onChange={(event) => handleManualAlertFieldChange("departure_date", event.target.value)}
                                                className="w-full rounded-xl border border-[#D1D5DB] px-4 py-3 text-sm text-[#111827] outline-none transition-colors focus:border-[#1D4ED8]"
                                                required
                                            />
                                        </label>
                                        <label className="block">
                                            <span className="mb-2 block text-sm font-medium text-[#0A2140]">Return date</span>
                                            <input
                                                type="date"
                                                value={manualAlertForm.return_date}
                                                onChange={(event) => handleManualAlertFieldChange("return_date", event.target.value)}
                                                className="w-full rounded-xl border border-[#D1D5DB] px-4 py-3 text-sm text-[#111827] outline-none transition-colors focus:border-[#1D4ED8]"
                                                required={manualAlertForm.trip_type === "round_trip"}
                                            />
                                        </label>
                                        <div className="sm:col-span-2 rounded-2xl border border-[#DBEAFE] bg-[#EFF6FF] px-4 py-4 text-sm leading-6 text-[#1E3A8A]">
                                            {editingAlertId
                                                ? "Want to change this with a prompt instead? You can still"
                                                : "Prefer a prompt instead? You can still"}
                                            {" "}
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setIsManualAlertModalOpen(false);
                                                    router.push(
                                                        editingAlertId
                                                            ? `/deals/edit?id=${encodeURIComponent(editingAlertId)}`
                                                            : "/deals/edit",
                                                    );
                                                }}
                                                className="font-semibold text-[#1D4ED8] underline decoration-[#93C5FD] underline-offset-4 cursor-pointer bg-transparent border-none p-0"
                                            >
                                                {editingAlertId ? "Use AI to edit alert" : "Use AI to add alert"}
                                            </button>
                                            .
                                        </div>
                                    </div>

                                    <div className="flex flex-col-reverse gap-3 border-t border-[#E5E7EB] px-5 py-5 sm:flex-row sm:items-center sm:justify-end sm:px-7">
                                        <button
                                            type="button"
                                            onClick={closeManualAlertModal}
                                            className="inline-flex items-center justify-center rounded-xl border border-[#D1D5DB] px-4 py-3 text-sm font-medium text-[#4B5563] transition-colors hover:bg-[#F8FAFC] cursor-pointer"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={savingManualAlert}
                                            className="inline-flex items-center justify-center rounded-xl bg-[#1D4ED8] px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-[#1E40AF] disabled:cursor-not-allowed disabled:opacity-70 cursor-pointer"
                                        >
                                            {savingManualAlert ? "Saving…" : editingAlertId ? "Update alert" : "Save alert"}
                                        </button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    )}

                    {/* AI Insight */}
                    <div className="bg-gradient-to-r from-[#EEF2FF] to-[#E0E7FF] rounded-2xl p-6 mb-6">
                        <div className="flex items-start gap-3">
                            <div className="w-10 h-10 rounded-lg bg-[#0B5FFF] flex items-center justify-center flex-shrink-0">
                                {insightIsPositive ? (
                                    <TrendingDown className="w-5 h-5 text-white" />
                                ) : (
                                    <TrendingUp className="w-5 h-5 text-white" />
                                )}
                            </div>
                            <div>
                                <h3 className="text-[#1E3A8A]" style={{ fontWeight: "600" }}>{insightTitle}</h3>
                                <p className="text-[#3730A3] mt-1">
                                    {insightText}
                                </p>
                            </div>
                        </div>
                    </div>

                    {actionableAlerts.length > 0 && (
                        <div className="mb-6 rounded-2xl border border-[#FECACA] bg-[#FEF2F2] p-4 sm:p-5">
                            <div className="flex items-start gap-3">
                                <div className="w-9 h-9 rounded-lg bg-[#EF4444] flex items-center justify-center flex-shrink-0">
                                    <Bell className="w-4 h-4 text-white" />
                                </div>
                                <div className="min-w-0">
                                    <h3 className="text-[#991B1B]" style={{ fontWeight: 700 }}>
                                        Alert notifications
                                    </h3>
                                    <p className="text-[#7F1D1D] text-sm mt-1">
                                        {actionableAlerts.length} active alert{actionableAlerts.length === 1 ? "" : "s"} look favorable right now.
                                    </p>
                                    <div className="mt-3 space-y-2">
                                        {actionableAlerts.slice(0, 3).map((alert) => (
                                            <div
                                                key={`notif-${alert.id}`}
                                                className="rounded-lg border border-[#FCA5A5] bg-white px-3 py-2 flex items-center justify-between gap-3"
                                            >
                                                <div className="min-w-0">
                                                    <p className="text-sm text-[#111827]" style={{ fontWeight: 600 }}>
                                                        {alert.route}
                                                    </p>
                                                    <p className="text-xs text-[#6B7280]">
                                                        Current {formatCurrency(alert.currentPrice, alert.currency)} • Lowest {formatCurrency(alert.lowestPrice, alert.currency)}
                                                    </p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => handleBookAlert(alert)}
                                                    disabled={!alert.bookUrl}
                                                    className="h-8 px-3 text-xs text-white bg-[#DC2626] hover:bg-[#B91C1C] disabled:opacity-60 rounded-md transition-colors border-none cursor-pointer"
                                                >
                                                    Book now
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Active Alerts */}
                    <div className="space-y-3">
                        {isLoading && (
                            <div className="bg-white rounded-lg border border-[#E5E7EB] p-6 text-center text-[#6B7280]">
                                Loading your alerts…
                            </div>
                        )}

                        {!isLoading && alerts.length === 0 && (
                            <div className="bg-white rounded-lg border border-[#E5E7EB] p-6 text-center text-[#6B7280]">
                                {isSignedIn
                                    ? "No saved price alerts yet. Create one with AI and it will show up here once it is saved."
                                    : "Sign in to view and manage your saved price alerts."}
                            </div>
                        )}

                        {alerts.map((alert, idx) => (
                            <div
                                key={alert.id}
                                className="bg-white rounded-lg border border-[#E5E7EB] hover:border-[#D1D5DB] transition-all animate-slide-up"
                                style={{ animationDelay: `${idx * 0.1}s` }}
                            >
                                <div className="px-5 py-4">
                                    {/* Header Row */}
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-3 sm:gap-0">
                                        <div className="flex items-center gap-3">
                                            <div>
                                                <h3 className="text-[#0A2140]" style={{ fontSize: "16px", fontWeight: "600" }}>
                                                    {alert.route}
                                                </h3>
                                                <p className="text-[#6B7280] text-sm">
                                                    {alert.airline || "Any airline"} • {getTripTypeLabel(alert)} • {formatDateRange(alert.dateRange)}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
                                            <span
                                                className={`px-3 py-1 rounded-full text-[13px] border ${alert.active
                                                    ? "bg-[#D1FAE5] text-[#065F46] border-[#A7F3D0]"
                                                    : "bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]"
                                                    }`}
                                                style={{ fontWeight: "500" }}
                                            >
                                                {alert.active ? "Active" : "Paused"}
                                            </span>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <button
                                                        type="button"
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="h-9 w-9 p-0 text-[#9CA3AF] hover:text-[#374151] hover:bg-[#F3F4F6] rounded-md inline-flex items-center justify-center transition-colors cursor-pointer border-none bg-transparent"
                                                    >
                                                        <MoreVertical className="w-5 h-5 text-[#9CA3AF]" />
                                                        <span className="sr-only">Open menu</span>
                                                    </button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end" className="w-44 bg-white border-[#E5E7EB] shadow-lg rounded-md p-1 z-50">
                                                    <DropdownMenuItem
                                                        className="flex items-center gap-2 cursor-pointer text-[#374151] hover:bg-[#F3F4F6] px-2 py-1.5 rounded-sm outline-none"
                                                        onSelect={(e) => { e.preventDefault(); e.stopPropagation(); handleManualEditAlert(alert); }}
                                                    >
                                                        <Edit2 className="w-4 h-4" />
                                                        Edit
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        className="flex items-center gap-2 cursor-pointer text-[#374151] hover:bg-[#F3F4F6] px-2 py-1.5 rounded-sm outline-none"
                                                        onSelect={(e) => { e.preventDefault(); e.stopPropagation(); handleToggleAlert(alert); }}
                                                    >
                                                        {alert.active ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                                                        {alert.active ? 'Pause Alert' : 'Resume Alert'}
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        className="flex items-center gap-2 cursor-pointer text-[#DC2626] hover:bg-[#FEE2E2] hover:text-[#DC2626] px-2 py-1.5 rounded-sm outline-none"
                                                        onSelect={(e) => { e.preventDefault(); e.stopPropagation(); handleDeleteAlert(alert); }}
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                        Delete
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        disabled={!alert.bookUrl}
                                                        className="flex items-center gap-2 cursor-pointer text-[#374151] hover:bg-[#F3F4F6] px-2 py-1.5 rounded-sm outline-none"
                                                        onSelect={(e) => { e.preventDefault(); e.stopPropagation(); handleBookAlert(alert); }}
                                                    >
                                                        <ExternalLink className="w-4 h-4" />
                                                        Book Flight
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                    </div>

                                    {/* Price Information */}
                                    <div className="grid grid-cols-3 gap-4 mb-4">
                                        <div>
                                            <p className="text-xs text-[#6B7280] mb-1">Current Price</p>
                                            <p className="text-[#0A2140]" style={{ fontSize: "18px", fontWeight: "600" }}>
                                                {formatCurrency(alert.currentPrice, alert.currency)}
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-[#6B7280] mb-1">Lowest Tracked</p>
                                            <p className="text-[#10B981]" style={{ fontSize: "18px", fontWeight: "600" }}>
                                                {formatCurrency(alert.lowestPrice, alert.currency)}
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-[#6B7280] mb-1">Price Trend</p>
                                            <div className="flex items-center gap-2">
                                                {normalizeTrend(alert.trend) === "down" ? (
                                                    <TrendingDown className="w-5 h-5 text-[#10B981]" />
                                                ) : normalizeTrend(alert.trend) === "up" ? (
                                                    <TrendingUp className="w-5 h-5 text-[#EF4444]" />
                                                ) : (
                                                    <div className="w-5 h-5 rounded-full bg-[#E5E7EB]" />
                                                )}
                                                <span
                                                    className={
                                                        normalizeTrend(alert.trend) === "down"
                                                            ? "text-[#10B981]"
                                                            : normalizeTrend(alert.trend) === "up"
                                                                ? "text-[#EF4444]"
                                                                : "text-[#6B7280]"
                                                    }
                                                    style={{ fontWeight: "600", fontSize: "15px" }}
                                                >
                                                    {formatChange(alert.changePct, normalizeTrend(alert.trend))}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    <PriceSnapshot alert={alert} />

                                    {(alert.analysisSummary || alert.timingHint) && (
                                        <div className="mt-4 rounded-lg border border-[#DBEAFE] bg-[#F8FBFF] px-3 py-3">
                                            <p className="text-xs uppercase tracking-[0.08em] text-[#1D4ED8] mb-1" style={{ fontWeight: 700 }}>
                                                AI Price Outlook
                                            </p>
                                            {alert.analysisSummary && (
                                                <p className="text-sm text-[#0F172A]">{alert.analysisSummary}</p>
                                            )}
                                            {alert.timingHint && (
                                                <p className="text-xs text-[#475569] mt-2">{alert.timingHint}</p>
                                            )}
                                            {alert.livePriceCheckedAt && (
                                                <p className="text-[11px] text-[#64748B] mt-2">
                                                    Last checked {new Date(alert.livePriceCheckedAt).toLocaleString("en-IN", {
                                                        dateStyle: "medium",
                                                        timeStyle: "short",
                                                    })}
                                                    {alert.livePriceSource ? ` via ${alert.livePriceSource}` : ""}
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
