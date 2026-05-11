"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
    House, Plane, Bell, Award, FileText, TrendingUp, Clock,
    MessageSquare, Send, Sparkles, Map,
    Copy, Flag, Lightbulb, X, Luggage, Wifi, UtensilsCrossed,
    MoreVertical, Edit2, Trash2,
    CheckCircle2, ChevronRight, Plus, Menu, ShieldCheck, AlertCircle, Check, Layout, LogIn, UserPlus, UserRound
} from "lucide-react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import FeedbackWidget from "../../components/FeedbackWidget";
import { useUser } from "@clerk/nextjs";
import {
    CHAT_CACHE_KEY,
    GUEST_CHAT_COUNT_KEY,
    GUEST_CHAT_LIMIT,
    GUEST_CHAT_LIMIT_DISMISSED_KEY,
    readGuestAuthAction,
    readStoredBoolean,
    writeGuestAuthAction,
    writeStoredBoolean,
} from "@/lib/guest-chat";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const SESSION_STORAGE_KEY = "bookwithai_session_id";
const CLEAR_SESSION_URL = "__clear__";
const PENDING_BOOKED_FLIGHT_KEY = "bookwithai_pending_booked_flight";
const PENDING_BOOKING_RETURN_KEY = "bookwithai_pending_booking_return";
const guestProtectedChatRoutes = new Set(["/my-trips", "/deals", "/itineraries", "/loyalty", "/stats"]);
const FLIGHT_BATCH_SIZE = 5;

function getGuestAuthHref(targetPath: string): string {
    return `/sign-in?redirect_url=${encodeURIComponent(targetPath)}`;
}

function getPreferredName(fullName?: string | null, email?: string | null): string {
    const firstName = fullName?.trim().split(/\s+/)[0];
    return firstName || email?.split("@")[0] || "User";
}

function createLocalChatId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }

    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
        const random = Math.floor(Math.random() * 16);
        const value = char === "x" ? random : (random & 0x3) | 0x8;
        return value.toString(16);
    });
}

function readStoredSessionId(): string | null {
    if (typeof window === "undefined") return null;

    try {
        return sessionStorage.getItem(SESSION_STORAGE_KEY);
    } catch {
        return null;
    }
}

function readPendingBookedFlight(): TinyFlight | null {
    if (typeof window === "undefined") return null;

    try {
        const raw = sessionStorage.getItem(PENDING_BOOKED_FLIGHT_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as TinyFlight;
    } catch {
        return null;
    }
}

function writePendingBookedFlight(flight: TinyFlight | null) {
    if (typeof window === "undefined") return;

    try {
        if (flight) {
            sessionStorage.setItem(PENDING_BOOKED_FLIGHT_KEY, JSON.stringify(flight));
        } else {
            sessionStorage.removeItem(PENDING_BOOKED_FLIGHT_KEY);
        }
    } catch {
        // ignore session storage failures
    }
}

function readPendingBookingReturn(): boolean {
    if (typeof window === "undefined") return false;

    try {
        return sessionStorage.getItem(PENDING_BOOKING_RETURN_KEY) === "1";
    } catch {
        return false;
    }
}

function writePendingBookingReturn(value: boolean) {
    if (typeof window === "undefined") return;

    try {
        if (value) {
            sessionStorage.setItem(PENDING_BOOKING_RETURN_KEY, "1");
        } else {
            sessionStorage.removeItem(PENDING_BOOKING_RETURN_KEY);
        }
    } catch {
        // ignore session storage failures
    }
}

interface CachedConversation {
    id: string;
    title: string;
    updatedAt: string;
    messages: ChatUiMessage[];
    isTitleManuallySet?: boolean;
    isTitleAiGenerated?: boolean;
}

function readGuestChatCount(): number {
    if (typeof window === "undefined") return 0;

    try {
        const raw = localStorage.getItem(GUEST_CHAT_COUNT_KEY);
        if (!raw) return 0;

        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed < 0) {
            return 0;
        }

        return Math.floor(parsed);
    } catch {
        return 0;
    }
}

function writeGuestChatCount(count: number) {
    if (typeof window === "undefined") return;

    try {
        localStorage.setItem(GUEST_CHAT_COUNT_KEY, String(Math.max(0, Math.floor(count))));
    } catch {
        // ignore guest usage write failures
    }
}

function readCachedChats(): CachedConversation[] {
    if (typeof window === "undefined") return [];

    try {
        const raw = localStorage.getItem(CHAT_CACHE_KEY);
        if (!raw) return [];

        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];

        return parsed.filter((chat): chat is CachedConversation => (
            chat &&
            typeof chat.id === "string" &&
            Array.isArray(chat.messages)
        ));
    } catch {
        return [];
    }
}

function writeCachedChats(chats: CachedConversation[]) {
    if (typeof window === "undefined") return;

    try {
        localStorage.setItem(CHAT_CACHE_KEY, JSON.stringify(chats.slice(0, 20)));
    } catch {
        // ignore cache write failures
    }
}

function buildChatTitle(messages: ChatUiMessage[]): string {
    const firstUserMessage = messages.find(
        (message) => message.role === "user" && message.content.trim(),
    );

    if (!firstUserMessage) return "New conversation";

    const words = firstUserMessage.content
        .trim()
        .match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)?/g);

    if (!words?.length) return "Travel Chat";

    const stopWords = new Set([
        "a", "an", "and", "are", "at", "book", "booking", "by", "can", "for", "from",
        "get", "help", "i", "if", "in", "into", "is", "it", "me", "my", "of", "on",
        "or", "plan", "planning", "please", "the", "to", "travel", "trip", "with",
    ]);

    const meaningfulWords = words.filter((word) => !stopWords.has(word.toLowerCase()));
    const baseWords = (meaningfulWords.length ? meaningfulWords : words).slice(0, 3);
    const normalizedWords = [...baseWords];

    if (normalizedWords.length === 1) {
        normalizedWords.push("Trip");
    }

    return normalizedWords
        .slice(0, 3)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(" ");
}

function mapChatsToHistory(chats: CachedConversation[]) {
    return chats.map((chat) => ({
        id: chat.id,
        title: chat.title,
        time: formatRelativeTime(chat.updatedAt),
    }));
}

function mapStoredSessionsToHistory(
    sessions: Array<{
        id: string;
        title?: string | null;
        preview?: string | null;
        updated_at?: string | null;
    }>,
) {
    return [...sessions]
        .sort((a, b) => {
            const ta = a.updated_at ? new Date(a.updated_at).getTime() : 0;
            const tb = b.updated_at ? new Date(b.updated_at).getTime() : 0;
            return tb - ta;
        })
        .map((session) => ({
            id: session.id,
            title: session.title?.trim() || session.preview?.trim() || "New conversation",
            time: formatRelativeTime(session.updated_at || null),
        }));
}

/* ─────────── Time formatting ─────────── */

function formatRelativeTime(dateStr: string | null): string {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
}

function formatPrice(amount: number, currency = "USD"): string {
    const normalizedCurrency = (currency || "USD").toUpperCase();
    const fractionDigits = Number.isInteger(amount) ? 0 : 2;

    try {
        return new Intl.NumberFormat("en-IN", {
            style: "currency",
            currency: normalizedCurrency,
            minimumFractionDigits: fractionDigits,
            maximumFractionDigits: fractionDigits,
        }).format(amount);
    } catch {
        return `${normalizedCurrency} ${amount.toLocaleString("en-IN", {
            minimumFractionDigits: fractionDigits,
            maximumFractionDigits: fractionDigits,
        })}`;
    }
}

function formatAbsoluteDateTime(dateStr?: string | null): string | null {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
    });
}

function formatFlightDateLabel(value?: string | null): string | null {
    if (!value) return null;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
        return parsed.toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
        });
    }

    const isoDateMatch = String(value).match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (isoDateMatch?.[1]) {
        const fallback = new Date(`${isoDateMatch[1]}T00:00:00`);
        if (!Number.isNaN(fallback.getTime())) {
            return fallback.toLocaleDateString("en-IN", {
                day: "2-digit",
                month: "short",
                year: "numeric",
            });
        }
    }

    return null;
}

function getVerifiedTotal(offer: {
    price?: {
        grandTotal?: string;
    };
} | null): number | null {
    const total = Number(offer?.price?.grandTotal);
    return Number.isFinite(total) && total > 0 ? total : null;
}

function getVerificationDeltaLabel(
    searchPrice: number,
    verifiedPrice: number,
    currency = "USD",
): string {
    const delta = verifiedPrice - searchPrice;
    if (Math.abs(delta) < 1) {
        return "Matches the recent search price.";
    }

    const formattedDelta = formatPrice(Math.abs(delta), currency);
    return delta > 0
        ? `${formattedDelta} higher than the recent search price.`
        : `${formattedDelta} lower than the recent search price.`;
}

function getSearchPriceLabel(flight: Pick<TinyFlight, "verifiedPrice" | "pricingKind">): string {
    if (flight.verifiedPrice != null) {
        return "Live verified price";
    }
    if (flight.pricingKind === "live_search") {
        return "Live search price";
    }
    return "Search price";
}

function getBookingProviderLabel(provider: string): string {
    switch (provider) {
        case "google":
            return "Google Flights";
        case "skyscanner":
            return "Skyscanner";
        case "kayak":
            return "Kayak";
        default:
            return provider.charAt(0).toUpperCase() + provider.slice(1);
    }
}

function getPrimaryBookingUrl(flight: Pick<TinyFlight, "officialBookingUrl" | "bookingLinks">): string | null {
    return flight.officialBookingUrl || flight.bookingLinks?.google || null;
}

function getVisibleBookingLinks(
    flight: Pick<TinyFlight, "bookingLinks" | "officialBookingUrl">,
): Array<{ provider: string; url: string }> {
    const url = getPrimaryBookingUrl(flight);
    return url ? [{ provider: "google", url }] : [];
}

async function copyTextToClipboard(text: string): Promise<boolean> {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
    }

    if (typeof document === "undefined") return false;

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();

    try {
        return document.execCommand("copy");
    } finally {
        document.body.removeChild(textarea);
    }
}

function getPageSnapshot() {
    if (typeof window === "undefined") return undefined;

    const content = document?.body?.innerText
        ?.replace(/\s+/g, " ")
        .trim()
        .slice(0, 2500) || "";

    return {
        url: window.location.href,
        path: window.location.pathname,
        title: document.title || null,
        capturedAt: new Date().toISOString(),
        contentSnippet: content || null,
        userAgent: window.navigator.userAgent || null,
    };
}

async function requestAiChatTitle(messages: ChatUiMessage[]): Promise<string | null> {
    const titleMessages = messages
        .filter((message) => (
            (message.role === "user" || message.role === "assistant")
            && message.content.trim()
        ))
        .slice(0, 6)
        .map((message) => ({
            role: message.role,
            content: message.content,
        }));

    if (!titleMessages.length) {
        return null;
    }

    try {
        const response = await fetch("/api/chat/title", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: titleMessages }),
        });

        if (!response.ok) {
            return null;
        }

        const data = await response.json() as { title?: string };
        const title = data.title?.trim();
        return title || null;
    } catch {
        return null;
    }
}

/* ─────────── Types ─────────── */

interface TinyFlight {
    id: string;
    airline: string;
    badge?: { text: string; variant: "best" | "cheapest" | "fastest" };
    from: string; to: string;
    departTime: string; arriveTime: string;
    duration: string; stops: number;
    price: number;
    currency?: string;
    searchPrice?: number;
    searchCurrency?: string;
    verifiedPrice?: number;
    verifiedCurrency?: string;
    verifiedAt?: string;
    verificationSource?: string;
    pricingSource?: string;
    pricingKind?: string;
    hasBag?: boolean; hasWifi?: boolean; hasMeal?: boolean;
    reliabilityScore?: number;
    whyChoose?: string[];
    cons?: string[];
    fromCity?: string;
    toCity?: string;
    departureAt?: string;
    arrivalAt?: string;
    departureDate?: string | null;
    arrivalDate?: string | null;
    flightNumber?: string;
    flightId?: string;
    bookingLinks?: Record<string, string>;
    officialBookingUrl?: string;
    baggageText?: string;
    baggageCabin?: string | null;
    baggageChecked?: string | null;
    cabinClass?: string;
    fareBrand?: string;
    refundable?: boolean | null;
    changePenalty?: string;
    mealServices?: string[];
    aircraft?: string;
    operator?: string;
    status?: string;
    providers?: string[];
    searchCheckedAt?: string;
    stopCities?: string[];
    stopLabels?: string[];
    rawOffer?: Record<string, unknown>;
    segments?: FlightSegment[];
    convenience?: {
        airportName?: string | null;
        distanceKm?: number | null;
        travelMinutes?: number | null;
    };
    comparison?: {
        activePriceSource?: string | null;
        marketPosition?: string | null;
        priceGapFromCheapest?: number | null;
        providerQuotes?: Record<string, number>;
    };
    pricing?: {
        source?: string;
        kind?: string;
        lastCheckedAt?: string;
    };
}

interface WeatherData {
    city: string;
    temp: number;
    feels_like: number;
    temp_min: number;
    temp_max: number;
    humidity: number;
    condition: string;
    description: string;
    icon_url: string;
    wind_speed: number;
}

interface MapsData {
    origin_airport: string;
    destination_airport: string;
    directions_url: string;
    embed_url: string;
}

interface ChatSearchMeta {
    fromCity: string;
    toCity: string;
}

interface ChatUiMessage {
    localId?: string;
    role: string;
    content: string;
    flights?: TinyFlight[];
    allFlights?: TinyFlight[];
    recommendationNote?: string;
    searchMeta?: ChatSearchMeta;
    weather?: WeatherData;
    weatherAdvice?: string;
    maps?: MapsData;
    destMapUrl?: string;
}

interface BackendFlight {
    flight_id?: string;
    airline?: string;
    badge?: string;
    from_iata?: string;
    to_iata?: string;
    departure_time?: string;
    arrival_time?: string;
    departure_at?: string;
    arrival_at?: string;
    departure_date?: string;
    arrival_date?: string;
    duration?: string;
    stops?: number;
    stop_cities?: string[];
    stop_labels?: string[];
    price?: number;
    baggage_text?: string;
    flight_number?: string;
    why_choose?: string[];
    pros?: string[];
    cons?: string[];
    perks?: string[];
    providers?: string[];
    booking?: {
        deepLinks?: Record<string, string>;
        officialLink?: string;
        priceVerified?: boolean;
        lastCheckedAt?: string;
    };
    cabin_class?: string;
    fare_brand?: string;
    refundable?: boolean | null;
    change_penalty?: string;
    meal_services?: string[];
    segments?: FlightSegment[];
    route?: {
        originIata?: string;
        destinationIata?: string;
        originCity?: string;
        destinationCity?: string;
    };
    fare?: {
        total?: number;
        currency?: string;
    };
    currency?: string;
    baggage?: {
        included?: boolean;
        checked?: string | null;
        cabin?: string | null;
    };
    operations?: {
        reliabilityScore?: number | null;
        aircraft?: string | null;
        operator?: string | null;
        status?: string | null;
    };
    ranking?: {
        badges?: string[];
        pros?: string[];
        cons?: string[];
    };
    convenience?: {
        airportName?: string | null;
        distanceKm?: number | null;
        travelMinutes?: number | null;
    };
    comparison?: {
        activePriceSource?: string | null;
        marketPosition?: string | null;
        priceGapFromCheapest?: number | null;
        providerQuotes?: Record<string, number>;
    };
    pricing?: {
        source?: string;
        kind?: string;
        lastCheckedAt?: string;
    };
    provider_refs?: {
        amadeus?: {
            offerId?: string;
            rawOffer?: Record<string, unknown>;
        };
        serpapi?: {
            offerId?: string;
            bookingToken?: string;
            link?: string;
        };
        flightaware?: {
            faFlightId?: string;
        };
    };
}

interface ChatApiResponse {
    text?: string;
    session_id?: string;
    type?: string;
    flights?: BackendFlight[];
    all_flights?: BackendFlight[];
    search?: {
        origin?: string;
        destination?: string;
    };
    weather?: WeatherData;
    weather_advice?: string;
    maps?: MapsData;
    destination_map_url?: string;
    follow_up_prompt?: string;
    recommendation_explanation?: string;
    recommendation_note?: string;
}

interface StreamedChatEvent {
    event: "start" | "delta" | "final";
    delta?: string;
    response?: ChatApiResponse;
}

interface StoredSessionMessage {
    role: string;
    content: string;
    metadata?: ChatApiResponse | Record<string, unknown> | null;
}

interface StoredSessionResponse {
    id: string;
    title?: string | null;
    updated_at?: string | null;
    messages: StoredSessionMessage[];
}

interface StoredSessionListItem {
    id: string;
    title?: string | null;
    preview?: string | null;
    updated_at?: string | null;
}

interface PriceVerificationMeta {
    source?: string;
    verified_at?: string;
}

interface FlightDetail extends TinyFlight {
    fromCity: string; toCity: string;
    miles?: { amount: number; program: string; tierProgress: number; tierName: string };
    upgrade?: { available: boolean; price: string };
    insights?: { type: string; text: string }[];
    baggage?: { cabin?: string | null; checked?: string | null };
    fareRules?: string[];
    aircraft?: string;
}

interface FlightSegment {
    marketingCarrier?: string | null;
    operatingCarrier?: string | null;
    flightNumber?: string | null;
    aircraft?: string | null;
    departureAt?: string | null;
    arrivalAt?: string | null;
    originIata?: string | null;
    destinationIata?: string | null;
    originCity?: string | null;
    destinationCity?: string | null;
    terminalDeparture?: string | null;
    terminalArrival?: string | null;
}

function getBadgeVariant(text?: string): "best" | "cheapest" | "fastest" | undefined {
    const normalized = (text || "").toLowerCase();
    if (normalized.includes("cheap")) return "cheapest";
    if (normalized.includes("fast")) return "fastest";
    if (normalized) return "best";
    return undefined;
}

