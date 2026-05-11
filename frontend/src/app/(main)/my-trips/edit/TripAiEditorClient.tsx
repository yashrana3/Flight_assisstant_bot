"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { ArrowLeft, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import AuthRequiredCard from "@/components/AuthRequiredCard";

const SESSION_KEY = "bookwithai_session_id";

interface TripFromApi {
  id: string;
  airline: string | null;
  origin: string;
  destination: string;
  departure_date: string | null;
  arrival_date: string | null;
  status: string;
  cabin_class: string | null;
  booking_ref: string | null;
  confirmation_code: string | null;
  ticket_number: string | null;
  seat_number: string | null;
  ticket_cost: number | null;
  currency: string | null;
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    if (/[T ]\d{2}:\d{2}/.test(value)) {
      return date.toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
      });
    }

    return date.toLocaleDateString("en-IN", { dateStyle: "medium" });
  } catch {
    return value;
  }
}

export default function TripAiEditorClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoaded, isSignedIn } = useUser();
  const tripId = searchParams.get("id");
  const isCreateMode = !tripId;

  const [trip, setTrip] = useState<TripFromApi | null>(null);
  const [instruction, setInstruction] = useState("");
  const [loadingTrip, setLoadingTrip] = useState(!isCreateMode);
  const [saving, setSaving] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    try {
      setSessionId(sessionStorage.getItem(SESSION_KEY));
    } catch {
      setSessionId(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!isLoaded || !isSignedIn) {
      if (isLoaded && !isSignedIn) {
        setLoadingTrip(false);
      }
      return;
    }

    if (isCreateMode || !tripId) {
      setLoadingTrip(false);
      return;
    }

    const loadTrip = async () => {
      setLoadingTrip(true);
      try {
        const res = await fetch(`/api/trips/${encodeURIComponent(tripId)}`, {
          cache: "no-store",
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(data?.detail ?? "Failed to load trip.");
        }
        if (!cancelled) {
          setTrip(data.trip);
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to load trip.",
        );
        router.push("/my-trips");
      } finally {
        if (!cancelled) {
          setLoadingTrip(false);
        }
      }
    };

    void loadTrip();

    return () => {
      cancelled = true;
    };
  }, [isCreateMode, tripId, router, isLoaded, isSignedIn]);

  const redirectUrl = tripId
    ? `/my-trips/edit?id=${encodeURIComponent(tripId)}`
    : "/my-trips/edit";

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#F8FAFC] to-[#F1F5F9]">
        <div className="max-w-[880px] mx-auto px-6 py-8 pb-24 lg:pb-12">
          <div className="rounded-2xl border border-[#E5E7EB] bg-white p-6 text-[#6B7280]">
            Loading trip editor…
          </div>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <AuthRequiredCard
        title="Log in to edit trips"
        description="Trip editing is only available for signed-in users because each booking is stored in your account."
        redirectUrl={redirectUrl}
      />
    );
  }

  const handleBack = () => {
    router.push("/my-trips");
  };

  const handleSubmit = async () => {
    if (!instruction.trim()) {
      toast.error("Tell the AI what you want to add or change.");
      return;
    }

    if (!isSignedIn) {
      router.push("/sign-up?redirect_url=/my-trips");
      return;
    }

    setSaving(true);
    const toastId = toast.loading(
      isCreateMode ? "Saving trip with AI…" : "Updating trip with AI…",
    );

    try {
      const endpoint = isCreateMode
        ? "/api/trips/ai-create"
        : `/api/trips/${encodeURIComponent(tripId as string)}/ai-edit`;
      const body = isCreateMode
        ? { instruction: instruction.trim(), session_id: sessionId ?? undefined }
        : { instruction: instruction.trim() };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.detail ?? "AI save failed.");
      }

      toast.success(
        isCreateMode ? "Trip saved successfully." : "Trip updated successfully.",
        { id: toastId },
      );
      router.push("/my-trips");
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "AI save failed.",
        { id: toastId },
      );
    } finally {
      setSaving(false);
    }
  };

  const pageTitle = isCreateMode ? "Add Trip" : "Edit Trip With AI";
  const pageSubtitle = isCreateMode
    ? "Tell the assistant about the booking and it will save the trip in your account."
    : "Describe what should change and the assistant will update the trip in the database.";

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F8FAFC] to-[#F1F5F9]">
      <div className="max-w-[880px] mx-auto px-6 py-8 pb-24 lg:pb-12">
        <button
          onClick={handleBack}
          className="mb-6 flex items-center gap-2 text-sm text-[#1D4ED8] hover:text-[#1E40AF] cursor-pointer bg-transparent border-none p-0"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to My Trips
        </button>

        <div className="space-y-5" style={{ animation: "fadeIn 0.4s ease-out" }}>
          <div>
            <h1
              className="text-[#0A2140] mb-1 text-2xl sm:text-[28px]"
              style={{ fontWeight: 700 }}
            >
              {pageTitle}
            </h1>
            <p className="text-[#6B7280] text-sm sm:text-base">
              {pageSubtitle}
            </p>
          </div>

          <div className="rounded-2xl border border-[#DBEAFE] bg-[#EFF6FF] p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#1D4ED8] text-white flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-[#1E3A8A] text-base sm:text-lg font-semibold">
                  Prompt the AI naturally
                </h2>
                <p className="text-[#3730A3] mt-1 text-sm leading-6">
                  Examples:{" "}
                  <span className="font-medium">
                    “Add my Emirates trip from DEL to DXB on 2026-05-14, business
                    class, PNR ABC123, cost 28500 INR”
                  </span>{" "}
                  or{" "}
                  <span className="font-medium">
                    “Change this booking to Air India, move departure to 2026-06-02,
                    and pause it for now”
                  </span>
                  .
                </p>
              </div>
            </div>
          </div>

          {!isCreateMode && loadingTrip && (
            <div className="rounded-2xl border border-[#E5E7EB] bg-white p-6 text-[#6B7280]">
              Loading trip details…
            </div>
          )}

          {!isCreateMode && !loadingTrip && trip && (
            <div className="rounded-2xl bg-white border border-[#E5E7EB] p-5 sm:p-6 shadow-sm">
              <h2
                className="text-[#0A2140] mb-4 text-base sm:text-lg"
                style={{ fontWeight: 600 }}
              >
                Current trip details
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-[#6B7280]">Route</p>
                  <p className="text-[#111827] font-medium">
                    {trip.origin} → {trip.destination}
                  </p>
                </div>
                <div>
                  <p className="text-[#6B7280]">Airline</p>
                  <p className="text-[#111827] font-medium">
                    {trip.airline || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[#6B7280]">Departure</p>
                  <p className="text-[#111827] font-medium">
                    {formatDateTime(trip.departure_date)}
                  </p>
                </div>
                <div>
                  <p className="text-[#6B7280]">Arrival</p>
                  <p className="text-[#111827] font-medium">
                    {formatDateTime(trip.arrival_date)}
                  </p>
                </div>
                <div>
                  <p className="text-[#6B7280]">Status</p>
                  <p className="text-[#111827] font-medium">{trip.status}</p>
                </div>
                <div>
                  <p className="text-[#6B7280]">Confirmation</p>
                  <p className="text-[#111827] font-medium">
                    {trip.confirmation_code || "—"}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-2xl bg-white border border-[#E5E7EB] p-5 sm:p-6 shadow-sm">
            <label
              htmlFor="trip-ai-instruction"
              className="block text-[#0A2140] text-sm font-semibold mb-2"
            >
              What should the AI save?
            </label>
            <textarea
              id="trip-ai-instruction"
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              rows={7}
              placeholder={
                isCreateMode
                  ? "Describe the booking details you want to save."
                  : "Describe exactly what should change on this trip."
              }
              className="w-full rounded-xl border border-[#E5E7EB] px-4 py-3 text-sm text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8] resize-none"
            />

            <div className="mt-4 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-end">
              <button
                type="button"
                onClick={handleBack}
                className="px-4 py-2 rounded-lg text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6] border-none cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={saving || loadingTrip || !isLoaded}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-[#1D4ED8] hover:bg-[#1E40AF] disabled:opacity-50 border-none cursor-pointer"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    {isCreateMode ? "Save With AI" : "Update With AI"}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
