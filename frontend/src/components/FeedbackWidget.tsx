"use client";

import { useState } from "react";
import { CircleHelp, X, Send } from "lucide-react";
import { useUser } from "@clerk/nextjs";
import { cn } from "@/lib/utils";

interface FeedbackWidgetProps {
    sessionId?: string | null;
    selectedFlightContext?: unknown;
    /**
     * "page" — main app layout (floating FAB).
     * "chat" — placement=floating; use chatViewportCorner for which viewport corner.
     */
    variant?: "page" | "chat";
    /**
     * floating — fixed corner button (main layout).
     * inline — sits in normal layout flow (rare; avoids fixed overlap in tight layouts).
     */
    placement?: "floating" | "inline";
    /** When variant=chat and placement=floating: which viewport corner (bottom area; tall bottom offset clears the composer). */
    chatViewportCorner?: "left" | "right";
    /**
     * Chat page only: when the mobile drawer is open, shift the bottom-left FAB to sit beside the 260px rail (above the dimmer).
     */
    chatMobileDrawerOpen?: boolean;
}

function getPageSnapshot() {
    if (typeof window === "undefined") return undefined;
    const content =
        document?.body?.innerText
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

export default function FeedbackWidget({
    sessionId = null,
    selectedFlightContext,
    variant = "page",
    placement = "floating",
    chatViewportCorner,
    chatMobileDrawerOpen = false,
}: FeedbackWidgetProps) {
    const { user, isSignedIn } = useUser();
    const [open, setOpen] = useState(false);
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [message, setMessage] = useState("");
    const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");

    const autoName = user?.fullName?.trim() || user?.firstName?.trim() || undefined;
    const autoEmail = user?.emailAddresses?.[0]?.emailAddress?.trim() || undefined;
    // If Clerk has no display name, use the email local-part so name is always present when signed in.
    const resolvedAccountName =
        autoName || (autoEmail ? autoEmail.split("@")[0]?.trim() : "") || "";

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!message.trim()) return;
        if (!isSignedIn && (!name.trim() || !email.trim())) return;
        if (isSignedIn && (!autoEmail || !resolvedAccountName)) return;
        setStatus("sending");
        try {
            const res = await fetch("/api/feedback", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: isSignedIn ? resolvedAccountName : name.trim(),
                    email: isSignedIn ? autoEmail : email.trim(),
                    message: message.trim(),
                    chat_session_id: sessionId || undefined,
                    context_flights:
                        selectedFlightContext && typeof selectedFlightContext === "object"
                            ? {
                                  ...(selectedFlightContext as Record<string, unknown>),
                                  page_snapshot: getPageSnapshot(),
                              }
                            : {
                                  selected_context: selectedFlightContext ?? null,
                                  page_snapshot: getPageSnapshot(),
                              },
                }),
            });
            if (!res.ok) throw new Error("Failed to submit");
            setStatus("success");
            if (!isSignedIn) {
                setName("");
                setEmail("");
            }
            setMessage("");
            setTimeout(() => {
                setOpen(false);
                setStatus("idle");
            }, 1500);
        } catch {
            setStatus("error");
        }
    };

    const chatCorner = variant === "chat" ? chatViewportCorner ?? "left" : null;

    const triggerClassesFloating =
        variant === "chat" && chatCorner === "right"
            ? [
                  "fixed z-20 flex h-12 w-12 items-center justify-center rounded-full",
                  "bg-[#1D4ED8] text-white shadow-lg hover:bg-[#1E40AF] transition-colors border-none cursor-pointer",
                  "left-auto right-6 bottom-[max(1.5rem,env(safe-area-inset-bottom,0px))]",
              ].join(" ")
            : variant === "chat" && chatCorner === "left"
              ? cn(
                    "fixed z-[35] flex h-12 w-12 items-center justify-center rounded-full",
                    "bg-[#1D4ED8] text-white shadow-lg hover:bg-[#1E40AF] transition-colors border-none cursor-pointer",
                    "right-auto bottom-[max(13rem,env(safe-area-inset-bottom,0px))]",
                    // Phone: bottom-left; when drawer open, sit beside the rail (same horizontal line as tablet).
                    "left-6",
                    chatMobileDrawerOpen && "max-md:!left-[calc(260px+1.5rem)]",
                    // Tablet: persistent rail (ChatClient `w-[260px]`) — align with main pane.
                    "md:max-lg:left-[calc(260px+1.5rem)]",
                )
              : [
                    "fixed z-20 flex h-12 w-12 items-center justify-center rounded-full",
                    "bg-[#1D4ED8] text-white shadow-lg hover:bg-[#1E40AF] transition-colors border-none cursor-pointer",
                    "max-lg:left-6 max-lg:right-auto max-lg:bottom-24",
                    "lg:bottom-6 lg:right-6 lg:left-auto",
                ].join(" ");

    const triggerClassesInline =
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1D4ED8] text-white shadow-md hover:bg-[#1E40AF] transition-colors border-none cursor-pointer";

    const triggerButton = (
        <button
            type="button"
            onClick={() => setOpen(true)}
            className={placement === "inline" ? triggerClassesInline : triggerClassesFloating}
            aria-label="Questions and feedback"
        >
            <CircleHelp className="w-5 h-5" />
        </button>
    );

    return (
        <>
            {placement === "inline" ? (
                <div className="mb-2 flex justify-start">{triggerButton}</div>
            ) : (
                triggerButton
            )}

            {open && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setOpen(false)}>
                    <div
                        className="bg-white rounded-xl shadow-xl max-w-md w-full p-6"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-[#0A2140] text-lg font-semibold">Send feedback</h3>
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                className="p-1.5 rounded-lg hover:bg-[#F3F4F6] text-[#6B7280] border-none cursor-pointer"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            {isSignedIn ? (
                                <div className="rounded-lg border border-[#DBEAFE] bg-[#EFF6FF] px-3 py-2 text-xs text-[#1E3A8A]">
                                    Signed in as {resolvedAccountName || "User"} ({autoEmail || "email not available"}).
                                </div>
                            ) : (
                                <>
                                    <div>
                                        <label className="block text-sm font-medium text-[#374151] mb-1">Name *</label>
                                        <input
                                            type="text"
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                            required
                                            className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm text-[#374151] focus:border-[#1D4ED8] focus:outline-none"
                                            placeholder="Your name"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-[#374151] mb-1">Email *</label>
                                        <input
                                            type="email"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            required
                                            className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm text-[#374151] focus:border-[#1D4ED8] focus:outline-none"
                                            placeholder="your@email.com"
                                        />
                                    </div>
                                </>
                            )}
                            <div>
                                <label className="block text-sm font-medium text-[#374151] mb-1">Your feedback *</label>
                                <textarea
                                    value={message}
                                    onChange={(e) => setMessage(e.target.value)}
                                    required
                                    rows={4}
                                    className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm text-[#374151] focus:border-[#1D4ED8] focus:outline-none resize-none"
                                    placeholder="Describe your issue or share your feedback..."
                                />
                            </div>
                            {status === "success" && (
                                <p className="text-sm text-green-600">Thanks! Your feedback was submitted.</p>
                            )}
                            {status === "error" && (
                                <p className="text-sm text-red-600">Something went wrong. Please try again.</p>
                            )}
                            <div className="flex justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => setOpen(false)}
                                    className="px-4 py-2 rounded-lg text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6] border-none cursor-pointer"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={
                                        status === "sending" ||
                                        !message.trim() ||
                                        (!isSignedIn && (!name.trim() || !email.trim())) ||
                                        (isSignedIn && (!autoEmail || !resolvedAccountName))
                                    }
                                    className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-[#1D4ED8] hover:bg-[#1E40AF] disabled:opacity-50 border-none cursor-pointer flex items-center gap-2"
                                >
                                    {status === "sending" ? "Sending..." : "Send"}
                                    {status !== "sending" && <Send className="w-4 h-4" />}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </>
    );
}