function formatLocationLabel(locationName?: string | null, iataCode?: string | null): string | null {
    const code = (iataCode || "").trim().toUpperCase();
    const name = (locationName || "").trim();
    if (!name && !code) return null;
    if (!code) return name || null;
    if (!name) return code;

    const normalizedName = name.replace(/\s+/g, " ");
    const codeMatch = normalizedName.match(/\(([A-Za-z0-9]{3})\)\s*$/);
    if (codeMatch && codeMatch[1].toUpperCase() === code) {
        return normalizedName;
    }
    if (normalizedName.toUpperCase() === code) {
        return code;
    }

    return `${normalizedName} (${code})`;
}

function normalizeStoredLocationLabel(value: string): string | null {
    const trimmed = (value || "").trim();
    if (!trimmed) return null;

    const match = trimmed.match(/^(.+?)\s*\(([A-Za-z0-9]{3})\)$/);
    if (match) {
        const name = match[1].trim();
        const code = match[2].toUpperCase();
        return name ? `${name} (${code})` : code;
    }

    if (/^[A-Za-z0-9]{3}$/.test(trimmed)) {
        return trimmed.toUpperCase();
    }

    return trimmed;
}

function mapFlightToTinyFlight(flight: BackendFlight, index: number): TinyFlight {
    const route = flight.route || {};
    const fare = flight.fare || {};
    const ops = flight.operations || {};
    const baggage = flight.baggage || {};
    const ranking = flight.ranking || {};
    const pricing = flight.pricing || {};
    const perks = flight.perks || [];
    const mealServices = flight.meal_services || [];
    const segments = flight.segments || [];
    const lastSegment = segments.length ? segments[segments.length - 1] : undefined;
    const bookingLinks = flight.booking?.deepLinks || {};
    const officialBookingUrl = flight.booking?.officialLink
        || bookingLinks.google
        || undefined;
    const amenityText = [...perks, ...mealServices]
        .map((item) => String(item || "").toLowerCase());
    const badgeText = flight.badge || ranking.badges?.[0];
    const searchPrice = Number(flight.price || fare.total || 0);
    const searchCurrency = flight.currency || fare.currency || "USD";
    const departureAtRaw =
        flight.departure_at
        || segments[0]?.departureAt
        || flight.departure_time;
    const arrivalAtRaw =
        flight.arrival_at
        || lastSegment?.arrivalAt
        || flight.arrival_time;
    const reliability =
        typeof ops.reliabilityScore === "number"
            ? Number(ops.reliabilityScore.toFixed(1))
            : undefined;

    return {
        id: flight.flight_id || `FL${index}`,
        airline: flight.airline || "Unknown airline",
        badge: badgeText
            ? { text: badgeText, variant: getBadgeVariant(badgeText) || "best" }
            : undefined,
        from: route.originIata || flight.from_iata || "ORG",
        to: route.destinationIata || flight.to_iata || "DST",
        fromCity: route.originCity || flight.from_iata || "Origin",
        toCity: route.destinationCity || flight.to_iata || "Destination",
        departTime: flight.departure_time || "",
        arriveTime: flight.arrival_time || "",
        departureAt: departureAtRaw || undefined,
        arrivalAt: arrivalAtRaw || undefined,
        departureDate: formatFlightDateLabel(flight.departure_date || departureAtRaw),
        arrivalDate: formatFlightDateLabel(flight.arrival_date || arrivalAtRaw),
        duration: flight.duration || "",
        stops: flight.stops || 0,
        price: searchPrice,
        currency: searchCurrency,
        searchPrice,
        searchCurrency,
        pricingSource: pricing.source || flight.comparison?.activePriceSource || undefined,
        pricingKind: pricing.kind || undefined,
        hasBag: Boolean(baggage.included || baggage.checked || baggage.cabin || flight.baggage_text),
        hasWifi: amenityText.some((item) => item.includes("wifi") || item.includes("wi-fi")),
        hasMeal: amenityText.some((item) => item.includes("meal")),
        reliabilityScore: reliability,
        whyChoose: flight.why_choose || ranking.pros || flight.pros || [],
        cons: ranking.cons || flight.cons || [],
        flightNumber: flight.flight_number,
        flightId: flight.flight_id || `FL${index}`,
        bookingLinks,
        officialBookingUrl,
        baggageText: flight.baggage_text,
        baggageCabin: baggage.cabin || undefined,
        baggageChecked: baggage.checked || undefined,
        cabinClass: flight.cabin_class || undefined,
        fareBrand: flight.fare_brand || undefined,
        refundable: typeof flight.refundable === "boolean" ? flight.refundable : null,
        changePenalty: flight.change_penalty || undefined,
        mealServices,
        aircraft: ops.aircraft || undefined,
        operator: ops.operator || undefined,
        status: ops.status || undefined,
        providers: flight.providers || [],
        searchCheckedAt: pricing.lastCheckedAt || flight.booking?.lastCheckedAt,
        stopCities: flight.stop_cities || [],
        stopLabels: flight.stop_labels || [],
        rawOffer: flight.provider_refs?.amadeus?.rawOffer,
        segments,
        convenience: {
            airportName: flight.convenience?.airportName,
            distanceKm: flight.convenience?.distanceKm,
            travelMinutes: flight.convenience?.travelMinutes,
        },
        comparison: {
            activePriceSource: flight.comparison?.activePriceSource,
            marketPosition: flight.comparison?.marketPosition,
            priceGapFromCheapest: flight.comparison?.priceGapFromCheapest,
            providerQuotes: flight.comparison?.providerQuotes,
        },
    };
}

function getStopLabels(flight: TinyFlight): string[] {
    const explicitLabels = (flight.stopLabels || [])
        .map((value) => normalizeStoredLocationLabel(value))
        .filter((label): label is string => Boolean(label));
    if (explicitLabels.length) {
        return Array.from(new Set(explicitLabels));
    }

    const segmentStops = (flight.segments || [])
        .slice(0, Math.max((flight.segments || []).length - 1, 0))
        .map((segment) => formatLocationLabel(segment.destinationCity, segment.destinationIata))
        .filter((label): label is string => Boolean(label));
    if (segmentStops.length) {
        return Array.from(new Set(segmentStops));
    }

    const explicitStops = (flight.stopCities || [])
        .map((value) => normalizeStoredLocationLabel(value))
        .filter((label): label is string => Boolean(label));

    return Array.from(new Set(explicitStops));
}

function buildStopsText(flight: TinyFlight): string | null {
    if (!flight.stops || flight.stops <= 0) return null;
    const labels = getStopLabels(flight);
    if (!labels.length) return null;
    return labels.slice(0, Math.max(1, flight.stops)).join(", ");
}

function mapAssistantResponseToUiMessage(data: ChatApiResponse): ChatUiMessage {
    const msgObj: ChatUiMessage = {
        localId: createLocalChatId(),
        role: "assistant",
        content: data.text || "Sorry, something went wrong.",
    };

    if (data.type === "flights") {
        const sourceFlights = data.all_flights?.length ? data.all_flights : data.flights;
        if (sourceFlights?.length) {
            msgObj.allFlights = sourceFlights.map((flight, index) =>
                mapFlightToTinyFlight(flight, index),
            );
            const topFlights = sourceFlights.slice(0, 5);
            msgObj.flights = topFlights.map((flight, index) =>
                mapFlightToTinyFlight(flight, index),
            );
            msgObj.searchMeta = {
                fromCity: data.search?.origin || topFlights[0]?.route?.originCity || "Origin",
                toCity: data.search?.destination || topFlights[0]?.route?.destinationCity || "Destination",
            };
        }
        if (data.weather) msgObj.weather = data.weather;
        if (data.weather_advice) msgObj.weatherAdvice = data.weather_advice;
        if (data.maps) msgObj.maps = data.maps;
        if (data.destination_map_url) msgObj.destMapUrl = data.destination_map_url;
        if (data.recommendation_note || data.recommendation_explanation) {
            msgObj.recommendationNote = data.recommendation_note || data.recommendation_explanation;
        }
    }

    if (data.follow_up_prompt) {
        msgObj.content = `${msgObj.content}\n\n${data.follow_up_prompt}`;
    }

    return msgObj;
}

async function readStreamedChatResponse(
    response: Response,
    onDelta: (delta: string) => void,
): Promise<ChatApiResponse> {
    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error("Streaming reader unavailable");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let finalResponse: ChatApiResponse | null = null;

    const processLine = (line: string) => {
        if (!line.trim()) return;
        const payload = JSON.parse(line) as StreamedChatEvent;
        if (payload.event === "delta" && payload.delta) {
            onDelta(payload.delta);
        }
        if (payload.event === "final" && payload.response) {
            finalResponse = payload.response;
        }
    };

    while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex >= 0) {
            const line = buffer.slice(0, newlineIndex);
            buffer = buffer.slice(newlineIndex + 1);
            processLine(line);
            newlineIndex = buffer.indexOf("\n");
        }

        if (done) {
            break;
        }
    }

    if (buffer.trim()) {
        processLine(buffer);
    }

    if (!finalResponse) {
        throw new Error("Missing final streamed response");
    }

    return finalResponse;
}

function mapStoredSessionMessageToUiMessage(message: StoredSessionMessage): ChatUiMessage {
    if (
        message.role === "assistant"
        && message.metadata
        && typeof message.metadata === "object"
    ) {
        const assistantPayload = message.metadata as ChatApiResponse;
        return mapAssistantResponseToUiMessage({
            ...assistantPayload,
            text: assistantPayload.text || message.content,
        });
    }

    return {
        role: message.role,
        content: message.content || "",
    };
}

function isSaveConfirmationPrompt(message: ChatUiMessage): boolean {
    if (message.role !== "assistant") return false;
    const text = (message.content || "").toLowerCase();
    return (
        text.includes("reply with 'yes'") ||
        text.includes("reply with \"yes\"") ||
        text.includes("do you want me to save") ||
        text.includes("save them to my trips now") ||
        text.includes("save this itinerary") ||
        text.includes("save itinerary") ||
        text.includes("save this price alert") ||
        text.includes("save the updated price alert") ||
        text.includes("save them to your profile")
    );
}

function isItinerarySavePrompt(message: ChatUiMessage): boolean {
    if (message.role !== "assistant") return false;
    const text = (message.content || "").toLowerCase();
    return text.includes("itinerary") && text.includes("save");
}

function isProfileSavePrompt(message: ChatUiMessage): boolean {
    if (message.role !== "assistant") return false;
    const text = (message.content || "").toLowerCase();
    return text.includes("profile") && (text.includes("save") || text.includes("confirm"));
}

function isBookedFlightConsentPrompt(message: ChatUiMessage): boolean {
    if (message.role !== "assistant") return false;
    const text = (message.content || "").toLowerCase();
    return text.includes("did you book this flight");
}

function isTripTimingPrompt(message: ChatUiMessage): boolean {
    if (message.role !== "assistant") return false;
    const text = (message.content || "").toLowerCase();
    return text.includes("future trip or a past trip");
}

function isTripSaveReadyPrompt(message: ChatUiMessage): boolean {
    if (message.role !== "assistant") return false;
    const text = (message.content || "").toLowerCase();
    return text.includes("should i save these flight details to my trips now");
}

function isFlightDetailsFollowUp(text: string): boolean {
    const normalized = (text || "").trim().toLowerCase();
    if (!normalized) return false;
    return (
        normalized.includes("flight details")
        || normalized.includes("show details")
        || normalized.includes("show me details")
        || normalized.includes("open details")
        || normalized.includes("view details")
        || normalized.includes("details please")
    );
}

function serializeTinyFlightForImport(flight: TinyFlight): BackendFlight {
    const searchPrice = flight.searchPrice ?? flight.price;
    const searchCurrency = (flight.searchCurrency || flight.currency || "USD").toUpperCase();

    return {
        flight_id: flight.flightId || flight.id,
        airline: flight.airline,
        badge: flight.badge?.text,
        from_iata: flight.from,
        to_iata: flight.to,
        departure_time: flight.departTime,
        arrival_time: flight.arriveTime,
        departure_at: flight.departureAt,
        arrival_at: flight.arrivalAt,
        departure_date: flight.departureDate || undefined,
        arrival_date: flight.arrivalDate || undefined,
        duration: flight.duration,
        stops: flight.stops,
        stop_cities: flight.stopCities,
        stop_labels: flight.stopLabels,
        price: searchPrice,
        currency: searchCurrency,
        baggage_text: flight.baggageText,
        flight_number: flight.flightNumber,
        why_choose: flight.whyChoose,
        cons: flight.cons,
        providers: flight.providers,
        cabin_class: flight.cabinClass,
        fare_brand: flight.fareBrand,
        refundable: flight.refundable,
        change_penalty: flight.changePenalty,
        meal_services: flight.mealServices,
        segments: flight.segments,
        route: {
            originIata: flight.from,
            destinationIata: flight.to,
            originCity: flight.fromCity || flight.from,
            destinationCity: flight.toCity || flight.to,
        },
        fare: {
            total: searchPrice,
            currency: searchCurrency,
        },
        baggage: {
            included: flight.hasBag,
            checked: flight.baggageChecked ?? flight.baggageText ?? null,
            cabin: flight.baggageCabin ?? null,
        },
        operations: {
            reliabilityScore: flight.reliabilityScore ?? null,
            aircraft: flight.aircraft ?? null,
            operator: flight.operator ?? null,
            status: flight.status ?? null,
        },
        convenience: {
            airportName: flight.convenience?.airportName ?? null,
            distanceKm: flight.convenience?.distanceKm ?? null,
            travelMinutes: flight.convenience?.travelMinutes ?? null,
        },
        comparison: {
            activePriceSource: flight.comparison?.activePriceSource ?? null,
            marketPosition: flight.comparison?.marketPosition ?? null,
            priceGapFromCheapest: flight.comparison?.priceGapFromCheapest ?? null,
            providerQuotes: flight.comparison?.providerQuotes || {},
        },
        pricing: {
            source: flight.pricingSource,
            kind: flight.pricingKind,
            lastCheckedAt: flight.searchCheckedAt,
        },
        booking: {
            deepLinks: flight.bookingLinks || {},
            officialLink: flight.officialBookingUrl,
            lastCheckedAt: flight.verifiedAt || flight.searchCheckedAt,
        },
        provider_refs: flight.rawOffer
            ? {
                amadeus: {
                    rawOffer: flight.rawOffer,
                },
            }
            : undefined,
    };
}

function serializeMessageForImport(message: ChatUiMessage): {
    role: string;
    content: string;
    metadata?: ChatApiResponse;
} {
    if (message.role !== "assistant") {
        return {
            role: message.role,
            content: message.content,
        };
    }

    const metadata: ChatApiResponse = {
        text: message.content,
    };

    if (message.flights?.length) {
        metadata.type = "flights";
        metadata.flights = message.flights.map(serializeTinyFlightForImport);
        if (message.allFlights?.length) {
            metadata.all_flights = message.allFlights.map(serializeTinyFlightForImport);
        }
        if (message.searchMeta) {
            metadata.search = {
                origin: message.searchMeta.fromCity,
                destination: message.searchMeta.toCity,
            };
        }
    }
    if (message.recommendationNote) {
        metadata.recommendation_note = message.recommendationNote;
    }

    if (message.weather) metadata.weather = message.weather;
    if (message.weatherAdvice) metadata.weather_advice = message.weatherAdvice;
    if (message.maps) metadata.maps = message.maps;
    if (message.destMapUrl) metadata.destination_map_url = message.destMapUrl;

    return {
        role: message.role,
        content: message.content,
        metadata,
    };
}

function serializeConversationForImport(conversation: CachedConversation) {
    return {
        id: conversation.id,
        title: conversation.title,
        updated_at: conversation.updatedAt,
        messages: conversation.messages.map(serializeMessageForImport),
    };
}

/* ─────────── Sidebar nav ─────────── */

const navLinks = [
    { href: "/", label: "Home", icon: House },
    { href: "/my-trips", label: "My Trips", icon: Plane },
    { href: "/deals", label: "Price Alerts", icon: Bell },
    { href: "/loyalty", label: "Loyalty & Miles", icon: Award },
    { href: "/itineraries", label: "Itineraries", icon: FileText },
    { href: "/stats", label: "Travel Stats", icon: TrendingUp },
];

/* ─────────── Travel tips ─────────── */

const FALLBACK_TRAVEL_TIP = "Check the baggage rules before booking so a cheap fare does not turn expensive at checkout.";
const CLIENT_TRAVEL_TIPS = [
    FALLBACK_TRAVEL_TIP,
    "Flights with longer layovers can cost less, but protect tight international connections with extra buffer time.",
    "Morning departures are usually less disruption-prone than late-evening flights on busy routes.",
    "Compare total trip cost, not just fare, when a far airport adds extra taxi or train expense.",
    "If your dates are flexible, shifting by one day can unlock a noticeably better fare on the same route.",
    "Pick the airport first in multi-airport cities because convenience can matter more than a small fare difference.",
];

/* ─────────── Quick actions ─────────── */

const quickActions: Array<{
    label: string;
    icon: typeof Plane;
    /** If set, sent instead of label (label stays short for the chip). */
    message?: string;
}> = [
    {
        label: "Find flights",
        icon: Plane,
    },
    {
        label: "Save a trip",
        icon: Luggage,
        message:
            "I want to add a trip to My Trips. I'll share departure city, destination, and travel dates. Please ask me to confirm before saving.",
    },
    {
        label: "Price alert",
        icon: Bell,
        message:
            "I want to create a price alert for flights. I'll share the route and dates—then remind me to confirm before you save the alert.",
    },
    {
        label: "Plan itinerary",
        icon: FileText,
        message:
            "I want a day-by-day itinerary. I'll tell you the destination and how many days (for example: 5 days in Tokyo).",
    },
    {
        label: "Update profile",
        icon: UserRound,
        message:
            "I want to update my travel profile (name, phone, nationality, address, or date of birth). I'll share the new details.",
    },
];

/* ━━━━━━━━━━━━━━━━━━━━ TinyFlightCard ━━━━━━━━━━━━━━━━━━━━ */

function TinyFlightCard({
    flight, onDetails, onTrackPrice, onBook
}: {
    flight: TinyFlight;
    onDetails: (id: string) => void;
    onTrackPrice: (id: string) => void;
    onBook: (flight: TinyFlight) => void;
}) {
    const badgeColors: Record<string, string> = {
        best: "bg-[#DBEAFE] text-[#1D4ED8] border border-[#BFDBFE]",
        cheapest: "bg-[#DCFCE7] text-[#047857] border border-[#A7F3D0]",
        fastest: "bg-[#FEF3C7] text-[#B45309] border border-[#FCD34D]",
    };
    const stopDetails = buildStopsText(flight);
    const primaryBookingUrl = getPrimaryBookingUrl(flight);
    const bookingLinkList = getVisibleBookingLinks(flight);
    const departureMeta = [flight.departTime, flight.departureDate].filter(Boolean).join(" · ");
    const arrivalMeta = [flight.arriveTime, flight.arrivalDate].filter(Boolean).join(" · ");
    const marketPosition = flight.comparison?.marketPosition
        ? flight.comparison.marketPosition.replace("_", " ")
        : null;
    const stopLabel = flight.stops === 0 ? "Nonstop" : `${flight.stops} stop${flight.stops > 1 ? "s" : ""}`;

    return (
        <div className="rounded-[22px] border border-[#D9E7FF] bg-[linear-gradient(180deg,#FFFFFF_0%,#F8FBFF_100%)] p-4 shadow-[0_12px_28px_-18px_rgba(29,78,216,0.45)] transition-all hover:-translate-y-0.5 hover:border-[#93C5FD] hover:shadow-[0_18px_42px_-22px_rgba(29,78,216,0.45)]">
            <div className="mb-4 flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#DBEAFE_0%,#BFDBFE_100%)] shadow-sm">
                        <Plane className="h-4 w-4 text-[#1D4ED8]" />
                    </div>
                    <div>
                        <p className="text-sm text-[#0A2140]" style={{ fontWeight: 700 }}>{flight.airline}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[#64748B]">
                            {flight.flightNumber && <span>{flight.flightNumber}</span>}
                            {flight.cabinClass && <span>{flight.cabinClass}</span>}
                            {marketPosition && <span className="capitalize">{marketPosition}</span>}
                        </div>
                        {flight.badge && (
                            <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${badgeColors[flight.badge.variant] || "border border-gray-200 bg-gray-100 text-gray-600"}`}>
                                {flight.badge.text}
                            </span>
                        )}
                    </div>
                </div>
                <div className="text-right">
                    <p className="text-lg text-[#0A2140]" style={{ fontWeight: 800 }}>
                        {formatPrice(flight.price, flight.currency)}
                    </p>
                    <p className="mt-0.5 text-[10px] text-[#64748B]">
                        {getSearchPriceLabel(flight)}
                    </p>
                    {flight.verifiedPrice != null && flight.searchPrice != null && (
                        <p className="mt-0.5 text-[10px] text-[#64748B]">
                            Search price was {formatPrice(flight.searchPrice, flight.searchCurrency || flight.currency)}
                        </p>
                    )}
                </div>
            </div>

            <div className="rounded-2xl border border-[#E2E8F0] bg-white/80 p-4">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <p className="text-xl text-[#0A2140]" style={{ fontWeight: 800 }}>{flight.from}</p>
                        <p className="mt-1 text-xs text-[#475569]">{departureMeta || "Departure time pending"}</p>
                        <p className="mt-1 text-[11px] text-[#94A3B8]">{flight.fromCity || flight.from}</p>
                    </div>
                    <div className="mx-2 flex flex-1 flex-col items-center">
                        <div className="mb-2 flex items-center gap-2">
                            <span className="rounded-full bg-[#EFF6FF] px-2.5 py-1 text-[10px] font-semibold text-[#1D4ED8]">
                                {flight.duration}
                            </span>
                            <span className="rounded-full bg-[#F8FAFC] px-2.5 py-1 text-[10px] font-semibold text-[#475569]">
                                {stopLabel}
                            </span>
                        </div>
                        <div className="flex w-full items-center">
                            <div className="h-2.5 w-2.5 rounded-full border-2 border-[#1D4ED8] bg-white" />
                            <div className="relative mx-2 h-[2px] flex-1 bg-[linear-gradient(90deg,#93C5FD_0%,#1D4ED8_100%)]">
                                <Plane className="absolute -top-[7px] left-1/2 h-3.5 w-3.5 -translate-x-1/2 -rotate-45 text-[#1D4ED8]" />
                            </div>
                            <div className="h-2.5 w-2.5 rounded-full bg-[#1D4ED8]" />
                        </div>
                        {stopDetails && (
                            <p className="mt-2 text-center text-[11px] text-[#64748B]">
                                Stopover: <span className="font-medium text-[#0A2140]">{stopDetails}</span>
                            </p>
                        )}
                    </div>
                    <div className="text-right">
                        <p className="text-xl text-[#0A2140]" style={{ fontWeight: 800 }}>{flight.to}</p>
                        <p className="mt-1 text-xs text-[#475569]">{arrivalMeta || "Arrival time pending"}</p>
                        <p className="mt-1 text-[11px] text-[#94A3B8]">{flight.toCity || flight.to}</p>
                    </div>
                </div>
            </div>

            {flight.whyChoose && flight.whyChoose.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                    {flight.whyChoose.slice(0, 3).map((reason, i) => (
                        <span key={i} className="rounded-full border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-1.5 text-[11px] text-[#1D4ED8]">
                            {reason}
                        </span>
                    ))}
                </div>
            )}

            {flight.cons && flight.cons.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                    {flight.cons.slice(0, 2).map((reason, i) => (
                        <span key={i} className="rounded-full border border-[#FED7AA] bg-[#FFF7ED] px-3 py-1.5 text-[11px] text-[#C2410C]">
                            {reason}
                        </span>
                    ))}
                </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2.5 text-[11px] text-[#475569]">
                {flight.hasBag && <span className="flex items-center gap-1 rounded-full bg-white px-2.5 py-1 border border-[#E2E8F0]"><Luggage className="h-3 w-3" /> Bag</span>}
                {flight.hasWifi && <span className="flex items-center gap-1 rounded-full bg-white px-2.5 py-1 border border-[#E2E8F0]"><Wifi className="h-3 w-3" /> Wi-Fi</span>}
                {flight.hasMeal && <span className="flex items-center gap-1 rounded-full bg-white px-2.5 py-1 border border-[#E2E8F0]"><UtensilsCrossed className="h-3 w-3" /> Meal</span>}
                {flight.reliabilityScore != null && (
                    <span className="flex items-center gap-1 rounded-full bg-white px-2.5 py-1 border border-[#E2E8F0]">
                        <CheckCircle2 className="h-3 w-3 text-[#059669]" /> Ops {flight.reliabilityScore}/10
                    </span>
                )}
                {/* {(flight.convenience?.distanceKm != null || flight.convenience?.travelMinutes != null) && (
                    <span className="flex items-center gap-1 rounded-full bg-white px-2.5 py-1 border border-[#E2E8F0]">
                        <Map className="h-3 w-3 text-[#1D4ED8]" />
                        {flight.convenience?.distanceKm != null ? `${flight.convenience.distanceKm} km` : ""}
                        {flight.convenience?.distanceKm != null && flight.convenience?.travelMinutes != null ? " · " : ""}
                        {flight.convenience?.travelMinutes != null ? `${flight.convenience.travelMinutes} min to airport` : ""}
                    </span>
                )} */}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
                {primaryBookingUrl && (
                    <a
                        href={primaryBookingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => onBook(flight)}
                        className="inline-flex items-center gap-2 rounded-xl bg-[linear-gradient(135deg,#1D4ED8_0%,#2563EB_100%)] px-4 py-2.5 text-sm text-white no-underline shadow-sm transition-colors hover:bg-[#1E40AF]"
                        style={{ fontWeight: 700 }}
                    >
                        Book on Google Flights
                        <ChevronRight className="h-4 w-4" />
                    </a>
                )}
                <button
                    onClick={() => onDetails(flight.id)}
                    className="rounded-xl border border-[#BFDBFE] bg-white px-4 py-2.5 text-sm text-[#1D4ED8] transition-colors hover:bg-[#EFF6FF] cursor-pointer"
                    style={{ fontWeight: 600 }}
                >
                    View details
                </button>
                <button
                    onClick={() => onTrackPrice(flight.id)}
                    className="rounded-xl border border-[#E2E8F0] bg-white px-4 py-2.5 text-sm text-[#475569] transition-colors hover:bg-[#F8FAFC] cursor-pointer"
                    style={{ fontWeight: 600 }}
                >
                    Track price
                </button>
            </div>
        </div>
    );
}

/* ━━━━━━━━━━━━━━━━━━━━ FlightDetailsPanel ━━━━━━━━━━━━━━━━━━━━ */

function FlightDetailsPanel({
    flight,
    isOpen,
    onClose,
    onBook,
    verifying,
    error,
    confirmedOffer,
    verificationMeta,
    seatmaps,
}: {
    flight: FlightDetail | null;
    isOpen: boolean;
    onClose: () => void;
    onBook: (flight: TinyFlight) => void;
    verifying: boolean;
    error: string | null;
    confirmedOffer: {
        price?: {
            currency?: string;
            grandTotal?: string;
        };
    } | null;
    verificationMeta: PriceVerificationMeta | null;
    seatmaps: Array<{
        deck?: number;
        aircraftCabinAmenities?: {
            cabinClass?: string;
        };
    }> | null;
}) {
    if (!isOpen || !flight) return null;

    const persistedVerifiedTotal = flight.verifiedPrice ?? null;
    const verifiedTotal = getVerifiedTotal(confirmedOffer) ?? persistedVerifiedTotal;
    const displayCurrency = (
        confirmedOffer?.price?.currency
        || flight.verifiedCurrency
        || flight.currency
        || "USD"
    ).toUpperCase();
    const displayPrice = verifiedTotal ?? flight.price;
    const searchPrice = flight.searchPrice ?? flight.price;
    const searchCurrency = (flight.searchCurrency || flight.currency || displayCurrency).toUpperCase();
    const searchSnapshotAt = formatAbsoluteDateTime(flight.searchCheckedAt);
    const verifiedAt = formatAbsoluteDateTime(verificationMeta?.verified_at || flight.verifiedAt);
    const providerQuoteValues = Object.values(flight.comparison?.providerQuotes || {})
        .map((price) => Number(price))
        .filter((price) => Number.isFinite(price) && price > 0);
    const providerQuoteMin = providerQuoteValues.length ? Math.min(...providerQuoteValues) : null;
    const providerQuoteMax = providerQuoteValues.length ? Math.max(...providerQuoteValues) : null;
    const mealSummary = flight.mealServices && flight.mealServices.length
        ? `This flight offers: ${flight.mealServices.slice(0, 3).join(", ")}.`
        : (flight.hasMeal ? "This flight offers onboard meal service." : null);

    const departureMeta = [flight.departTime, flight.departureDate].filter(Boolean).join(" · ");
    const arrivalMeta = [flight.arriveTime, flight.arrivalDate].filter(Boolean).join(" · ");
    const stopDetails = buildStopsText(flight);
    const primaryBookingUrl = getPrimaryBookingUrl(flight);
    const bookingLinkList = getVisibleBookingLinks(flight);

    return (
        <div className="w-full md:w-[340px] border-l border-[#E5E7EB] bg-white flex flex-col flex-shrink-0 overflow-y-auto h-full absolute md:relative z-50 md:z-auto right-0 shadow-2xl md:shadow-none">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-[#E5E7EB]">
                <h3 className="text-[#0A2140] text-base" style={{ fontWeight: 600 }}>Flight Details</h3>
                <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-[#F3F4F6] flex items-center justify-center text-[#6B7280] hover:text-[#374151] transition-colors bg-transparent border-none cursor-pointer">
                    <X className="w-4 h-4" />
                </button>
            </div>

            <div className="p-5 space-y-5">
                {/* Airline + Price */}
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-[#F3F4F6] flex items-center justify-center">
                            <Plane className="w-5 h-5 text-[#6B7280]" />
                        </div>
                        <div>
                            <p className="text-[#0A2140] text-sm" style={{ fontWeight: 600 }}>{flight.airline}</p>
                            {flight.badge && (
                                <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full mt-0.5 ${flight.badge.variant === "best" ? "bg-[#DBEAFE] text-[#1D4ED8]" :
                                    flight.badge.variant === "cheapest" ? "bg-[#D1FAE5] text-[#059669]" :
                                        "bg-[#FEF3C7] text-[#D97706]"
                                    }`}>
                                    {flight.badge.text}
                                    
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="text-right">
                        <p className="text-[#0A2140] text-xl" style={{ fontWeight: 700 }}>
                            {formatPrice(displayPrice, displayCurrency)}
                        </p>
                        <p className="text-[11px] text-[#6B7280] mt-1">
                            {getSearchPriceLabel(flight)}
                        </p>
                        {verifiedAt && (
                            <p className="text-[10px] text-[#6B7280] mt-1">
                                Verified live on {verifiedAt}
                            </p>
                        )}
                        {!verifiedAt && searchSnapshotAt && (
                            <p className="text-[10px] text-[#6B7280] mt-1">
                                From recent search on {searchSnapshotAt}
                            </p>
                        )}
                        {flight.flightNumber && (
                            <p className="text-[#6B7280] text-xs mt-1">{flight.flightNumber}</p>
                        )}
                    </div>
                </div>

                {primaryBookingUrl && (
                    <a
                        href={primaryBookingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => onBook(flight)}
                        className="inline-flex items-center justify-center w-full py-2.5 rounded-xl bg-[linear-gradient(135deg,#1D4ED8_0%,#2563EB_100%)] text-white text-sm hover:bg-[#1E40AF] transition-colors no-underline shadow-sm"
                        style={{ fontWeight: 600 }}
                    >
                        Book on Google Flights
                    </a>
                )}

                {/* Route visualization */}
                <div className="bg-[#F8FAFC] rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                        <div className="text-center">
                            <p className="text-[#0A2140] text-lg" style={{ fontWeight: 700 }}>
                                {formatLocationLabel(flight.fromCity, flight.from) || flight.from}
                            </p>
                            <p className="text-[#6B7280] text-xs">{departureMeta || "Departure time pending"}</p>
                        </div>
                        <div className="flex-1 mx-4 text-center">
                            <p className="text-[#6B7280] text-xs mb-1">
                                {flight.stops === 0 ? "Nonstop" : `${flight.stops} stop${flight.stops > 1 ? "s" : ""}`}
                            </p>
                            <div className="flex items-center">
                                <div className="h-px flex-1 bg-[#CBD5E1]" />
                                <Plane className="w-3 h-3 text-[#1D4ED8] mx-1" />
                                <div className="h-px flex-1 bg-[#CBD5E1]" />
                            </div>
                            <p className="text-[#6B7280] text-xs mt-1">{flight.duration}</p>
                            {stopDetails && (
                                <p className="text-[#6B7280] text-[11px] mt-1">Via: {stopDetails}</p>
                            )}
                        </div>
                        <div className="text-center">
                            <p className="text-[#0A2140] text-lg" style={{ fontWeight: 700 }}>
                                {formatLocationLabel(flight.toCity, flight.to) || flight.to}
                            </p>
                            <p className="text-[#6B7280] text-xs">{arrivalMeta || "Arrival time pending"}</p>
                        </div>
                    </div>
                    <div className="flex justify-between text-xs text-[#6B7280] mt-2">
                        <span>{formatLocationLabel(flight.fromCity, flight.from) || flight.from}</span>
                        <span>{formatLocationLabel(flight.toCity, flight.to) || flight.to}</span>
                    </div>

                    {/* Route dots visual */}
                    <div className="flex items-center justify-between mt-3">
                        <div className="w-3 h-3 rounded-full bg-[#1D4ED8]" />
                        <div className="flex-1 mx-2 border-t-2 border-dashed border-[#CBD5E1] relative">
                            <Sparkles className="w-3 h-3 text-[#FCD34D] absolute -top-1.5 right-0" />
                        </div>
                        <div className="w-3 h-3 rounded-full bg-[#1D4ED8]" />
                    </div>
                    <div className="flex justify-between text-[10px] text-[#6B7280] mt-1">
                        <span>{formatLocationLabel(flight.fromCity, flight.from) || flight.from}</span>
                        <span>{formatLocationLabel(flight.toCity, flight.to) || flight.to}</span>
                    </div>
                </div>

                <div
                    className={`rounded-xl border p-4 space-y-3 transition-colors ${
                        error
                            ? "border-red-200 bg-red-50"
                            : confirmedOffer
                              ? "border-green-200 bg-green-50"
                              : "border-[#E5E7EB]"
                    }`}
                >
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <ShieldCheck
                                className={`w-4 h-4 ${
                                    error
                                        ? "text-red-500"
                                        : confirmedOffer
                                          ? "text-green-500"
                                          : "text-[#1D4ED8]"
                                }`}
                            />
                            <p className="text-[#0A2140] text-sm" style={{ fontWeight: 600 }}>
                                Price Verification
                            </p>
                        </div>
                        {verifying && (
                            <div className="flex gap-1">
                                <div className="w-1.5 h-1.5 rounded-full bg-[#1D4ED8] animate-bounce" />
                                <div className="w-1.5 h-1.5 rounded-full bg-[#1D4ED8] animate-bounce [animation-delay:0.2s]" />
                                <div className="w-1.5 h-1.5 rounded-full bg-[#1D4ED8] animate-bounce [animation-delay:0.4s]" />
                            </div>
                        )}
                    </div>

                    {verifying && (
                        <p className="text-[11px] text-[#6B7280]">
                            Verifying live price and availability...
                        </p>
                    )}

                    {error && (
                        <div className="flex items-start gap-2 text-red-600 text-[11px]">
                            <AlertCircle className="w-3 h-3 mt-0.5" />
                            <p>
                                {error}
                                {" "}The search price remains an estimate until a live provider confirms it.
                            </p>
                        </div>
                    )}

                    <div className="space-y-2 text-xs">
                        <div className="flex items-center justify-between">
                            <span className="text-[#6B7280]">
                                {flight.pricingKind === "live_search" ? "Live search price" : "Search price"}
                            </span>
                            <span className="text-[#0A2140] font-medium">
                                {formatPrice(searchPrice, searchCurrency)}
                            </span>
                        </div>
                        <p className="text-[10px] text-[#6B7280]">
                            {flight.pricingKind === "live_search"
                                ? "Pulled from the latest live flight search results."
                                : "Pulled from a recent flight search snapshot."}
                            {searchSnapshotAt ? ` Last checked on ${searchSnapshotAt}.` : ""}
                        </p>
                    </div>

                    {confirmedOffer && (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-green-700 font-medium">Live verified price</span>
                                <span className="text-[#0A2140] font-bold">
                                    {verifiedTotal != null
                                        ? formatPrice(verifiedTotal, displayCurrency)
                                        : "Price unavailable"}
                                </span>
                            </div>
                            {verifiedTotal != null && (
                                <p className="text-[10px] text-[#0A2140]">
                                    {getVerificationDeltaLabel(searchPrice, verifiedTotal, displayCurrency)}
                                </p>
                            )}
                            <div className="flex items-center gap-2 text-[10px] text-green-600">
                                <Check className="w-3 h-3" />
                                <span>
                                    Seats available and price confirmed by a live provider
                                    {verifiedAt ? ` on ${verifiedAt}` : ""}
                                </span>
                            </div>
                        </div>
                    )}

                    {!verifying && !confirmedOffer && !error && (
                        <p className="text-[11px] text-[#6B7280]">
                            Search prices can still move because of seat inventory, taxes, and provider checkout differences.
                        </p>
                    )}
                </div>

                {seatmaps && seatmaps.length > 0 && (
                    <div className="rounded-xl border border-[#E5E7EB] p-4 bg-white">
                        <div className="flex items-center gap-2 mb-3">
                            <Layout className="w-4 h-4 text-[#1D4ED8]" />
                            <p className="text-[#0A2140] text-sm" style={{ fontWeight: 600 }}>
                                Seat Map Preview
                            </p>
                        </div>
                        <div className="space-y-2">
                            {seatmaps.map((seatmap, index) => (
                                <div
                                    key={index}
                                    className="text-[11px] text-[#374151] border-b border-gray-50 pb-2 last:border-0"
                                >
                                    <div className="flex justify-between font-medium mb-1">
                                        <span>Deck {seatmap.deck || 1}</span>
                                        <span className="text-[#6B7280]">
                                            {seatmap.aircraftCabinAmenities?.cabinClass || "Economy"}
                                        </span>
                                    </div>
                                    <p className="text-[#94A3B8]">
                                        Seat configuration available. Map display would render here.
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className="rounded-xl border border-[#E5E7EB] p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                        <p className="text-[#0A2140] text-sm" style={{ fontWeight: 600 }}>
                            Operational details
                        </p>
                        {flight.status && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#EFF6FF] text-[#1D4ED8]">
                                {flight.status}
                            </span>
                        )}
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs text-[#374151]">
                        <div>
                            <p className="text-[#6B7280] mb-1">Aircraft</p>
                            <p>{flight.aircraft || "Not available"}</p>
                        </div>
                        <div>
                            <p className="text-[#6B7280] mb-1">Operator</p>
                            <p>{flight.operator || flight.airline}</p>
                        </div>
                        <div>
                            <p className="text-[#6B7280] mb-1">Baggage</p>
                            <p>
                                {flight.baggage?.checked ||
                                    flight.baggage?.cabin ||
                                    flight.baggageText ||
                                    "Check fare rules"}
                            </p>
                        </div>
                        <div>
                            <p className="text-[#6B7280] mb-1">Cabin</p>
                            <p>{flight.cabinClass || "Standard cabin"}</p>
                        </div>
                        <div>
                            <p className="text-[#6B7280] mb-1">Reliability signal</p>
                            <p>
                                {flight.reliabilityScore != null
                                    ? `${flight.reliabilityScore}/10 from latest live status`
                                    : "Pending live status"}
                            </p>
                        </div>
                        <div>
                            <p className="text-[#6B7280] mb-1">Fare type</p>
                            <p>{flight.fareBrand || "Standard fare"}</p>
                        </div>
                    </div>
                    {(getStopLabels(flight).length > 0 || (flight.stopCities && flight.stopCities.length > 0)) && (
                        <div>
                            <p className="text-[#6B7280] text-xs mb-1">Stops</p>
                            <p className="text-xs text-[#374151]">
                                {getStopLabels(flight).join(", ") || flight.stopCities.join(", ")}
                            </p>
                        </div>
                    )}
                </div>

                <div className="rounded-xl border border-[#E5E7EB] p-4 space-y-3">
                    <p className="text-[#0A2140] text-sm" style={{ fontWeight: 600 }}>
                        Fare and inclusions
                    </p>
                    <div className="grid grid-cols-2 gap-3 text-xs text-[#374151]">
                        <div>
                            <p className="text-[#6B7280] mb-1">Refund policy</p>
                            <p>
                                {flight.refundable == null
                                    ? "Check fare rules"
                                    : flight.refundable
                                        ? "Refundable fare"
                                        : "Non-refundable fare"}
                            </p>
                        </div>
                        <div>
                            <p className="text-[#6B7280] mb-1">Change policy</p>
                            <p>{flight.changePenalty || "Carrier policy applies"}</p>
                        </div>
                        <div className="col-span-2">
                            <p className="text-[#6B7280] mb-1">Onboard services</p>
                            <p>{mealSummary || "Meal and service details are limited for this fare."}</p>
                        </div>
                    </div>
                </div>

                {flight.segments && flight.segments.length > 0 && (
                    <div className="rounded-xl border border-[#E5E7EB] p-4 space-y-3">
                        <p className="text-[#0A2140] text-sm" style={{ fontWeight: 600 }}>
                            Journey details
                        </p>
                        <div className="space-y-3">
                            {flight.segments.map((segment, segmentIndex) => (
                                <div key={`${segment.flightNumber || "SEG"}-${segmentIndex}`} className="rounded-lg bg-[#F8FAFC] border border-[#E5E7EB] p-3">
                                    <div className="flex items-center justify-between gap-2 text-xs">
                                        <p className="text-[#0A2140]" style={{ fontWeight: 600 }}>
                                            {segment.marketingCarrier || flight.airline}
                                            {segment.flightNumber ? ` ${segment.flightNumber}` : ""}
                                        </p>
                                        <p className="text-[#6B7280]">
                                            {segment.aircraft || "Aircraft not listed"}
                                        </p>
                                    </div>
                                    <p className="text-[11px] text-[#374151] mt-1">
                                        {formatLocationLabel(segment.originCity, segment.originIata) || segment.originIata || flight.from}
                                        {" -> "}
                                        {formatLocationLabel(segment.destinationCity, segment.destinationIata) || segment.destinationIata || flight.to}
                                    </p>
                                    <p className="text-[11px] text-[#6B7280] mt-1">
                                        Departure: {formatAbsoluteDateTime(segment.departureAt) || segment.departureAt || "Time unavailable"}
                                    </p>
                                    <p className="text-[11px] text-[#6B7280]">
                                        Arrival: {formatAbsoluteDateTime(segment.arrivalAt) || segment.arrivalAt || "Time unavailable"}
                                    </p>
                                    {(segment.terminalDeparture || segment.terminalArrival) && (
                                        <p className="text-[11px] text-[#6B7280] mt-1">
                                            {segment.terminalDeparture ? `Terminal ${segment.terminalDeparture}` : "Terminal TBD"}
                                            {" -> "}
                                            {segment.terminalArrival ? `Terminal ${segment.terminalArrival}` : "Terminal TBD"}
                                        </p>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {(flight.whyChoose?.length || flight.cons?.length) && (
                    <div className="rounded-xl border border-[#E5E7EB] p-4 space-y-4">
                        {flight.whyChoose && flight.whyChoose.length > 0 && (
                            <div>
                                <p className="text-[#0A2140] text-sm mb-2" style={{ fontWeight: 600 }}>
                                    Why it ranks well
                                </p>
                                <div className="space-y-2">
                                    {flight.whyChoose.map((reason, index) => (
                                        <div key={index} className="flex items-start gap-2 text-xs text-[#374151]">
                                            <CheckCircle2 className="w-3.5 h-3.5 text-[#059669] mt-0.5" />
                                            <span>{reason}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {flight.cons && flight.cons.length > 0 && (
                            <div>
                                <p className="text-[#0A2140] text-sm mb-2" style={{ fontWeight: 600 }}>
                                    Trade-offs
                                </p>
                                <div className="space-y-2">
                                    {flight.cons.map((reason, index) => (
                                        <div key={index} className="flex items-start gap-2 text-xs text-[#374151]">
                                            <AlertCircle className="w-3.5 h-3.5 text-[#D97706] mt-0.5" />
                                            <span>{reason}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {(flight.convenience?.distanceKm != null ||
                    flight.convenience?.travelMinutes != null ||
                    flight.comparison?.marketPosition ||
                    flight.comparison?.providerQuotes) && (
                    <div className="rounded-xl border border-[#E5E7EB] p-4 space-y-3">
                        <p className="text-[#0A2140] text-sm" style={{ fontWeight: 600 }}>
                            Ranking inputs
                        </p>
                        {(flight.convenience?.distanceKm != null || flight.convenience?.travelMinutes != null) && (
                            <div className="text-xs text-[#374151]">
                                <p className="text-[#6B7280] mb-1">Airport convenience</p>
                                <p>
                                    {flight.convenience?.airportName || flight.from}:
                                    {" "}
                                    {flight.convenience?.distanceKm != null
                                        ? `${flight.convenience.distanceKm} km`
                                        : "Distance unavailable"}
                                    {flight.convenience?.travelMinutes != null
                                        ? `, about ${flight.convenience.travelMinutes} min`
                                        : ""}
                                </p>
                            </div>
                        )}
                        {flight.comparison?.marketPosition && (
                            <div className="text-xs text-[#374151]">
                                <p className="text-[#6B7280] mb-1">Price comparison</p>
                                <p className="capitalize">
                                    {flight.comparison.marketPosition.replace("_", " ")}
                                    {flight.comparison.priceGapFromCheapest != null &&
                                        flight.comparison.priceGapFromCheapest > 0
                                        ? `, ${formatPrice(Math.round(flight.comparison.priceGapFromCheapest), flight.currency)} above the cheapest option`
                                        : ", best price in this set"}
                                </p>
                            </div>
                        )}
                        {providerQuoteMin != null && providerQuoteMax != null && (
                                <div className="text-xs text-[#374151]">
                                    <p className="text-[#6B7280] mb-1">Market quote range</p>
                                    <p>
                                        {formatPrice(providerQuoteMin, flight.currency)}
                                        {" to "}
                                        {formatPrice(providerQuoteMax, flight.currency)}
                                    </p>
                                </div>
                            )}
                    </div>
                )}
            </div>
        </div>
    );
}

/* ━━━━━━━━━━━━━━━━━━━━ ChatInput ━━━━━━━━━━━━━━━━━━━━ */

function ChatInput({
    value, onChange, onSend, disabled
}: {
    value: string; onChange: (v: string) => void; onSend: () => void; disabled?: boolean;
}) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
            textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
        }
    }, [value]);

    useEffect(() => { textareaRef.current?.focus(); }, []);

    useEffect(() => {
        if (!disabled) {
            textareaRef.current?.focus();
        }
    }, [disabled]);

    return (
        <div className="bg-white border border-[#E5E7EB] rounded-3xl shadow-sm px-3 py-1.5 sm:px-4 sm:py-2 flex items-end gap-2 focus-within:border-[#1D4ED8] focus-within:ring-2 focus-within:ring-[#1D4ED8]/20 transition-all">
            <textarea
                ref={textareaRef}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } }}
                placeholder="Message Book With AI..."
                disabled={disabled}
                rows={1}
                className="flex-1 resize-none bg-transparent py-2 sm:py-3 text-sm sm:text-base text-[#374151] placeholder:text-[#9CA3AF] focus:outline-none max-h-32 overflow-y-auto"
            />
            <button
                onClick={onSend}
                disabled={!value.trim() || disabled}
                className="flex-shrink-0 w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-[#1D4ED8] flex items-center justify-center text-white hover:bg-[#1E40AF] disabled:opacity-40 disabled:cursor-not-allowed transition-all border-none cursor-pointer"
            >
                <Send className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
        </div>
    );
}

/* ━━━━━━━━━━━━━━━━━━━━ Flight detail mapping ━━━━━━━━━━━━━━━━━━━━ */

function buildFlightDetail(f: TinyFlight, fromCity: string, toCity: string): FlightDetail {
    return {
        ...f,
        fromCity: f.fromCity || fromCity,
        toCity: f.toCity || toCity,
        baggage: {
            cabin: f.baggageCabin || null,
            checked: f.baggageChecked || f.baggageText || null,
        },
        aircraft: f.aircraft,
    };
}

function extractTimeHHMM(value: unknown): string | null {
    const s = typeof value === "string" ? value : null;
    if (!s) return null;
    // Prefer ISO timestamps like 2026-04-04T07:05:00Z
    const isoMatch = s.match(/T(\d{2}:\d{2})/);
    if (isoMatch?.[1]) return isoMatch[1];
    // Fallback to plain HH:MM
    const hhmmMatch = s.match(/\b(\d{2}:\d{2})\b/);
    return hhmmMatch?.[1] ?? null;
}

function applyVerifiedPriceToFlight(
    flight: TinyFlight,
    verifiedPrice: number,
    verifiedCurrency: string,
    verificationMeta: PriceVerificationMeta | null,
): TinyFlight {
    return {
        ...flight,
        price: verifiedPrice,
        currency: verifiedCurrency,
        searchPrice: flight.searchPrice ?? flight.price,
        searchCurrency: flight.searchCurrency || flight.currency || verifiedCurrency,
        verifiedPrice,
        verifiedCurrency,
        verifiedAt: verificationMeta?.verified_at || flight.verifiedAt,
        verificationSource: verificationMeta?.source || flight.verificationSource,
        pricingSource: flight.pricingSource,
        pricingKind: flight.pricingKind,
    };
}

/* ━━━━━━━━━━━━━━━━━━━━ MAIN ChatClient ━━━━━━━━━━━━━━━━━━━━ */

export default function ChatClient({ initialQuery }: { initialQuery: string }) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [messages, setMessages] = useState<ChatUiMessage[]>([]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [showTypingIndicator, setShowTypingIndicator] = useState(false);
    const [activeStreamingMessageId, setActiveStreamingMessageId] = useState<string | null>(null);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [hasStartedChat, setHasStartedChat] = useState(false);
    const [chatHistory, setChatHistory] = useState<Array<{ id: string; title: string; time: string }>>([]);
    const [selectedFlight, setSelectedFlight] = useState<FlightDetail | null>(null);
    const [isPanelOpen, setIsPanelOpen] = useState(false);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [userLocation, setUserLocation] = useState<{ lat: number; lng: number; city?: string } | null>(null);
    const [verifyingPrice, setVerifyingPrice] = useState(false);
    const [verificationError, setVerificationError] = useState<string | null>(null);
    const [seatmapData, setSeatmapData] = useState<
        Array<{
            deck?: number;
            aircraftCabinAmenities?: {
                cabinClass?: string;
            };
        }> | null
    >(null);
    const [confirmedOffer, setConfirmedOffer] = useState<{
        price?: {
            currency?: string;
            grandTotal?: string;
        };
    } | null>(null);
    const [verificationMeta, setVerificationMeta] = useState<PriceVerificationMeta | null>(null);
    const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);
    const [editingChatId, setEditingChatId] = useState<string | null>(null);
    const [editingChatTitle, setEditingChatTitle] = useState("");
    const [expandedFlightCounts, setExpandedFlightCounts] = useState<Record<string, number>>({});
    const [reportingMessageKey, setReportingMessageKey] = useState<string | null>(null);
    const [guestChatCount, setGuestChatCount] = useState(0);
    const [isGuestLimitModalOpen, setIsGuestLimitModalOpen] = useState(false);
    const [hasDismissedGuestLimitPrompt, setHasDismissedGuestLimitPrompt] = useState(false);
    const [isGuestAuthSyncReady, setIsGuestAuthSyncReady] = useState(true);
    const [deletingChatIds, setDeletingChatIds] = useState<Set<string>>(new Set());
    const chatEndRef = useRef<HTMLDivElement | null>(null);
    const copiedMessageTimeoutRef = useRef<number | null>(null);
    const delayedFlightSuggestionTimeoutRef = useRef<number | null>(null);
    const titleGenerationInFlightRef = useRef<Set<string>>(new Set());
    const pendingUrlSessionIdRef = useRef<string | typeof CLEAR_SESSION_URL | null>(null);
    const backendSessionsRef = useRef<StoredSessionListItem[]>([]);
    const didHydrateSessionRef = useRef(false);
    const startedRef = useRef(false);
    const guestAuthSyncStartedRef = useRef(false);

    const { user: clerkUser, isLoaded: isUserLoaded, isSignedIn } = useUser();
    const [displayName, setDisplayName] = useState("User");
    const email = clerkUser?.emailAddresses[0]?.emailAddress || null;
    const resolvedDisplayName = displayName || getPreferredName(clerkUser?.firstName || clerkUser?.fullName, email);
    const currentChatPath = pathname || "/chat";
    const currentChatQuery = searchParams.toString();
    const currentChatRedirectUrl = currentChatQuery
        ? `${currentChatPath}?${currentChatQuery}`
        : currentChatPath;
    const hasReachedGuestChatLimit = !isSignedIn && guestChatCount >= GUEST_CHAT_LIMIT;
    const showDismissedGuestLimitNotice = !isSignedIn && hasReachedGuestChatLimit && hasDismissedGuestLimitPrompt;

    /** lg (1024px)+: feedback FAB bottom-right; smaller screens/tablet: bottom-left (clears composer). */
    const [isLgViewport, setIsLgViewport] = useState(false);
    useEffect(() => {
        const mq = window.matchMedia("(min-width: 1024px)");
        const sync = () => setIsLgViewport(mq.matches);
        sync();
        mq.addEventListener("change", sync);
        return () => mq.removeEventListener("change", sync);
    }, []);

    const openGuestLimitModal = () => {
        setIsGuestLimitModalOpen(true);
        setIsMobileMenuOpen(false);
    };

    const dismissGuestLimitModal = () => {
        setIsGuestLimitModalOpen(false);
        setHasDismissedGuestLimitPrompt(true);
        writeStoredBoolean(GUEST_CHAT_LIMIT_DISMISSED_KEY, true);
    };

    const markGuestLimitReached = () => {
        setHasDismissedGuestLimitPrompt(false);
        writeStoredBoolean(GUEST_CHAT_LIMIT_DISMISSED_KEY, false);
        openGuestLimitModal();
    };

    const handleBlockedGuestMessageAttempt = () => {
        if (!hasDismissedGuestLimitPrompt) {
            openGuestLimitModal();
        }
    };

    // Resolve Clerk identity to internal DB user ID + display name
    useEffect(() => {
        if (!isSignedIn || !clerkUser) {
            setDisplayName("User");
            return;
        }
        const email = clerkUser.emailAddresses[0]?.emailAddress;
        const fallbackName = getPreferredName(clerkUser.firstName || clerkUser.fullName, email);
        setDisplayName(fallbackName);
        if (!email) return;
        (async () => {
            try {
                const res = await fetch(`/api/user/profile-by-email?email=${encodeURIComponent(email)}`);
                if (!res.ok) return;
                const data = await res.json();
                if (data.id) {
                    setDisplayName(
                      getPreferredName(
                        `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim(),
                        email
                      )
                    );
                }
            } catch {
                // ignore
            }
        })();
    }, [isSignedIn, clerkUser]);

    /* ── Request browser geolocation on mount ── */
    useEffect(() => {
        if (typeof navigator !== "undefined" && navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
                },
                () => { /* user denied or error — leave null, AI will ask manually */ },
                { enableHighAccuracy: false, timeout: 8000 }
            );
        }
    }, []);

    const [travelTip, setTravelTip] = useState(FALLBACK_TRAVEL_TIP);
    const [pendingBookedFlight, setPendingBookedFlight] = useState<TinyFlight | null>(null);
    const rotateTipInstantly = () => {
        setTravelTip((previous) => {
            const candidates = CLIENT_TRAVEL_TIPS.filter((tip) => tip !== previous);
            if (candidates.length === 0) {
                return previous;
            }
            return candidates[Math.floor(Math.random() * candidates.length)];
        });
    };
    const TipIcon = Lightbulb;
    const getFlightBatchKey = (message: ChatUiMessage, index: number) => message.localId || `flight-batch-${index}`;
    const revealMoreFlights = (messageKey: string, baseVisibleCount: number, totalCount: number) => {
        setExpandedFlightCounts((current) => ({
            ...current,
            [messageKey]: Math.min((current[messageKey] ?? baseVisibleCount) + FLIGHT_BATCH_SIZE, totalCount),
        }));
    };

    useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

    // Refresh travel tip whenever pre-chat screen is visible:
    // initial load, browser refresh, new chat, and every 5 minutes.
    useEffect(() => {
        if (hasStartedChat) return;

        // Immediate local change so users do not wait for API response.
        rotateTipInstantly();

        const fetchLatestTip = async () => {
            try {
                const response = await fetch(`/api/tip?t=${Date.now()}`, {
                    cache: "no-store",
                });
                if (!response.ok) return;

                const data = await response.json() as { tip?: string };
                const nextTip = data.tip?.trim();
                if (nextTip) {
                    setTravelTip(nextTip);
                }
            } catch {
                // Keep fallback tip when the fresh tip endpoint is unavailable.
            }
        };

        void fetchLatestTip();
        const intervalId = window.setInterval(() => {
            rotateTipInstantly();
            void fetchLatestTip();
        }, 300000);

        return () => {
            window.clearInterval(intervalId);
        };
    }, [hasStartedChat, sessionId, isSignedIn]);

    useEffect(() => {
        return () => {
            if (copiedMessageTimeoutRef.current !== null) {
                window.clearTimeout(copiedMessageTimeoutRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (isSignedIn) {
            setIsGuestLimitModalOpen(false);
        }
    }, [isSignedIn]);

    useEffect(() => {
        setHasDismissedGuestLimitPrompt(readStoredBoolean(GUEST_CHAT_LIMIT_DISMISSED_KEY));
    }, []);

    useEffect(() => {
        setPendingBookedFlight(readPendingBookedFlight());
    }, []);

    const refreshCachedHistory = () => {
        const cachedChats = readCachedChats();
        setChatHistory(
            isSignedIn
                ? mapStoredSessionsToHistory(backendSessionsRef.current)
                : mapChatsToHistory(cachedChats),
        );
        setGuestChatCount(readGuestChatCount());
    };

    const resetGuestLimitTracking = () => {
        writeGuestChatCount(0);
        setGuestChatCount(0);
        writeStoredBoolean(GUEST_CHAT_LIMIT_DISMISSED_KEY, false);
        setHasDismissedGuestLimitPrompt(false);
        setIsGuestLimitModalOpen(false);
        writeGuestAuthAction(null);
    };

    const clearGuestCachedChats = () => {
        writeCachedChats([]);
        setChatHistory(
            isSignedIn
                ? mapStoredSessionsToHistory(backendSessionsRef.current)
                : [],
        );
    };

    const buildChatUrl = (nextSessionId: string | null) => {
        const nextParams = new URLSearchParams(searchParams.toString());
        nextParams.delete("q");
        nextParams.delete("fresh");
        if (nextSessionId) {
            nextParams.set("session", nextSessionId);
        } else {
            nextParams.delete("session");
        }

        const query = nextParams.toString();
        return query ? `${pathname}?${query}` : pathname;
    };

    const syncSessionUrl = (nextSessionId: string | null) => {
        const currentQuery = searchParams.toString();
        const currentUrl = currentQuery ? `${pathname}?${currentQuery}` : pathname;
        const nextUrl = buildChatUrl(nextSessionId);
        if (nextUrl === currentUrl) {
            pendingUrlSessionIdRef.current = null;
            return;
        }

        pendingUrlSessionIdRef.current = nextSessionId ?? CLEAR_SESSION_URL;
        router.replace(nextUrl, { scroll: false });
    };

    const upsertCachedConversation = (conversation: CachedConversation) => {
        const nextChats = [
            conversation,
            ...readCachedChats().filter((chat) => chat.id !== conversation.id),
        ].slice(0, 20);

        writeCachedChats(nextChats);
        if (isSignedIn) {
            void loadBackendChatHistory();
        } else {
            setChatHistory(mapChatsToHistory(nextChats));
        }
        setGuestChatCount(readGuestChatCount());
    };

    const persistConversation = (chatId: string, nextMessages: ChatUiMessage[]) => {
        if (!nextMessages.length) {
            refreshCachedHistory();
            return;
        }

        const existingConversation = readCachedChats().find((chat) => chat.id === chatId);

        const nextConversation: CachedConversation = {
            id: chatId,
            title:
                existingConversation?.isTitleManuallySet || existingConversation?.isTitleAiGenerated
                    ? existingConversation.title
                    : buildChatTitle(nextMessages),
            updatedAt: new Date().toISOString(),
            messages: nextMessages,
            isTitleManuallySet: existingConversation?.isTitleManuallySet ?? false,
            isTitleAiGenerated: existingConversation?.isTitleAiGenerated ?? false,
        };

        upsertCachedConversation(nextConversation);
    };

    const maybeGenerateAiTitle = async (chatId: string, nextMessages: ChatUiMessage[]) => {
        if (!nextMessages.some((message) => (
            message.role === "assistant" && message.content.trim()
        ))) {
            return;
        }

        const cachedConversation = readCachedChats().find((chat) => chat.id === chatId);
        if (
            !cachedConversation
            || cachedConversation.isTitleManuallySet
            || cachedConversation.isTitleAiGenerated
            || titleGenerationInFlightRef.current.has(chatId)
        ) {
            return;
        }

        titleGenerationInFlightRef.current.add(chatId);

        try {
            const generatedTitle = await requestAiChatTitle(nextMessages);
            if (!generatedTitle) {
                return;
            }

            const cachedChats = readCachedChats();
            const currentConversation = cachedChats.find((chat) => chat.id === chatId);
            if (!currentConversation || currentConversation.isTitleManuallySet) {
                return;
            }

            const nextChats = cachedChats.map((chat) => (
                chat.id === chatId
                    ? {
                        ...chat,
                        title: generatedTitle,
                        isTitleAiGenerated: true,
                    }
                    : chat
            ));

            writeCachedChats(nextChats);
            if (isSignedIn) {
                void loadBackendChatHistory();
            } else {
                setChatHistory(mapChatsToHistory(nextChats));
            }
        } finally {
            titleGenerationInFlightRef.current.delete(chatId);
        }
    };

    const updateVerifiedPriceInConversation = (
        flightId: string,
        verifiedPrice: number,
        verifiedCurrency: string,
        verification: PriceVerificationMeta | null,
    ) => {
        const nextMessages = messages.map((message) => {
            const updateFlightList = (list?: TinyFlight[]) => (
                list?.map((candidate) => (
                    candidate.id === flightId
                        ? applyVerifiedPriceToFlight(candidate, verifiedPrice, verifiedCurrency, verification)
                        : candidate
                ))
            );

            if (!message.flights?.length && !message.allFlights?.length) return message;

            return {
                ...message,
                flights: updateFlightList(message.flights),
                allFlights: updateFlightList(message.allFlights),
            };
        });

        setMessages(nextMessages);
        if (sessionId) {
            persistConversation(sessionId, nextMessages);
        }
        setSelectedFlight((current) => (
            current && current.id === flightId
                ? buildFlightDetail(
                    applyVerifiedPriceToFlight(current, verifiedPrice, verifiedCurrency, verification),
                    current.fromCity || current.from,
                    current.toCity || current.to,
                )
                : current
        ));
    };

    const applyConversationState = (
        conversation: CachedConversation,
        options: { skipUrlSync?: boolean } = {},
    ) => {
        setSessionId(conversation.id);
        try {
            sessionStorage.setItem(SESSION_STORAGE_KEY, conversation.id);
        } catch {}
        setHasStartedChat(conversation.messages.length > 0);
        setMessages(conversation.messages);
        setSelectedFlight(null);
        setIsPanelOpen(false);
        setEditingChatId(null);
        setEditingChatTitle("");
        setExpandedFlightCounts({});
        if (!options.skipUrlSync) {
            syncSessionUrl(conversation.id);
        }
    };

    const createBackendSession = async (): Promise<string | null> => {
        if (!isSignedIn) {
            return null;
        }

        try {
            const response = await fetch("/api/sessions", {
                method: "POST",
            });
            if (!response.ok) {
                return null;
            }

            const data = await response.json() as { session_id?: string };
            return data.session_id ?? null;
        } catch {
            return null;
        }
    };

    const loadBackendChatHistory = async (): Promise<StoredSessionListItem[]> => {
        if (!isSignedIn) {
            return [];
        }

        try {
            const response = await fetch("/api/sessions?limit=100");
            if (!response.ok) {
                return [];
            }

            const data = await response.json() as { sessions?: StoredSessionListItem[] };
            const sessions = Array.isArray(data.sessions) ? data.sessions : [];
            backendSessionsRef.current = sessions;
            setChatHistory(mapStoredSessionsToHistory(sessions));
            return sessions;
        } catch {
            return [];
        }
    };

    const importGuestChatsToDb = async (conversations: CachedConversation[]) => {
        if (!conversations.length) {
            return;
        }

        const response = await fetch("/api/sessions/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                sessions: conversations.map(serializeConversationForImport),
            }),
        });

        if (!response.ok) {
            const errorPayload = await response.json().catch(() => null) as { detail?: string } | null;
            throw new Error(errorPayload?.detail || "Unable to sync guest chats right now.");
        }
    };

    const loadChat = async (
        chatId: string,
        options: { skipUrlSync?: boolean } = {},
    ): Promise<boolean> => {
        const cachedChat = readCachedChats().find((chat) => chat.id === chatId);
        if (cachedChat) {
            applyConversationState(cachedChat, options);
            return true;
        }

        if (!isSignedIn) {
            return false;
        }

        try {
            const response = await fetch(`/api/sessions/${encodeURIComponent(chatId)}`);
            if (!response.ok) {
                return false;
            }

            const storedSession = await response.json() as StoredSessionResponse;
            const existingConversation = readCachedChats().find((chat) => chat.id === chatId);
            const nextMessages = storedSession.messages.map(mapStoredSessionMessageToUiMessage);
            const hydratedConversation: CachedConversation = {
                id: storedSession.id,
                title:
                    existingConversation?.isTitleManuallySet || existingConversation?.isTitleAiGenerated
                        ? existingConversation.title
                        : storedSession.title?.trim() || existingConversation?.title || buildChatTitle(nextMessages),
                updatedAt: storedSession.updated_at || existingConversation?.updatedAt || new Date().toISOString(),
                messages: nextMessages,
                isTitleManuallySet: existingConversation?.isTitleManuallySet ?? false,
                isTitleAiGenerated: existingConversation?.isTitleAiGenerated ?? false,
            };

            upsertCachedConversation(hydratedConversation);
            applyConversationState(hydratedConversation, options);
            return true;
        } catch {
            return false;
        }
    };

    /* ── Start a brand-new chat ── */
    const startNewChat = (options: { skipUrlSync?: boolean } = {}) => {
        rotateTipInstantly();
        setSessionId(null);
        try {
            sessionStorage.removeItem(SESSION_STORAGE_KEY);
        } catch {}
        setMessages([]);
        setExpandedFlightCounts({});
        setHasStartedChat(false);
        setIsPanelOpen(false);
        setSelectedFlight(null);
        setEditingChatId(null);
        setEditingChatTitle("");
        setIsMobileMenuOpen(false);
        if (!options.skipUrlSync) {
            syncSessionUrl(null);
        }
    };

    useEffect(() => {
        if (!isUserLoaded) {
            return;
        }

        if (!isSignedIn) {
            backendSessionsRef.current = [];
            guestAuthSyncStartedRef.current = false;
            setIsGuestAuthSyncReady(true);
            return;
        }

        const guestAuthAction = readGuestAuthAction();
        if (!guestAuthAction) {
            setIsGuestAuthSyncReady(true);
            return;
        }

        if (guestAuthSyncStartedRef.current) {
            return;
        }

        guestAuthSyncStartedRef.current = true;
        setIsGuestAuthSyncReady(false);

        void (async () => {
            try {
                if (guestAuthAction === "sign_up") {
                    await importGuestChatsToDb(readCachedChats());
                    // Imported sessions can be re-keyed server-side (UUID collision / invalid local ids).
                    // Reset local guest cache + active session so we don't keep stale session ids that 404.
                    clearGuestCachedChats();
                    startNewChat({ skipUrlSync: true });
                    syncSessionUrl(null);
                    await loadBackendChatHistory();
                } else {
                    clearGuestCachedChats();
                    startNewChat({ skipUrlSync: true });
                    syncSessionUrl(null);
                    await loadBackendChatHistory();
                }
            } catch (error) {
                toast.error(
                    guestAuthAction === "sign_up"
                        ? error instanceof Error
                            ? error.message
                            : "We could not sync your guest chats yet."
                        : "We could not clear the guest chat cache cleanly.",
                );
            } finally {
                resetGuestLimitTracking();
                writeGuestAuthAction(null);
                setIsGuestAuthSyncReady(true);
            }
        })();
    }, [isSignedIn, isUserLoaded]);

    const verifyFlight = async (flight: TinyFlight) => {
        // Price verification + seat map require a provider offer.
        // FlightAware operational lookup should still work even when rawOffer is missing,
        // so the "Operational details" panel can always show status/operator.
        if (!flight.rawOffer) {
            setVerificationMeta(null);
            setVerificationError("Live verification is currently available only for supported provider offers.");
        }

        setVerifyingPrice(true);
        setVerificationError(null);
        setSeatmapData(null);
        setConfirmedOffer(null);
        setVerificationMeta(null);

        try {
            if (flight.rawOffer) {
                const priceRes = await fetch("/api/flights/confirm-price", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ offer: flight.rawOffer }),
                });
                if (!priceRes.ok) {
                    const err = await priceRes.json();
                    throw new Error(err.detail || "Price verification failed");
                }
                const priceData = await priceRes.json();
                setConfirmedOffer(priceData.confirmed_offer);
                setVerificationMeta(priceData.verification || null);
                const verifiedPrice = getVerifiedTotal(priceData.confirmed_offer);
                const verifiedCurrency = (
                    priceData.confirmed_offer?.price?.currency
                    || flight.verifiedCurrency
                    || flight.currency
                    || "USD"
                ).toUpperCase();
                if (verifiedPrice != null) {
                    updateVerifiedPriceInConversation(
                        flight.id,
                        verifiedPrice,
                        verifiedCurrency,
                        priceData.verification || null,
                    );
                }

                const seatRes = await fetch("/api/flights/seatmap", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ offer: flight.rawOffer }),
                });
                if (seatRes.ok) {
                    const seatData = await seatRes.json();
                    setSeatmapData(seatData.seatmaps);
                }
            }

            // Fetch operational details (FlightAware) for richer "Operational details" panel.
            if (flight.flightNumber) {
                try {
                    const departureDateForVerify = (() => {
                        const departureAtIso = String(flight.departureAt || "").match(/^\d{4}-\d{2}-\d{2}/)?.[0];
                        if (departureAtIso) return departureAtIso;

                        const departureDateIso = String(flight.departureDate || "").match(/^\d{4}-\d{2}-\d{2}/)?.[0];
                        if (departureDateIso) return departureDateIso;

                        if (!flight.departureDate) return undefined;
                        const parsed = new Date(flight.departureDate);
                        if (Number.isNaN(parsed.getTime())) return undefined;
                        return parsed.toISOString().slice(0, 10);
                    })();

                    const verifyParams = new URLSearchParams({
                        flight_number: flight.flightNumber,
                    });
                    if (flight.from) {
                        verifyParams.set("origin", flight.from);
                    }
                    if (flight.to) {
                        verifyParams.set("destination", flight.to);
                    }
                    if (departureDateForVerify) {
                        verifyParams.set("departure_date", departureDateForVerify);
                    }

                    const statusRes = await fetch(
                        `/api/flights/verify?${verifyParams.toString()}`,
                        { method: "GET" },
                    );
                    if (statusRes.ok) {
                        const details = await statusRes.json() as {
                            found?: boolean;
                            route_match?: boolean;
                            date_match?: boolean;
                            message?: string;
                            origin?: string;
                            destination?: string;
                            status?: string;
                            operator?: string;
                            aircraft_type?: string;
                            actual_out?: string;
                            estimated_out?: string;
                            scheduled_out?: string;
                            actual_in?: string;
                            estimated_in?: string;
                            scheduled_in?: string;
                        };

                        if (details.route_match === false || details.date_match === false) {
                            setVerificationError(
                                details.message
                                || `Live status for ${flight.flightNumber} does not match this route/date.`,
                            );
                            return;
                        }

                        const departSource = details.actual_out || details.estimated_out || details.scheduled_out;
                        const arriveSource = details.actual_in || details.estimated_in || details.scheduled_in;
                        const departTime = extractTimeHHMM(departSource);
                        const arriveTime = extractTimeHHMM(arriveSource);

                        setSelectedFlight((prev) => {
                            if (!prev) return prev;
                            if (prev.id !== flight.id) return prev;
                            return {
                                ...prev,
                                status: details.status || prev.status,
                                operator: details.operator || prev.operator,
                                aircraft: details.aircraft_type || prev.aircraft,
                                departTime: departTime || prev.departTime,
                                arriveTime: arriveTime || prev.arriveTime,
                            };
                        });
                    }
                } catch {
                    // Ignore operational lookup failures; price/seatmap still work.
                }
            }
        } catch (err) {
            setVerificationError(
                err instanceof Error
                    ? err.message
                    : "An error occurred during verification",
            );
        } finally {
            setVerifyingPrice(false);
        }
    };

    const openFlightDetails = (flight: TinyFlight, fromCity?: string, toCity?: string) => {
        setVerificationError(null);
        setSeatmapData(null);
        setConfirmedOffer(null);
        setVerificationMeta(null);
        setSelectedFlight(
            buildFlightDetail(
                flight,
                fromCity || flight.from,
                toCity || flight.to,
            ),
        );
        setIsPanelOpen(true);
        void verifyFlight(flight);
    };

    const findLatestFlightContext = (): { flight: TinyFlight; fromCity?: string; toCity?: string } | null => {
        for (let i = messages.length - 1; i >= 0; i -= 1) {
            const candidate = messages[i];
            if (candidate.role !== "assistant" || !candidate.flights?.length) continue;
            const preferred =
                candidate.flights.find((flight) => flight.badge?.variant === "best")
                || candidate.flights[0];
            if (!preferred) continue;
            return {
                flight: preferred,
                fromCity: candidate.searchMeta?.fromCity,
                toCity: candidate.searchMeta?.toCity,
            };
        }
        return null;
    };

    const buildDelayedFlightSuggestion = (flights: TinyFlight[]): string | null => {
        if (!flights.length) return null;
        const recommended = flights.find((flight) => flight.badge?.variant === "best") || flights[0];
        if (!recommended) return null;
        const reason = (recommended.whyChoose || []).find((item) => item && item.trim().length > 0);
        const price = formatPrice(Math.round(recommended.price || 0), recommended.currency || "USD");
        const legs = `${recommended.from} -> ${recommended.to}`;
        return (
            `Best pick from these options: **${recommended.airline}${recommended.flightNumber ? ` ${recommended.flightNumber}` : ""}** `
            + `(${legs}) at **${price}**. `
            + `${reason ? `Why: ${reason}.` : "It gives the strongest overall balance of price, duration, and convenience."}`
        );
    };

    // Load cached history on mount.
    useEffect(() => {
        refreshCachedHistory();
    }, []);

    useEffect(() => {
        if (!isUserLoaded || !isSignedIn || !isGuestAuthSyncReady) {
            return;
        }

        void loadBackendChatHistory();
    }, [isSignedIn, isUserLoaded, isGuestAuthSyncReady]);

    useEffect(() => {
        if (isSignedIn && !isGuestAuthSyncReady) {
            return;
        }

        const pendingUrlSessionId =
            pendingUrlSessionIdRef.current === CLEAR_SESSION_URL
                ? null
                : pendingUrlSessionIdRef.current;
        const urlSessionId = searchParams.get("session")?.trim() || null;

        if (pendingUrlSessionIdRef.current !== null) {
            if (pendingUrlSessionId === urlSessionId) {
                pendingUrlSessionIdRef.current = null;
            } else {
                return;
            }
        }

        if (!didHydrateSessionRef.current) {
            didHydrateSessionRef.current = true;
            if (searchParams.get("fresh") === "1") {
                startNewChat({ skipUrlSync: true });
                return;
            }
            if (!urlSessionId) {
                const storedSessionId = readStoredSessionId();

                if (storedSessionId) {
                    const storedCachedChat = readCachedChats().find((chat) => chat.id === storedSessionId);
                    if (storedCachedChat) {
                        applyConversationState(storedCachedChat, { skipUrlSync: true });
                    }

                    syncSessionUrl(storedSessionId);
                    return;
                }
            }
        }

        if (!urlSessionId) {
            if (sessionId) {
                startNewChat({ skipUrlSync: true });
            }
            return;
        }

        if (urlSessionId === sessionId && messages.length > 0) {
            return;
        }

        if (!readCachedChats().some((chat) => chat.id === urlSessionId) && !isUserLoaded) {
            return;
        }

        let cancelled = false;
        void (async () => {
            const loaded = await loadChat(urlSessionId, { skipUrlSync: true });
            if (loaded || cancelled) {
                return;
            }

            toast.error("That chat was not found.");
            if (sessionId) {
                syncSessionUrl(sessionId);
            } else {
                syncSessionUrl(null);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [searchParams, sessionId, isSignedIn, isUserLoaded, isGuestAuthSyncReady, messages.length]);

    const sendMessage = async (text?: string) => {
        const t = text || input.trim();
        if (!t || loading) return;

        if (!isSignedIn && guestChatCount >= GUEST_CHAT_LIMIT) {
            handleBlockedGuestMessageAttempt();
            return;
        }

        if (isFlightDetailsFollowUp(t)) {
            const latest = findLatestFlightContext();
            if (latest) {
                openFlightDetails(latest.flight, latest.fromCity, latest.toCity);
                appendAssistantMessage(`Opened details for ${latest.flight.airline} ${latest.flight.flightNumber || ""}.`);
                setInput("");
                return;
            }
        }

        const shouldTrackGuestUsage = !isSignedIn;
        let didReachGuestLimit = false;

        let activeChatId = sessionId;
        if (!activeChatId) {
            activeChatId = await createBackendSession() || createLocalChatId();
            setSessionId(activeChatId);
            try {
                sessionStorage.setItem(SESSION_STORAGE_KEY, activeChatId);
            } catch {}
            syncSessionUrl(activeChatId);
        }

        setInput("");
        if (!hasStartedChat) setHasStartedChat(true);

        const userMessage: ChatUiMessage = { role: "user", content: t };
        const nextMessages = [...messages, userMessage];
        setMessages(nextMessages);
        persistConversation(activeChatId, nextMessages);
        setLoading(true);
        setShowTypingIndicator(true);
        setActiveStreamingMessageId(null);

        try {
            const recentFlightMsg = [...nextMessages].reverse().find(
                (message) => message.role === "assistant" && ((message.allFlights && message.allFlights.length > 0) || (message.flights && message.flights.length > 0)),
            );
            const flightsForContext = recentFlightMsg?.allFlights?.length
                ? recentFlightMsg.allFlights
                : (recentFlightMsg?.flights ?? []);
            const recentFlightsPayload = flightsForContext.map((flight) => ({
                airline: flight.airline,
                flight_number: flight.flightNumber,
                price: flight.verifiedPrice ?? flight.searchPrice ?? flight.price,
                currency: flight.verifiedCurrency ?? flight.searchCurrency ?? flight.currency ?? "USD",
                verifiedPrice: flight.verifiedPrice,
                verifiedCurrency: flight.verifiedCurrency,
                duration: flight.duration,
                stops: flight.stops,
                departure_time: flight.departTime,
                arrival_time: flight.arriveTime,
                from: flight.from,
                to: flight.to,
                hasBag: flight.hasBag,
                hasMeal: flight.hasMeal,
                hasWifi: flight.hasWifi,
                route: {
                    originIata: flight.from,
                    destinationIata: flight.to,
                    originCity: flight.fromCity || flight.from,
                    destinationCity: flight.toCity || flight.to,
                },
                fare: {
                    total: flight.verifiedPrice ?? flight.searchPrice ?? flight.price,
                    currency: flight.verifiedCurrency ?? flight.searchCurrency ?? flight.currency ?? "USD",
                },
                baggage: {
                    included: flight.hasBag,
                    checked: flight.baggageChecked ?? flight.baggageText ?? null,
                    cabin: flight.baggageCabin ?? null,
                },
                meal_services: flight.mealServices,
                perks: [
                    ...(flight.hasMeal ? ["Free meal"] : []),
                    ...(flight.hasWifi ? ["Wi-Fi"] : []),
                ],
                convenience: {
                    airportName: flight.convenience?.airportName ?? null,
                    distanceKm: flight.convenience?.distanceKm ?? null,
                    travelMinutes: flight.convenience?.travelMinutes ?? null,
                },
                pricing: {
                    source: flight.pricingSource,
                    kind: flight.pricingKind,
                    lastCheckedAt: flight.searchCheckedAt,
                },
            }));

            const sendChatRequest = async (chatId: string) => (
                fetch("/api/chat", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Accept: "application/x-ndjson, application/json",
                    },
                    body: JSON.stringify({
                        message: t,
                        session_id: chatId,
                        history: messages.map((m) => ({ role: m.role, content: m.content })),
                        stream: true,
                        recent_flights: recentFlightsPayload,
                        ...(userLocation ? {
                            user_lat: userLocation.lat,
                            user_lng: userLocation.lng,
                            ...(userLocation.city ? { user_city: userLocation.city } : {}),
                        } : {}),
                    }),
                })
            );

            let res = await sendChatRequest(activeChatId);
            if (res.status === 404 && isSignedIn) {
                const errorPayload = await res.json().catch(() => null) as { detail?: string } | null;
                if (errorPayload?.detail === "Session not found") {
                    const replacementSessionId = await createBackendSession();
                    if (replacementSessionId) {
                        activeChatId = replacementSessionId;
                        setSessionId(replacementSessionId);
                        try {
                            sessionStorage.setItem(SESSION_STORAGE_KEY, replacementSessionId);
                        } catch {}
                        syncSessionUrl(replacementSessionId);
                        res = await sendChatRequest(replacementSessionId);
                    } else {
                        const fallbackSessionId = createLocalChatId();
                        activeChatId = fallbackSessionId;
                        setSessionId(fallbackSessionId);
                        try {
                            sessionStorage.setItem(SESSION_STORAGE_KEY, fallbackSessionId);
                        } catch {}
                        syncSessionUrl(fallbackSessionId);
                        res = await sendChatRequest(fallbackSessionId);
                    }
                }
            }

            if (!res.ok) {
                const errorText = await res.text().catch(() => "");
                throw new Error(
                    errorText
                        ? `Chat request failed: ${errorText}`
                        : `Chat request failed with status ${res.status}`,
                );
            }

            const contentType = res.headers.get("content-type") || "";
            let data: ChatApiResponse;
            if (contentType.includes("application/x-ndjson")) {
                const streamingPlaceholderId = createLocalChatId();
                setActiveStreamingMessageId(streamingPlaceholderId);
                setShowTypingIndicator(false);
                setMessages((current) => [
                    ...current,
                    { localId: streamingPlaceholderId, role: "assistant", content: "" },
                ]);

                data = await readStreamedChatResponse(res, (delta) => {
                    setMessages((current) =>
                        current.map((message) =>
                            message.localId === streamingPlaceholderId
                                ? { ...message, content: `${message.content}${delta}` }
                                : message,
                        ),
                    );
                });
            } else {
                data = await res.json() as ChatApiResponse;
            }

            setShowTypingIndicator(false);
            setActiveStreamingMessageId(null);
            const msgObj = mapAssistantResponseToUiMessage(data);
            const resolvedChatId = data.session_id || activeChatId;
            if (resolvedChatId !== sessionId) {
                setSessionId(resolvedChatId);
                try {
                    sessionStorage.setItem(SESSION_STORAGE_KEY, resolvedChatId);
                } catch {}
                syncSessionUrl(resolvedChatId);
            }

            const updatedMessages = [...nextMessages, msgObj];
            setMessages(updatedMessages);
            persistConversation(resolvedChatId, updatedMessages);
            void maybeGenerateAiTitle(resolvedChatId, updatedMessages);

            if (msgObj.flights?.length && !msgObj.recommendationNote) {
                const delayedSuggestion = buildDelayedFlightSuggestion(msgObj.flights);
                if (delayedSuggestion) {
                    if (delayedFlightSuggestionTimeoutRef.current !== null) {
                        window.clearTimeout(delayedFlightSuggestionTimeoutRef.current);
                    }
                    delayedFlightSuggestionTimeoutRef.current = window.setTimeout(() => {
                        setMessages((current) => {
                            const next = [...current, { role: "assistant", content: delayedSuggestion }];
                            persistConversation(resolvedChatId, next);
                            return next;
                        });
                    }, 1000);
                }
            }

            if (shouldTrackGuestUsage) {
                const nextGuestChatCount = Math.min(guestChatCount + 1, GUEST_CHAT_LIMIT);
                setGuestChatCount(nextGuestChatCount);
                writeGuestChatCount(nextGuestChatCount);
                didReachGuestLimit = nextGuestChatCount >= GUEST_CHAT_LIMIT;
            }
        } catch (error) {
            console.error("Chat send failed", error);
            setActiveStreamingMessageId(null);
            setShowTypingIndicator(false);
            setMessages(nextMessages);
            persistConversation(activeChatId, nextMessages);
            const errorMessage = error instanceof Error ? error.message : "";
            const timedOut = /timed out|backend unavailable/i.test(errorMessage);
            toast.error(
                timedOut
                    ? "The assistant is taking longer than usual. Please try again."
                    : "The assistant is temporarily unavailable. Please try again.",
            );
        } finally {
            setActiveStreamingMessageId(null);
            setShowTypingIndicator(false);
            setLoading(false);
        }

        if (didReachGuestLimit) {
            markGuestLimitReached();
        }
    };

    const appendAssistantMessage = (content: string) => {
        setMessages((prev) => [...prev, { localId: createLocalChatId(), role: "assistant", content }]);
    };

    const getReportMessageKey = (message: ChatUiMessage, index: number) => (
        message.localId || `${message.role}-${index}-${message.content.slice(0, 32)}`
    );

    const handleReportMessage = async (message: ChatUiMessage, index: number) => {
        const reportKey = getReportMessageKey(message, index);
        if (reportingMessageKey === reportKey) {
            return;
        }

        const content = message.content.trim();
        const reportToken = (sessionId || message.localId || `${Date.now()}`)
            .replace(/[^a-zA-Z0-9]/g, "")
            .slice(0, 32) || "chat";
        const reportName = isSignedIn ? (resolvedDisplayName || "User") : "Guest User";
        const reportEmail = isSignedIn
            ? (email || `signed-in-${reportToken}@bookwithai.invalid`)
            : `guest-${reportToken}@bookwithai.invalid`;
        const surroundingMessages = messages
            .slice(Math.max(0, index - 3), Math.min(messages.length, index + 2))
            .map((entry, entryIndex) => ({
                role: entry.role,
                content: entry.content,
                relative_index: Math.max(0, index - 3) + entryIndex,
            }));

        setReportingMessageKey(reportKey);

        try {
            const response = await fetch("/api/feedback", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: reportName,
                    email: reportEmail,
                    message: content
                        ? `Reported assistant message: ${content}`
                        : "Reported an assistant message from the chat report button.",
                    chat_session_id: sessionId || undefined,
                    context_flights: {
                        source: "chat_report_button",
                        reported_message: {
                            index,
                            role: message.role,
                            content: message.content,
                            local_id: message.localId || null,
                        },
                        surrounding_messages: surroundingMessages,
                        flights: message.flights?.map(serializeTinyFlightForImport) || [],
                        all_flights: message.allFlights?.map(serializeTinyFlightForImport) || [],
                        recommendation_note: message.recommendationNote || null,
                    },
                    context_page: getPageSnapshot(),
                }),
            });

            if (!response.ok) {
                const payload = await response.json().catch(() => null) as { detail?: string } | null;
                throw new Error(payload?.detail || "Failed to submit report.");
            }

            toast.success("Report saved. Thanks for flagging that response.");
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : "Failed to save that report.",
            );
        } finally {
            setReportingMessageKey(null);
        }
    };

    const buildTripSaveInstructionFromFlight = (flight: TinyFlight): string => {
        const departureHint = flight.departTime ? `departure at ${flight.departTime}` : "departure details pending";
        const destinationLabel = flight.toCity || flight.to;
        const currency = (flight.currency || "USD").toUpperCase();
        return (
            `save this trip to my trips: from ${flight.from} to ${flight.to}, `
            + `destination ${destinationLabel}, airline ${flight.airline}, ${departureHint}, `
            + `price ${currency} ${Math.round(flight.price)}, status confirmed.`
        );
    };

    const buildTrackAlertInstructionFromFlight = (flight: TinyFlight): string => {
        const destinationLabel = flight.toCity || flight.to;
        const airlineLine = flight.airline ? ` for ${flight.airline}` : "";
        return `track price alert and save alert from ${flight.from} to ${flight.to} (${destinationLabel})${airlineLine}`;
    };

    const handleBookIntent = (flight: TinyFlight) => {
        setPendingBookedFlight(flight);
        writePendingBookedFlight(flight);
        writePendingBookingReturn(true);
    };

    useEffect(() => {
        writePendingBookedFlight(pendingBookedFlight);
    }, [pendingBookedFlight]);

    useEffect(() => {
        const maybePromptAfterReturn = () => {
            if (document.visibilityState === "hidden") {
                return;
            }

            if (!readPendingBookingReturn()) {
                return;
            }

            const storedFlight = readPendingBookedFlight();
            if (!storedFlight) {
                writePendingBookingReturn(false);
                return;
            }

            setPendingBookedFlight(storedFlight);
            appendAssistantMessage(
                "Welcome back. Did you book this flight? If yes, I can save the details to My Trips after your consent.",
            );
            writePendingBookingReturn(false);
        };

        const handleVisibilityChange = () => {
            maybePromptAfterReturn();
        };

        window.addEventListener("focus", maybePromptAfterReturn);
        document.addEventListener("visibilitychange", handleVisibilityChange);
        return () => {
            window.removeEventListener("focus", maybePromptAfterReturn);
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        };
    }, []);

    useEffect(() => {
        if (!isUserLoaded || !isGuestAuthSyncReady || searchParams.get("session")) {
            return;
        }

        const q = searchParams.get("q") || initialQuery;
        if (q && !startedRef.current) { startedRef.current = true; setTimeout(() => sendMessage(q), 100); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialQuery, searchParams, isGuestAuthSyncReady, isUserLoaded]);

    useEffect(() => {
        return () => {
            if (copiedMessageTimeoutRef.current !== null) {
                window.clearTimeout(copiedMessageTimeoutRef.current);
            }
            if (delayedFlightSuggestionTimeoutRef.current !== null) {
                window.clearTimeout(delayedFlightSuggestionTimeoutRef.current);
            }
        };
    }, []);

    const handleCopyMessage = async (message: ChatUiMessage, index: number) => {
        const copyTarget = message.content?.trim();
        if (!copyTarget) {
            toast.error("There is no text to copy in this message.");
            return;
        }

        try {
            const didCopy = await copyTextToClipboard(copyTarget);
            if (!didCopy) {
                throw new Error("Copy failed");
            }

            setCopiedMessageIndex(index);
            if (copiedMessageTimeoutRef.current !== null) {
                window.clearTimeout(copiedMessageTimeoutRef.current);
            }
            copiedMessageTimeoutRef.current = window.setTimeout(() => {
                setCopiedMessageIndex((currentIndex) =>
                    currentIndex === index ? null : currentIndex
                );
            }, 1800);
            toast.success("Message copied.");
        } catch {
            toast.error("Failed to copy the message.");
        }
    };

    const handleRenameChat = (chatId: string) => {
        const cachedChats = readCachedChats();
        const currentChat = cachedChats.find((chat) => chat.id === chatId);
        if (!currentChat) return;

        setEditingChatId(chatId);
        setEditingChatTitle(currentChat.title);
    };

    const finishRenamingChat = (chatId: string) => {
        const cachedChats = readCachedChats();
        const currentChat = cachedChats.find((chat) => chat.id === chatId);
        if (!currentChat) {
            setEditingChatId(null);
            setEditingChatTitle("");
            return;
        }

        const nextTitle = editingChatTitle.trim();
        if (!nextTitle) {
            setEditingChatId(null);
            setEditingChatTitle("");
            return;
        }

        if (nextTitle === currentChat.title) {
            setEditingChatId(null);
            setEditingChatTitle("");
            return;
        }

        const nextChats = cachedChats.map((chat) => (
            chat.id === chatId
                ? {
                    ...chat,
                    title: nextTitle,
                    isTitleManuallySet: true,
                    isTitleAiGenerated: false,
                }
                : chat
        ));

        writeCachedChats(nextChats);
        if (isSignedIn) {
            void loadBackendChatHistory();
        } else {
            setChatHistory(mapChatsToHistory(nextChats));
        }
        setEditingChatId(null);
        setEditingChatTitle("");
        toast.success("Chat renamed.");
    };

    const cancelRenamingChat = () => {
        setEditingChatId(null);
        setEditingChatTitle("");
    };

    const handleDeleteChat = async (chatId: string) => {
        if (deletingChatIds.has(chatId)) {
            return;
        }
        const cachedChats = readCachedChats();
        const currentChat = cachedChats.find((chat) => chat.id === chatId);
        if (!currentChat) return;
        setDeletingChatIds((prev) => new Set(prev).add(chatId));

        const shouldDeleteServerChat = Boolean(isUserLoaded && isSignedIn);
        if (shouldDeleteServerChat) {
            try {
                const response = await fetch(`/api/sessions/${encodeURIComponent(chatId)}`, {
                    method: "DELETE",
                });
                if (!response.ok && response.status !== 401 && response.status !== 404) {
                    toast.error("Unable to delete that chat right now.");
                    setDeletingChatIds((prev) => {
                        const next = new Set(prev);
                        next.delete(chatId);
                        return next;
                    });
                    return;
                }
            } catch {
                toast.error("Unable to delete that chat right now.");
                setDeletingChatIds((prev) => {
                    const next = new Set(prev);
                    next.delete(chatId);
                    return next;
                });
                return;
            }
        }

        const nextChats = cachedChats.filter((chat) => chat.id !== chatId);
        writeCachedChats(nextChats);
        backendSessionsRef.current = backendSessionsRef.current.filter((session) => session.id !== chatId);
        setChatHistory(
            isSignedIn
                ? mapStoredSessionsToHistory(backendSessionsRef.current)
                : mapChatsToHistory(nextChats),
        );

        if (editingChatId === chatId) {
            cancelRenamingChat();
        }

        if (sessionId === chatId) {
            startNewChat();
        }

        setDeletingChatIds((prev) => {
            const next = new Set(prev);
            next.delete(chatId);
            return next;
        });
        toast.success("Chat deleted.");
    };

    return (
        <div className="flex h-[100dvh] bg-white font-sans overflow-x-hidden">

            {/* ━━━ MOBILE OVERLAY DIMMER ━━━ */}
            {isMobileMenuOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-30 md:hidden"
                    onClick={() => setIsMobileMenuOpen(false)}
                />
            )}

            {/* ━━━ LEFT SIDEBAR ━━━ */}
            <div className={`fixed inset-y-0 left-0 w-[260px] bg-white border-r border-[#E5E7EB] flex flex-col flex-shrink-0 z-40 h-full transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0 ${isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"}`}>
                {/* Logo */}
                <Link href="/" className="flex items-center gap-3 px-6 py-6 hover:opacity-90 transition-opacity no-underline">
                    <div className="w-[34px] h-[34px] rounded-[10px] bg-[#1D4ED8] flex items-center justify-center text-white font-bold text-[16px] shadow-sm">
                        B
                    </div>
                    <span className="text-[17px] text-[#0A2140] tracking-tight" style={{ fontWeight: 800 }}>Book With AI</span>
                </Link>

                {/* Nav links */}
                <div className="flex flex-col px-3 gap-0.5 mt-1">
                    {navLinks.map((link) => {
                        const Icon = link.icon;
                        const href = !isSignedIn && guestProtectedChatRoutes.has(link.href)
                            ? getGuestAuthHref(link.href)
                            : link.href;

                        return (
                            <Link
                                key={link.label}
                                href={href}
                                className="flex items-center gap-3.5 px-3 py-[11px] rounded-[12px] text-[#64748B] hover:bg-[#F8FAFC] hover:text-[#0A2140] transition-colors text-[14.5px] no-underline"
                                style={{ fontWeight: 500 }}
                            >
                                <Icon className="w-[18px] h-[18px] text-[#94A3B8]" />
                                {link.label}
                            </Link>
                        );
                    })}
                </div>

                {/* New Chat button */}
                <div className="px-3 mt-4 mb-2">
                    <button
                        onClick={() => startNewChat()}
                        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-[12px] text-[#1D4ED8] bg-[#EFF6FF] hover:bg-[#DBEAFE] transition-colors text-[13.5px] border-none cursor-pointer"
                        style={{ fontWeight: 600 }}
                    >
                        <Plus className="w-4 h-4" />
                        New Chat
                    </button>
                </div>

                <div className="mt-3 px-6 mb-3 flex items-center gap-2 font-bold text-[16px] text-[#0A2140] tracking-wider">
                    <Clock className="w-3.5 h-3.5" />
                    RECENT CHATS
                </div>
                <div className="flex flex-col flex-1 overflow-y-auto px-3 gap-0.5">
                    {chatHistory.length === 0 && (
                        <div className="px-3 py-4 text-center text-[12px] text-[#9CA3AF]">No conversations yet</div>
                    )}
                    {chatHistory.map((h) => (
                        <div
                            key={h.id}
                            className={`group py-2.5 px-3 rounded-[12px] cursor-pointer transition-colors flex items-start gap-3 ${sessionId === h.id
                                ? "bg-[#EFF6FF] border border-[#DBEAFE]"
                                : "hover:bg-[#F8FAFC]"
                                }`}
                        >
                            {editingChatId === h.id ? (
                                <div className="flex flex-1 items-start gap-3 min-w-0">
                                    <MessageSquare className={`w-4 h-4 mt-0.5 flex-shrink-0 ${sessionId === h.id ? "text-[#1D4ED8]" : "text-[#CBD5E1]"
                                        }`} />
                                    <div className="min-w-0 flex-1">
                                        <input
                                            autoFocus
                                            value={editingChatTitle}
                                            onChange={(e) => setEditingChatTitle(e.target.value)}
                                            onClick={(e) => e.stopPropagation()}
                                            onBlur={() => finishRenamingChat(h.id)}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                    e.preventDefault();
                                                    finishRenamingChat(h.id);
                                                }
                                                if (e.key === "Escape") {
                                                    e.preventDefault();
                                                    cancelRenamingChat();
                                                }
                                            }}
                                            className="w-full rounded-lg border border-[#BFDBFE] bg-white px-2 py-1 text-[13.5px] text-[#0A2140] outline-none focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#1D4ED8]/20"
                                        />
                                    </div>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => { void loadChat(h.id); setIsMobileMenuOpen(false); }}
                                    className="flex flex-1 items-start gap-3 min-w-0 border-none bg-transparent p-0 text-left cursor-pointer"
                                >
                                    <MessageSquare className={`w-4 h-4 mt-0.5 flex-shrink-0 ${sessionId === h.id ? "text-[#1D4ED8]" : "text-[#CBD5E1]"
                                        }`} />
                                    <div className="min-w-0">
                                        <div className={`text-[13.5px] truncate transition-colors ${sessionId === h.id
                                            ? "text-[#1D4ED8]"
                                            : "text-[#64748B] group-hover:text-[#1D4ED8]"
                                            }`} style={{ fontWeight: 500 }}>{h.title}</div>
                                    </div>
                                </button>
                            )}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button
                                        type="button"
                                        onClick={(e) => e.stopPropagation()}
                                        className="h-8 w-8 flex-shrink-0 rounded-lg text-[#94A3B8] hover:text-[#475569] hover:bg-white/80 transition-colors border-none bg-transparent cursor-pointer flex items-center justify-center"
                                        aria-label={`Open actions for ${h.title}`}
                                    >
                                        <MoreVertical className="w-4 h-4" />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-40">
                                    <DropdownMenuItem
                                        className="flex items-center gap-2 cursor-pointer text-[#374151]"
                                        onSelect={(e) => {
                                            e.preventDefault();
                                            handleRenameChat(h.id);
                                        }}
                                    >
                                        <Edit2 className="w-4 h-4" />
                                        Rename
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        className={`flex items-center gap-2 text-[#DC2626] focus:text-[#DC2626] ${deletingChatIds.has(h.id) ? "opacity-60 cursor-not-allowed pointer-events-none" : "cursor-pointer"}`}
                                        onSelect={(e) => {
                                            e.preventDefault();
                                            if (deletingChatIds.has(h.id)) return;
                                            void handleDeleteChat(h.id);
                                        }}
                                    >
                                        <Trash2 className="w-4 h-4" />
                                        {deletingChatIds.has(h.id) ? "Deleting..." : "Delete"}
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    ))}
                </div>

                {!isSignedIn && (
                    <div className="px-4 mt-4">
                        <div className={`rounded-2xl border p-4 ${showDismissedGuestLimitNotice
                            ? "border-[#FECACA] bg-[#FEF2F2]"
                            : "border-[#E5E7EB] bg-[#F8FAFC]"
                            }`}>
                            <p className="text-[#0A2140] text-sm mb-2" style={{ fontWeight: 700 }}>
                                Browsing as guest
                            </p>
                            <p className={`text-xs leading-relaxed mb-3 ${showDismissedGuestLimitNotice ? "text-[#B91C1C]" : "text-[#6B7280]"}`}>
                                {showDismissedGuestLimitNotice
                                    ? "Free guest chat is over on this device. Sign in or sign up to keep chatting and sync your history."
                                    : "Use chat as a guest for now. Sign in anytime to save conversations, unlock your travel tools, and sync your history."}
                            </p>
                            <div className="flex flex-col gap-2">
                                <Link
                                    href={getGuestAuthHref(currentChatRedirectUrl)}
                                    className="inline-flex items-center justify-center rounded-xl bg-[#1D4ED8] px-3 py-2 text-sm font-medium text-white no-underline hover:bg-[#1E40AF] transition-colors"
                                >
                                    Login
                                </Link>
                                <Link
                                    href={`/sign-up?redirect_url=${encodeURIComponent(currentChatRedirectUrl)}`}
                                    className="inline-flex items-center justify-center rounded-xl border border-[#DBEAFE] px-3 py-2 text-sm font-medium text-[#1D4ED8] no-underline hover:bg-[#EFF6FF] transition-colors"
                                >
                                    Sign up
                                </Link>
                            </div>
                        </div>
                    </div>
                )}

                {/* Profile */}
                <div className="mt-auto p-4 border-t border-[#F1F5F9] pb-5">
                    <div className="flex items-center gap-3 px-2 py-2">
                        <div className="w-[42px] h-[42px] rounded-full bg-[#EEF2FF] flex items-center justify-center border-2 border-white shadow-sm flex-shrink-0 text-sm font-semibold text-[#3730A3]">
                        {resolvedDisplayName.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex flex-col min-w-0">
                        <span className="text-[14px] text-[#0A2140] truncate" style={{ fontWeight: 700 }}>
                            {resolvedDisplayName}
                        </span>
                        {isSignedIn ? (
                            <Link
                                href="/profile"
                                className="text-[12px] text-[#64748B] hover:text-[#1D4ED8] transition-colors mt-[1px] no-underline"
                                style={{ fontWeight: 500 }}
                            >
                                View Profile
                            </Link>
                        ) : (
                            <Link
                                href={`/sign-up?redirect_url=${encodeURIComponent(currentChatRedirectUrl)}`}
                                className="text-[12px] text-[#64748B] hover:text-[#1D4ED8] transition-colors mt-[1px] no-underline"
                                style={{ fontWeight: 500 }}
                            >
                                Create account
                            </Link>
                        )}
                        </div>
                    </div>
                </div>
            </div>

            {/* ━━━ CENTER CHAT AREA ━━━ */}
            <div className="flex-1 flex flex-col bg-white relative h-full min-w-0">
                {/* Chat container */}
                <div className="flex-1 flex flex-col items-center min-h-0">
                    <div className="w-full max-w-[800px] flex-1 flex flex-col min-h-0">

                        {/* Pre-chat hero */}
                        {!hasStartedChat && (
                            <div className="pt-8 sm:pt-20 pb-6 sm:pb-8 text-center px-4 sm:px-6 relative" style={{ animation: "fadeIn 0.5s ease-out" }}>
                                <div className="absolute top-4 left-4 md:hidden">
                                    <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 rounded-lg hover:bg-[#F3F4F6] text-[#0A2140] transition-colors bg-transparent border-none cursor-pointer">
                                        <Menu className="w-5 h-5" />
                                    </button>
                                </div>
                                <h1 className="text-[#0A2140] mb-2 px-4" style={{ fontSize: "24px", fontWeight: 700 }}>
                                    Your AI Travel Assistant
                                </h1>
                                <p className="text-[#6B7280] px-4" style={{ fontSize: "14px" }}>
                                    Ask anything to find flights, plan trips, or track prices.
                                </p>
                            </div>
                        )}

                        {/* Sticky header when chat started */}
                        {hasStartedChat && (
                            <div className="sticky top-0 z-10 bg-white border-b border-[#E5E7EB] px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3 shadow-sm">
                                <button onClick={() => setIsMobileMenuOpen(true)} className="md:hidden p-1.5 -ml-1.5 rounded-lg hover:bg-[#F3F4F6] text-[#0A2140] transition-colors bg-transparent border-none cursor-pointer">
                                    <Menu className="w-5 h-5" />
                                </button>
                                <h2 className="text-[#0A2140] text-sm sm:text-base" style={{ fontWeight: 600 }}>Chat with AI Assistant</h2>
                            </div>
                        )}

                        {/* Pre-chat travel tip */}
                        {!hasStartedChat && (
                            <div className="flex flex-col items-center justify-center mb-6 sm:mb-8 px-4" style={{ animation: "fadeIn 0.5s ease-out 0.1s both" }}>
                                <div className="max-w-xl text-center">
                                    <div className="flex items-center justify-center gap-1.5 sm:gap-2 mb-2 sm:mb-3">
                                        <TipIcon className="w-4 h-4 sm:w-5 sm:h-5 text-[#1D4ED8]" />
                                        <small className="text-[#6B7280] text-xs sm:text-sm">Travel Tip</small>
                                    </div>
                                    <p className="text-[#111827] mb-3 sm:mb-4 text-sm sm:text-base leading-relaxed">{travelTip}</p>
                                    <small className="text-[#6B7280] text-xs sm:text-sm">Ask me anything to get help with your travel-related query.</small>
                                </div>
                            </div>
                        )}

                        {/* Messages */}
                        <div className="flex-1 overflow-y-auto py-4 sm:py-8 px-4 sm:px-6">
                            {messages.map((m, i) => {
                                const isStreamingMessage = m.localId === activeStreamingMessageId;
                                const flightCards = m.allFlights?.length ? m.allFlights : (m.flights ?? []);
                                const flightMessageKey = getFlightBatchKey(m, i);
                                const baseVisibleFlightCount = m.flights?.length
                                    ? m.flights.length
                                    : Math.min(FLIGHT_BATCH_SIZE, flightCards.length);
                                const visibleFlightCount = Math.min(
                                    flightCards.length,
                                    expandedFlightCounts[flightMessageKey] ?? baseVisibleFlightCount,
                                );
                                const visibleFlightCards = flightCards.slice(0, visibleFlightCount);
                                const hiddenFlightCount = flightCards.length - visibleFlightCount;
                                const nextFlightBatchCount = Math.min(FLIGHT_BATCH_SIZE, hiddenFlightCount);

                                return (
                                <div
                                    key={m.localId || i}
                                    className={`mb-4 sm:mb-6 flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                                    style={{ animation: "fadeIn 0.3s ease-out" }}
                                >
                                    {m.role === "assistant" ? (
                                        <div className="flex gap-2 sm:gap-3 w-full">
                                            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-gradient-to-br from-[#1D4ED8] to-[#1E40AF] flex items-center justify-center flex-shrink-0">
                                                <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                {m.content && (
                                                    <div className="text-[#374151] leading-relaxed mb-3 sm:mb-4 text-sm sm:text-base min-w-0 break-words chat-markdown">
                                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                            {String(m.content)
                                                                .replace(/\\\*\*/g, "**")
                                                                .replace(/\\\*(?!\*)/g, "*")}
                                                        </ReactMarkdown>
                                                    </div>
                                                )}

                                                {/* Inline TinyFlightCards */}
                                                {visibleFlightCards.length > 0 && (
                                                    <div className="space-y-3 mb-3 sm:mb-4">
                                                        {visibleFlightCards.map((f) => (
                                                            <TinyFlightCard
                                                                key={f.id}
                                                                flight={f}
                                                                onDetails={(id) => {
                                                                    const fl = visibleFlightCards.find((x) => x.id === id);
                                                                    if (fl) {
                                                                        openFlightDetails(fl, m.searchMeta?.fromCity, m.searchMeta?.toCity);
                                                                    }
                                                                }}
                                                                onTrackPrice={(id) => {
                                                                    const fl = visibleFlightCards.find((x) => x.id === id);
                                                                    if (!fl) return;
                                                                    void sendMessage(buildTrackAlertInstructionFromFlight(fl));
                                                                }}
                                                                onBook={handleBookIntent}
                                                            />
                                                        ))}

                                                        {hiddenFlightCount > 0 && (
                                                            <div className="pt-1">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        revealMoreFlights(
                                                                            flightMessageKey,
                                                                            baseVisibleFlightCount,
                                                                            flightCards.length,
                                                                        );
                                                                    }}
                                                                    className="inline-flex items-center gap-2 rounded-xl border border-[#DBEAFE] bg-[#EFF6FF] px-4 py-2.5 text-sm text-[#1D4ED8] transition-colors hover:bg-[#DBEAFE]"
                                                                    style={{ fontWeight: 600 }}
                                                                >
                                                                    Show more flight{nextFlightBatchCount === 1 ? "" : "s"}
                                                                    <ChevronRight className="h-4 w-4" />
                                                                </button>
                                                                {/* <p className="mt-1 text-[11px] text-[#6B7280]">
                                                                    The rest stay hidden until you ask for more.
                                                                </p> */}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                                {m.recommendationNote && (
                                                    <div className="rounded-xl border border-[#DBEAFE] bg-[#EFF6FF] p-3 mb-3 sm:mb-4">
                                                        <p className="text-[11px] uppercase tracking-wide text-[#1D4ED8] mb-1" style={{ fontWeight: 700 }}>
                                                            AI Recommendation
                                                        </p>
                                                        <p className="text-sm text-[#0A2140] leading-relaxed">
                                                            {m.recommendationNote}
                                                        </p>
                                                    </div>
                                                )}

                                                {/* Weather Card */}
                                                {m.weather && (
                                                    <div className="rounded-xl border border-[#E5E7EB] bg-gradient-to-r from-[#F0F9FF] to-[#EFF6FF] p-4 mb-3 sm:mb-4" style={{ animation: "fadeIn 0.4s ease-out" }}>
                                                        <div className="flex items-start gap-3">
                                                            <Image
                                                                src={m.weather.icon_url}
                                                                alt={m.weather.condition}
                                                                width={48}
                                                                height={48}
                                                                unoptimized
                                                                className="w-12 h-12 -mt-1"
                                                            />
                                                            <div className="flex-1">
                                                                <div className="flex items-center gap-2 mb-1">
                                                                    <h4 className="text-[#0A2140] text-sm" style={{ fontWeight: 600 }}>
                                                                        Weather in {m.weather.city}
                                                                    </h4>
                                                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white text-[#6B7280] border border-[#E5E7EB]">
                                                                        {m.weather.condition}
                                                                    </span>
                                                                </div>
                                                                <div className="flex items-center gap-4 text-xs text-[#374151] mb-2">
                                                                    <span className="text-lg" style={{ fontWeight: 700 }}>{m.weather.temp}°C</span>
                                                                    <span className="text-[#6B7280]">Feels like {m.weather.feels_like}°C</span>
                                                                    <span className="text-[#6B7280]">💧 {m.weather.humidity}%</span>
                                                                    <span className="text-[#6B7280]">💨 {m.weather.wind_speed} m/s</span>
                                                                </div>
                                                                <div className="flex items-center gap-2 text-xs text-[#374151]">
                                                                    <span className="text-[#6B7280]">High: {m.weather.temp_max}°C</span>
                                                                    <span className="text-[#9CA3AF]">·</span>
                                                                    <span className="text-[#6B7280]">Low: {m.weather.temp_min}°C</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        {m.weatherAdvice && (
                                                            <div className="mt-3 pt-3 border-t border-[#DBEAFE] text-xs text-[#1D4ED8] leading-relaxed">
                                                                ✨ {m.weatherAdvice}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                                {/* Maps Card */}
                                                {m.maps && m.maps.embed_url && (
                                                    <div className="rounded-xl border border-[#E5E7EB] overflow-hidden mb-3 sm:mb-4" style={{ animation: "fadeIn 0.5s ease-out" }}>
                                                        <div className="bg-white px-4 py-3 border-b border-[#E5E7EB] flex items-center justify-between">
                                                            <div>
                                                                <h4 className="text-[#0A2140] text-sm" style={{ fontWeight: 600 }}>
                                                                    📍 Get to {m.maps.origin_airport}
                                                                </h4>
                                                                <p className="text-[#6B7280] text-[11px] mt-0.5">Departure airport directions</p>
                                                            </div>
                                                            <a
                                                                href={m.maps.directions_url}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="text-xs text-white bg-[#1D4ED8] hover:bg-[#1E40AF] px-3 py-1.5 rounded-lg no-underline transition-colors"
                                                            >
                                                                Get Directions
                                                            </a>
                                                        </div>
                                                        <iframe
                                                            src={m.maps.embed_url}
                                                            width="100%"
                                                            height="200"
                                                            style={{ border: 0 }}
                                                            allowFullScreen
                                                            loading="lazy"
                                                            referrerPolicy="no-referrer-when-downgrade"
                                                        />
                                                    </div>
                                                )}

                                                {/* Save confirmation quick actions */}
                                                {isSaveConfirmationPrompt(m) && (
                                                    <div className="flex items-center gap-2 mt-1 mb-2">
                                                        {(() => {
                                                            const itineraryPrompt = isItinerarySavePrompt(m);
                                                            const profilePrompt = isProfileSavePrompt(m);
                                                            const yesMessage = itineraryPrompt
                                                                ? "yes, save itinerary"
                                                                : profilePrompt
                                                                  ? "yes"
                                                                  : "yes save it";
                                                            const noMessage = itineraryPrompt
                                                                ? "no, don't save itinerary"
                                                                : profilePrompt
                                                                  ? "no, don't update my profile"
                                                                  : "no, don't save";
                                                            const yesLabel = itineraryPrompt
                                                                ? "Yes, save itinerary"
                                                                : profilePrompt
                                                                  ? "Yes, update profile"
                                                                  : "Yes, save";
                                                            return (
                                                                <>
                                                        <button
                                                            type="button"
                                                            onClick={() => { void sendMessage(yesMessage); }}
                                                            disabled={loading}
                                                            className="h-7 px-3 text-xs text-white bg-[#1D4ED8] hover:bg-[#1E40AF] disabled:opacity-60 rounded-md transition-colors border-none cursor-pointer"
                                                        >
                                                            {yesLabel}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => { void sendMessage(noMessage); }}
                                                            disabled={loading}
                                                            className="h-7 px-3 text-xs text-[#374151] bg-[#F3F4F6] hover:bg-[#E5E7EB] disabled:opacity-60 rounded-md transition-colors border-none cursor-pointer"
                                                        >
                                                            No, cancel
                                                        </button>
                                                                </>
                                                            );
                                                        })()}
                                                    </div>
                                                )}

                                                {isBookedFlightConsentPrompt(m) && (
                                                    <div className="flex items-center gap-2 mt-1 mb-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                appendAssistantMessage("Great. I have the flight details. Should I save these flight details to My Trips now?");
                                                            }}
                                                            disabled={loading}
                                                            className="h-7 px-3 text-xs text-white bg-[#1D4ED8] hover:bg-[#1E40AF] disabled:opacity-60 rounded-md transition-colors border-none cursor-pointer"
                                                        >
                                                            Yes, booked
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setPendingBookedFlight(null);
                                                                writePendingBookedFlight(null);
                                                                writePendingBookingReturn(false);
                                                                appendAssistantMessage("No problem. I will not add this trip now.");
                                                            }}
                                                            disabled={loading}
                                                            className="h-7 px-3 text-xs text-[#374151] bg-[#F3F4F6] hover:bg-[#E5E7EB] disabled:opacity-60 rounded-md transition-colors border-none cursor-pointer"
                                                        >
                                                            Not yet
                                                        </button>
                                                    </div>
                                                )}

                                                {isTripSaveReadyPrompt(m) && (
                                                    <div className="flex items-center gap-2 mt-1 mb-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                if (!pendingBookedFlight) return;
                                                                const instruction = buildTripSaveInstructionFromFlight(pendingBookedFlight);
                                                                setPendingBookedFlight(null);
                                                                writePendingBookedFlight(null);
                                                                writePendingBookingReturn(false);
                                                                void sendMessage(instruction);
                                                            }}
                                                            disabled={loading || !pendingBookedFlight}
                                                            className="h-7 px-3 text-xs text-white bg-[#1D4ED8] hover:bg-[#1E40AF] disabled:opacity-60 rounded-md transition-colors border-none cursor-pointer"
                                                        >
                                                            Save to My Trips
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setPendingBookedFlight(null);
                                                                writePendingBookedFlight(null);
                                                                writePendingBookingReturn(false);
                                                                appendAssistantMessage("Okay. I will not save this trip.");
                                                            }}
                                                            disabled={loading}
                                                            className="h-7 px-3 text-xs text-[#374151] bg-[#F3F4F6] hover:bg-[#E5E7EB] disabled:opacity-60 rounded-md transition-colors border-none cursor-pointer"
                                                        >
                                                            Not now
                                                        </button>
                                                    </div>
                                                )}

                                                {/* Copy / Report */}
                                                {!isStreamingMessage && (
                                                <div className="flex items-center gap-2 mt-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleCopyMessage(m, i)}
                                                        disabled={!m.content?.trim()}
                                                        className="h-6 sm:h-7 px-1.5 sm:px-2 text-xs text-[#6B7280] hover:text-[#374151] hover:bg-[#F3F4F6] disabled:opacity-40 disabled:cursor-not-allowed rounded flex items-center gap-1 transition-colors bg-transparent border-none cursor-pointer"
                                                    >
                                                        {copiedMessageIndex === i ? (
                                                            <>
                                                                <Check className="w-3 h-3" />
                                                                <span className="hidden sm:inline">Copied</span>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Copy className="w-3 h-3" />
                                                                <span className="hidden sm:inline">Copy</span>
                                                            </>
                                                        )}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => { void handleReportMessage(m, i); }}
                                                        disabled={reportingMessageKey === getReportMessageKey(m, i)}
                                                        className="h-6 sm:h-7 px-1.5 sm:px-2 text-xs text-[#6B7280] hover:text-[#374151] hover:bg-[#F3F4F6] disabled:opacity-40 disabled:cursor-not-allowed rounded flex items-center gap-1 transition-colors bg-transparent border-none cursor-pointer"
                                                    >
                                                        <Flag className="w-3 h-3" />
                                                        <span className="hidden sm:inline">
                                                            {reportingMessageKey === getReportMessageKey(m, i) ? "Reporting" : "Report"}
                                                        </span>
                                                    </button>
                                                </div>
                                                )}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="bg-[#F3F4F6] rounded-2xl px-3 sm:px-4 py-2.5 sm:py-3 max-w-[85%]">
                                            <p className="text-[#374151] text-sm sm:text-base">{m.content}</p>
                                        </div>
                                    )}
                                </div>
                            )})}

                            {/* Typing indicator */}
                            {showTypingIndicator && (
                                <div className="flex gap-2 sm:gap-3 mb-6" style={{ animation: "fadeIn 0.3s ease-out" }}>
                                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-gradient-to-br from-[#1D4ED8] to-[#1E40AF] flex items-center justify-center flex-shrink-0">
                                        <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
                                    </div>
                                    <div className="bg-[#F3F4F6] rounded-2xl px-4 py-3 flex gap-1.5 items-center">
                                        {[0, 1, 2].map((j) => (
                                            <div key={j} className="w-2 h-2 rounded-full bg-[#9CA3AF]" style={{ animation: `bounceDot 1.4s ease-in-out ${j * 0.2}s infinite` }} />
                                        ))}
                                    </div>
                                </div>
                            )}
                            <div ref={chatEndRef} />
                        </div>
                    </div>
                </div>

                {/* ─── Bottom Input ─── */}
                <div className="sticky bottom-0 bg-white border-t border-[#E5E7EB]">
                    <div className="max-w-[800px] mx-auto px-3 sm:px-4 lg:px-6 py-3 sm:py-4">
                        {!hasStartedChat && (
                            <div className="flex justify-start sm:justify-center gap-2 mb-3 overflow-x-auto pb-2 -mx-1 px-1">
                                {quickActions.map((action, idx) => {
                                    const Icon = action.icon;
                                    return (
                                        <button
                                            key={idx}
                                            onClick={() => {
                                                if (hasReachedGuestChatLimit) {
                                                    handleBlockedGuestMessageAttempt();
                                                    return;
                                                }
                                                void sendMessage(action.message ?? action.label);
                                            }}
                                            className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-full border transition-all whitespace-nowrap text-xs sm:text-sm flex-shrink-0 ${hasReachedGuestChatLimit
                                                ? "bg-[#F8FAFC] border-[#E5E7EB] text-[#94A3B8]"
                                                : "bg-[#F8FAFC] border-[#E5E7EB] hover:bg-[#F3F4F6] hover:border-[#1D4ED8] text-[#374151]"
                                                } cursor-pointer`}
                                        >
                                            <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                                            {action.label}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                        {showDismissedGuestLimitNotice && (
                            <div className="mb-3 rounded-2xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#B91C1C]">
                                Free guest chat is over. Sign in or sign up to continue.
                            </div>
                        )}
                        <ChatInput value={input} onChange={setInput} onSend={() => void sendMessage()} disabled={loading || hasReachedGuestChatLimit} />
                        <p className="text-[#6B7280] text-center mt-2 sm:mt-3 px-2" style={{ fontSize: "11px" }}>
                            By messaging Book With AI, you agree to our{" "}
                            <Link href="#" className="underline hover:text-[#374151] transition-colors">Terms</Link>
                            {" "}and have read our{" "}
                            <Link href="#" className="underline hover:text-[#374151] transition-colors">Privacy Policy</Link>
                        </p>
                    </div>
                </div>

            </div>

            {isGuestLimitModalOpen && !isSignedIn && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#0F172A]/55 px-4">
                    <div className="w-full max-w-md rounded-3xl border border-[#DBEAFE] bg-white p-6 shadow-2xl">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#1D4ED8]">
                                    Guest limit reached
                                </p>
                                <h3 className="mt-2 text-[24px] text-[#0A2140]" style={{ fontWeight: 700 }}>
                                    Sign in for more chats
                                </h3>
                            </div>
                            <button
                                type="button"
                                onClick={dismissGuestLimitModal}
                                className="h-9 w-9 rounded-full border border-[#E5E7EB] bg-white text-[#6B7280] hover:text-[#0A2140] hover:bg-[#F8FAFC] transition-colors cursor-pointer"
                            >
                                <X className="w-4 h-4 mx-auto" />
                            </button>
                        </div>
                        <p className="mt-4 text-sm leading-7 text-[#6B7280]">
                            You have used all {GUEST_CHAT_LIMIT} guest chats on this device. Create an account to continue chatting and keep your travel plans synced.
                        </p>
                        <div className="mt-6 flex flex-col gap-3">
                            <Link
                                href={getGuestAuthHref(currentChatRedirectUrl)}
                                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#1D4ED8] px-4 py-3 text-sm font-medium text-white no-underline hover:bg-[#1E40AF] transition-colors"
                            >
                                <LogIn className="w-4 h-4" />
                                Sign in
                            </Link>
                            <Link
                                href={`/sign-up?redirect_url=${encodeURIComponent(currentChatRedirectUrl)}`}
                                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#DBEAFE] px-4 py-3 text-sm font-medium text-[#1D4ED8] no-underline hover:bg-[#EFF6FF] transition-colors"
                            >
                                <UserPlus className="w-4 h-4" />
                                Sign up
                            </Link>
                            <button
                                type="button"
                                onClick={dismissGuestLimitModal}
                                className="rounded-2xl border border-[#E5E7EB] px-4 py-3 text-sm font-medium text-[#64748B] hover:bg-[#F8FAFC] transition-colors cursor-pointer"
                            >
                                Stay logged out
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <FeedbackWidget
                placement="floating"
                variant="chat"
                chatViewportCorner={isLgViewport ? "right" : "left"}
                chatMobileDrawerOpen={isMobileMenuOpen}
                sessionId={sessionId}
                selectedFlightContext={
                    selectedFlight
                        ? {
                              airline: selectedFlight.airline,
                              from: selectedFlight.from,
                              to: selectedFlight.to,
                              price: selectedFlight.price,
                          }
                        : undefined
                }
            />

            {/* ━━━ RIGHT FLIGHT DETAILS PANEL ━━━ */}
            <FlightDetailsPanel
                flight={selectedFlight}
                isOpen={isPanelOpen}
                onClose={() => setIsPanelOpen(false)}
                onBook={handleBookIntent}
                verifying={verifyingPrice}
                error={verificationError}
                confirmedOffer={confirmedOffer}
                verificationMeta={verificationMeta}
                seatmaps={seatmapData}
            />
        </div>
    );
}
