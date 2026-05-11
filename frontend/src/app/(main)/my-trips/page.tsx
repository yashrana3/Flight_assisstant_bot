"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import {
  CircleHelp,
  MoreVertical,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
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

interface TripFromApi {
  id: string;
  session_id?: string | null;
  airline: string | null;
  origin: string;
  destination: string;
  flight_number?: string | null;
  trip_type?: string | null;
  passenger_name?: string | null;
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
  created_at: string | null;
  updated_at?: string | null;
}

type ManualTripFormState = {
  passenger_name: string;
  origin: string;
  destination: string;
  trip_type: "one_way" | "round_trip";
  departure_date: string;
  arrival_date: string;
  airline: string;
  flight_number: string;
  cabin_class: string;
  confirmation_code: string;
  booking_ref: string;
  ticket_number: string;
  seat_number: string;
  ticket_cost: string;
  currency: string;
};

const INITIAL_MANUAL_TRIP_FORM: ManualTripFormState = {
  passenger_name: "",
  origin: "",
  destination: "",
  trip_type: "one_way",
  departure_date: "",
  arrival_date: "",
  airline: "",
  flight_number: "",
  cabin_class: "",
  confirmation_code: "",
  booking_ref: "",
  ticket_number: "",
  seat_number: "",
  ticket_cost: "",
  currency: "USD",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatTime(iso: string | null): string {
  if (!iso || !/[T ]\d{2}:\d{2}/.test(iso)) return "—";
  try {
    return new Date(iso).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function normalizeTripStatus(status: string | null | undefined): string {
  const normalized = (status ?? "").trim().toLowerCase();
  if (normalized === "planned") return "paused";
  if (normalized === "ticketed") return "confirmed";
  return normalized;
}

function formatStatusLabel(status: string | null | undefined): string {
  const normalized = normalizeTripStatus(status);
  if (!normalized) return "Confirmed";
  if (normalized === "paused") return "Paused";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function getStatusPillClass(status: string | null | undefined): string {
  const normalized = normalizeTripStatus(status);
  if (normalized === "paused") {
    return "bg-[#F3F4F6] text-[#6B7280]";
  }
  if (normalized === "cancelled") {
    return "bg-[#FEE2E2] text-[#B91C1C]";
  }
  if (normalized === "completed") {
    return "bg-[#DBEAFE] text-[#1D4ED8]";
  }
  return "bg-[#D1FAE5] text-[#065F46]";
}

function formatTripType(tripType: string | null | undefined): string {
  const normalized = (tripType ?? "").trim().toLowerCase();
  if (normalized === "round_trip") return "Round trip";
  if (normalized === "one_way") return "One way";
  return "—";
}

export default function MyTripsPage() {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useUser();
  const [trips, setTrips] = useState<TripFromApi[]>([]);
  const [loadingTrips, setLoadingTrips] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [savingManualTrip, setSavingManualTrip] = useState(false);
  const [editingTripId, setEditingTripId] = useState<string | null>(null);
  const [manualTripForm, setManualTripForm] = useState<ManualTripFormState>(
    INITIAL_MANUAL_TRIP_FORM,
  );

  useEffect(() => {
    let cancelled = false;

    if (!isLoaded) return;

    if (!isSignedIn) {
      setTrips([]);
      setLoadingTrips(false);
      return;
    }

    const fetchTrips = async () => {
      setLoadingTrips(true);
      try {
        const res = await fetch("/api/trips", { cache: "no-store" });
        if (res.status === 401) {
          if (!cancelled) setTrips([]);
          return;
        }
        if (!res.ok) {
          throw new Error("Failed to load trips");
        }
        const data = await res.json();
        if (!cancelled) {
          setTrips(data.trips || []);
        }
      } catch {
        if (!cancelled) {
          setTrips([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingTrips(false);
        }
      }
    };

    void fetchTrips();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn]);

  const handleAddBooking = () => {
    if (!isSignedIn) {
      router.push("/sign-up?redirect_url=/my-trips");
      return;
    }

    setManualTripForm(INITIAL_MANUAL_TRIP_FORM);
    setEditingTripId(null);
    setIsManualModalOpen(true);
  };

  const closeManualModal = () => {
    if (savingManualTrip) return;
    setEditingTripId(null);
    setIsManualModalOpen(false);
  };

  const handleManualEditTrip = (trip: TripFromApi) => {
    setEditingTripId(trip.id);
    setManualTripForm({
      passenger_name: trip.passenger_name ?? "",
      origin: trip.origin,
      destination: trip.destination,
      trip_type: trip.trip_type === "round_trip" ? "round_trip" : "one_way",
      departure_date: trip.departure_date?.slice(0, 10) ?? "",
      arrival_date: trip.arrival_date?.slice(0, 10) ?? "",
      airline: trip.airline ?? "",
      flight_number: trip.flight_number ?? "",
      cabin_class: trip.cabin_class ?? "",
      confirmation_code: trip.confirmation_code ?? "",
      booking_ref: trip.booking_ref ?? "",
      ticket_number: trip.ticket_number ?? "",
      seat_number: trip.seat_number ?? "",
      ticket_cost: trip.ticket_cost != null ? String(trip.ticket_cost) : "",
      currency: trip.currency ?? "USD",
    });
    setIsManualModalOpen(true);
  };

  const handleManualFieldChange = (
    field: keyof ManualTripFormState,
    value: string,
  ) => {
    setManualTripForm((currentForm) => {
      const nextForm = {
        ...currentForm,
        [field]: value,
      };

      if (field === "trip_type" && value === "one_way") {
        nextForm.arrival_date = "";
      }

      if (field === "currency") {
        nextForm.currency = value.toUpperCase();
      }

      return nextForm;
    });
  };

  const handleManualTripSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!manualTripForm.origin.trim() || !manualTripForm.destination.trim()) {
      toast.error("Origin and destination are required.");
      return;
    }

    if (!manualTripForm.departure_date) {
      toast.error("Departure date is required.");
      return;
    }

    if (manualTripForm.trip_type === "round_trip" && !manualTripForm.arrival_date) {
      toast.error("Return date is required for a round trip.");
      return;
    }

    setSavingManualTrip(true);
    const isEditing = Boolean(editingTripId);
    const toastId = toast.loading(isEditing ? "Updating trip…" : "Saving trip…");

    try {
      const res = await fetch(
        isEditing
          ? `/api/trips/${encodeURIComponent(editingTripId as string)}`
          : "/api/trips",
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            origin: manualTripForm.origin.trim(),
            destination: manualTripForm.destination.trim(),
            departure_date: manualTripForm.departure_date,
            arrival_date:
              manualTripForm.trip_type === "round_trip"
                ? manualTripForm.arrival_date
                : "",
            airline: manualTripForm.airline.trim(),
            flight_number: manualTripForm.flight_number.trim(),
            trip_type: manualTripForm.trip_type,
            passenger_name: manualTripForm.passenger_name.trim(),
            cabin_class: manualTripForm.cabin_class,
            confirmation_code: manualTripForm.confirmation_code.trim(),
            booking_ref: manualTripForm.booking_ref.trim(),
            ticket_number: manualTripForm.ticket_number.trim(),
            seat_number: manualTripForm.seat_number.trim(),
            ticket_cost: manualTripForm.ticket_cost
              ? Number(manualTripForm.ticket_cost)
              : undefined,
            currency: manualTripForm.currency.trim().toUpperCase() || "USD",
          }),
        },
      );
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.detail ?? (isEditing ? "Failed to update trip." : "Failed to save trip."));
      }

      const tripsRes = await fetch("/api/trips", { cache: "no-store" });
      const tripsData = await tripsRes.json().catch(() => null);
      if (tripsRes.ok && Array.isArray(tripsData?.trips)) {
        setTrips(tripsData.trips);
      }

      setManualTripForm(INITIAL_MANUAL_TRIP_FORM);
      setEditingTripId(null);
      setIsManualModalOpen(false);
      toast.success(isEditing ? "Trip updated." : "Trip added to My Trips.", { id: toastId });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : (editingTripId ? "Failed to update trip." : "Failed to save trip."),
        { id: toastId },
      );
    } finally {
      setSavingManualTrip(false);
    }
  };

  const handleEditTrip = (trip: TripFromApi) => {
    const prompt = [
      "Help me edit my saved trip.",
      `Trip ID: ${trip.id}.`,
      `Current route: ${trip.origin} to ${trip.destination}.`,
      trip.airline ? `Airline: ${trip.airline}.` : null,
      trip.flight_number ? `Flight number: ${trip.flight_number}.` : null,
      trip.trip_type ? `Trip type: ${formatTripType(trip.trip_type)}.` : null,
      trip.passenger_name ? `Passenger name: ${trip.passenger_name}.` : null,
      trip.departure_date ? `Departure: ${trip.departure_date}.` : null,
      trip.arrival_date ? `Return date: ${trip.arrival_date}.` : null,
      trip.cabin_class ? `Cabin class: ${trip.cabin_class}.` : null,
      trip.confirmation_code ? `Confirmation code: ${trip.confirmation_code}.` : null,
      trip.booking_ref ? `Booking reference: ${trip.booking_ref}.` : null,
      trip.ticket_number ? `Ticket number: ${trip.ticket_number}.` : null,
      trip.ticket_cost !== null
        ? `Ticket cost: ${trip.ticket_cost} ${(trip.currency ?? "USD").toUpperCase()}.`
        : null,
      "Ask only for the missing details needed to update this trip in Book With AI.",
    ]
      .filter(Boolean)
      .join(" ");

    router.push(`/chat?q=${encodeURIComponent(prompt)}`);
  };

  const handleTripAssistance = (trip: TripFromApi) => {
    const prompt = [
      `I need help with my saved trip from ${trip.origin} to ${trip.destination}.`,
      trip.airline ? `Airline: ${trip.airline}.` : null,
      trip.flight_number ? `Flight number: ${trip.flight_number}.` : null,
      trip.departure_date ? `Departure: ${trip.departure_date}.` : null,
      trip.confirmation_code
        ? `Confirmation code: ${trip.confirmation_code}.`
        : null,
      "Please assist me with booking, check-in, or travel questions for this trip.",
    ]
      .filter(Boolean)
      .join(" ");

    router.push(`/chat?q=${encodeURIComponent(prompt)}`);
  };

  const handleTogglePause = async (trip: TripFromApi) => {
    const nextStatus = normalizeTripStatus(trip.status) === "paused"
      ? "confirmed"
      : "paused";
    const toastId = toast.loading(
      nextStatus === "paused" ? "Pausing trip…" : "Resuming trip…",
    );

    try {
      const res = await fetch(`/api/trips/${encodeURIComponent(trip.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.detail ?? "Failed to update trip.");
      }

      setTrips((currentTrips) =>
        currentTrips.map((currentTrip) =>
          currentTrip.id === trip.id ? data.trip : currentTrip,
        ),
      );
      toast.success(
        nextStatus === "paused" ? "Trip paused." : "Trip resumed.",
        { id: toastId },
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update trip.",
        { id: toastId },
      );
    }
  };

  const handleDidBook = async (trip: TripFromApi, didBook: boolean) => {
    if (!didBook) {
      toast.message("No problem. You can update this later.");
      router.push(
        `/chat?q=${encodeURIComponent(
          [
            `I have not completed booking yet for my trip from ${trip.origin} to ${trip.destination}.`,
            `Trip ID: ${trip.id}.`,
            trip.airline ? `Airline: ${trip.airline}.` : null,
            trip.departure_date ? `Departure: ${trip.departure_date}.` : null,
            trip.arrival_date ? `Arrival: ${trip.arrival_date}.` : null,
            "Help me with next steps to book and what details I should prepare. If you provide trip details (Departure/Destination/Date/Estimated Price), I'll reply exactly: “save these details in my trip” to save them to my account.",
          ]
            .filter(Boolean)
            .join(" "),
        )}`,
      );
      return;
    }

    if (normalizeTripStatus(trip.status) === "completed") return;

    const toastId = toast.loading("Saving booking confirmation…");
    try {
      const res = await fetch(`/api/trips/${encodeURIComponent(trip.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.detail ?? "Failed to mark trip as completed.");
      }

      setTrips((currentTrips) =>
        currentTrips.map((currentTrip) =>
          currentTrip.id === trip.id ? data.trip : currentTrip,
        ),
      );

      toast.success("Trip marked as completed.", { id: toastId });
      router.push(
        `/chat?q=${encodeURIComponent(
          [
            `I booked this trip from ${trip.origin} to ${trip.destination}.`,
            `Trip ID: ${trip.id}.`,
            trip.airline ? `Airline: ${trip.airline}.` : null,
            trip.departure_date ? `Departure: ${trip.departure_date}.` : null,
            trip.arrival_date ? `Arrival: ${trip.arrival_date}.` : null,
            "Ask for and save any missing booking details (booking reference, confirmation code, ticket number, seat) for this trip in my account. If you provide trip details (Departure/Destination/Date/Estimated Price), I'll reply exactly: “save these details in my trip” to save them to my account.",
          ]
            .filter(Boolean)
            .join(" "),
        )}`,
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save booking.",
        { id: toastId },
      );
    }
  };

  const handleDelete = async (tripId: string) => {
    const toastId = toast.loading("Deleting trip…");
    try {
      const res = await fetch(`/api/trips/${encodeURIComponent(tripId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error("Delete failed");
      }
      setTrips((prev) => prev.filter((trip) => trip.id !== tripId));
      if (expandedId === tripId) {
        setExpandedId(null);
      }
      toast.success("Trip deleted.", { id: toastId });
    } catch {
      toast.error("Failed to delete trip.", { id: toastId });
    }
  };

  const handleCardClick = (id: string, e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-trip-menu]")) return;
    setExpandedId(expandedId === id ? null : id);
  };

  const isLoading = !isLoaded || loadingTrips;

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#F8FAFC] to-[#F1F5F9]">
        <div className="max-w-[1200px] mx-auto px-6 py-8 pb-24 lg:pb-8">
          <div className="rounded-xl border border-[#E5E7EB] bg-white p-8 text-center text-[#6B7280]">
            Loading your trips…
          </div>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <AuthRequiredCard
        title="Log in to view your trips"
        description="My Trips is available only for signed-in users. Once you log in, your saved bookings and AI-created trips will show up here."
        redirectUrl="/my-trips"
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F8FAFC] to-[#F1F5F9]">
      <div className="max-w-[1200px] mx-auto px-6 py-8 pb-24 lg:pb-8">
        <div style={{ animation: "fadeIn 0.5s ease-out" }}>
          <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1
                className="text-[#0A2140] mb-1 sm:mb-2 text-2xl sm:text-[32px]"
                style={{ fontWeight: "700" }}
              >
                My Trips
              </h1>
              <p className="text-[#6B7280] text-sm sm:text-base">
                View and manage your upcoming and past bookings
              </p>
            </div>
            <button
              type="button"
              onClick={handleAddBooking}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1D4ED8] text-white text-sm font-medium hover:bg-[#1E40AF] transition-colors border-none cursor-pointer"
            >
              <Plus className="w-4 h-4" /> Add Trip
            </button>
          </div>

          {isManualModalOpen && (
            <div
              className="fixed inset-0 z-50 bg-[#0F172A]/55 px-4 py-6 sm:px-6 overflow-y-auto"
              onClick={closeManualModal}
            >
              <div className="mx-auto max-w-4xl">
                <form
                  onSubmit={handleManualTripSubmit}
                  onClick={(event) => event.stopPropagation()}
                  className="rounded-[28px] border border-[#D7E3F4] bg-white shadow-[0_30px_90px_rgba(15,23,42,0.18)]"
                >
                  <div className="flex items-start justify-between gap-4 border-b border-[#E5E7EB] px-5 py-5 sm:px-7">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#1D4ED8]">
                        Manual Trip Entry
                      </p>
                      <h2 className="mt-2 text-2xl font-semibold text-[#0A2140]">
                        Add a trip without chat
                      </h2>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6B7280]">
                        Save booking details directly to My Trips. You can still use AI later to edit or add anything missing.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={closeManualModal}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#E5E7EB] bg-white text-[#6B7280] transition-colors hover:border-[#CBD5E1] hover:text-[#111827] cursor-pointer"
                      aria-label="Close manual trip form"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="space-y-6 px-5 py-5 sm:px-7 sm:py-6">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <label className="block">
                        <span className="mb-2 block text-sm font-medium text-[#0A2140]">
                          Passenger name
                        </span>
                        <input
                          type="text"
                          value={manualTripForm.passenger_name}
                          onChange={(event) => handleManualFieldChange("passenger_name", event.target.value)}
                          placeholder="John Doe"
                          className="w-full rounded-xl border border-[#D1D5DB] px-4 py-3 text-sm text-[#111827] outline-none transition-colors focus:border-[#1D4ED8]"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-2 block text-sm font-medium text-[#0A2140]">
                          Origin
                        </span>
                        <input
                          type="text"
                          value={manualTripForm.origin}
                          onChange={(event) => handleManualFieldChange("origin", event.target.value)}
                          placeholder="DEL or New Delhi"
                          className="w-full rounded-xl border border-[#D1D5DB] px-4 py-3 text-sm text-[#111827] outline-none transition-colors focus:border-[#1D4ED8]"
                          required
                        />
                      </label>

                      <label className="block">
                        <span className="mb-2 block text-sm font-medium text-[#0A2140]">
                          Destination
                        </span>
                        <input
                          type="text"
                          value={manualTripForm.destination}
                          onChange={(event) => handleManualFieldChange("destination", event.target.value)}
                          placeholder="DXB or Dubai"
                          className="w-full rounded-xl border border-[#D1D5DB] px-4 py-3 text-sm text-[#111827] outline-none transition-colors focus:border-[#1D4ED8]"
                          required
                        />
                      </label>

                      <label className="block">
                        <span className="mb-2 block text-sm font-medium text-[#0A2140]">
                          Trip type
                        </span>
                        <select
                          value={manualTripForm.trip_type}
                          onChange={(event) => handleManualFieldChange("trip_type", event.target.value)}
                          className="w-full rounded-xl border border-[#D1D5DB] bg-white px-4 py-3 text-sm text-[#111827] outline-none transition-colors focus:border-[#1D4ED8]"
                        >
                          <option value="one_way">One way</option>
                          <option value="round_trip">Round trip</option>
                        </select>
                      </label>

                      <label className="block">
                        <span className="mb-2 block text-sm font-medium text-[#0A2140]">
                          Departure date
                        </span>
                        <input
                          type="date"
                          value={manualTripForm.departure_date}
                          onChange={(event) => handleManualFieldChange("departure_date", event.target.value)}
                          className="w-full rounded-xl border border-[#D1D5DB] px-4 py-3 text-sm text-[#111827] outline-none transition-colors focus:border-[#1D4ED8]"
                          required
                        />
                      </label>

                      <label className="block">
                        <span className="mb-2 block text-sm font-medium text-[#0A2140]">
                          {manualTripForm.trip_type === "round_trip" ? "Return date" : "Arrival date"}
                        </span>
                        <input
                          type="date"
                          value={manualTripForm.arrival_date}
                          onChange={(event) => handleManualFieldChange("arrival_date", event.target.value)}
                          className="w-full rounded-xl border border-[#D1D5DB] px-4 py-3 text-sm text-[#111827] outline-none transition-colors focus:border-[#1D4ED8]"
                          required={manualTripForm.trip_type === "round_trip"}
                        />
                      </label>

                      <label className="block">
                        <span className="mb-2 block text-sm font-medium text-[#0A2140]">
                          Airline
                        </span>
                        <input
                          type="text"
                          value={manualTripForm.airline}
                          onChange={(event) => handleManualFieldChange("airline", event.target.value)}
                          placeholder="Air India"
                          className="w-full rounded-xl border border-[#D1D5DB] px-4 py-3 text-sm text-[#111827] outline-none transition-colors focus:border-[#1D4ED8]"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-2 block text-sm font-medium text-[#0A2140]">
                          Flight number
                        </span>
                        <input
                          type="text"
                          value={manualTripForm.flight_number}
                          onChange={(event) => handleManualFieldChange("flight_number", event.target.value)}
                          placeholder="AI 915"
                          className="w-full rounded-xl border border-[#D1D5DB] px-4 py-3 text-sm text-[#111827] outline-none transition-colors focus:border-[#1D4ED8]"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-2 block text-sm font-medium text-[#0A2140]">
                          Cabin class
                        </span>
                        <select
                          value={manualTripForm.cabin_class}
                          onChange={(event) => handleManualFieldChange("cabin_class", event.target.value)}
                          className="w-full rounded-xl border border-[#D1D5DB] bg-white px-4 py-3 text-sm text-[#111827] outline-none transition-colors focus:border-[#1D4ED8]"
                        >
                          <option value="">Select class</option>
                          <option value="Economy">Economy</option>
                          <option value="Premium Economy">Premium Economy</option>
                          <option value="Business">Business</option>
                          <option value="First">First</option>
                        </select>
                      </label>

                      <label className="block">
                        <span className="mb-2 block text-sm font-medium text-[#0A2140]">
                          Confirmation code
                        </span>
                        <input
                          type="text"
                          value={manualTripForm.confirmation_code}
                          onChange={(event) => handleManualFieldChange("confirmation_code", event.target.value)}
                          placeholder="ABC123"
                          className="w-full rounded-xl border border-[#D1D5DB] px-4 py-3 text-sm text-[#111827] outline-none transition-colors focus:border-[#1D4ED8]"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-2 block text-sm font-medium text-[#0A2140]">
                          Booking reference
                        </span>
                        <input
                          type="text"
                          value={manualTripForm.booking_ref}
                          onChange={(event) => handleManualFieldChange("booking_ref", event.target.value)}
                          placeholder="PNR or booking ref"
                          className="w-full rounded-xl border border-[#D1D5DB] px-4 py-3 text-sm text-[#111827] outline-none transition-colors focus:border-[#1D4ED8]"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-2 block text-sm font-medium text-[#0A2140]">
                          Ticket number
                        </span>
                        <input
                          type="text"
                          value={manualTripForm.ticket_number}
                          onChange={(event) => handleManualFieldChange("ticket_number", event.target.value)}
                          placeholder="0987654321"
                          className="w-full rounded-xl border border-[#D1D5DB] px-4 py-3 text-sm text-[#111827] outline-none transition-colors focus:border-[#1D4ED8]"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-2 block text-sm font-medium text-[#0A2140]">
                          Seat number
                        </span>
                        <input
                          type="text"
                          value={manualTripForm.seat_number}
                          onChange={(event) => handleManualFieldChange("seat_number", event.target.value)}
                          placeholder="12A"
                          className="w-full rounded-xl border border-[#D1D5DB] px-4 py-3 text-sm text-[#111827] outline-none transition-colors focus:border-[#1D4ED8]"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-2 block text-sm font-medium text-[#0A2140]">
                          Ticket amount
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={manualTripForm.ticket_cost}
                          onChange={(event) => handleManualFieldChange("ticket_cost", event.target.value)}
                          placeholder="28500"
                          className="w-full rounded-xl border border-[#D1D5DB] px-4 py-3 text-sm text-[#111827] outline-none transition-colors focus:border-[#1D4ED8]"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-2 block text-sm font-medium text-[#0A2140]">
                          Currency
                        </span>
                        <input
                          type="text"
                          maxLength={6}
                          value={manualTripForm.currency}
                          onChange={(event) => handleManualFieldChange("currency", event.target.value)}
                          placeholder="USD"
                          className="w-full rounded-xl border border-[#D1D5DB] px-4 py-3 text-sm uppercase text-[#111827] outline-none transition-colors focus:border-[#1D4ED8]"
                        />
                      </label>
                    </div>

                    <div className="rounded-2xl border border-[#DBEAFE] bg-[#EFF6FF] px-4 py-4 text-sm leading-6 text-[#1E3A8A]">
                      {editingTripId
                        ? "Want to change this with a prompt instead? You can still use"
                        : "Need to create a trip from a prompt instead? You can still use"}
                      {" "}
                      <button
                        type="button"
                        onClick={() => {
                          setIsManualModalOpen(false);
                          router.push("/my-trips/edit");
                        }}
                        className="font-semibold text-[#1D4ED8] underline decoration-[#93C5FD] underline-offset-4 cursor-pointer bg-transparent border-none p-0"
                      >
                        {editingTripId ? "Use AI to edit trip" : "Add Trip with AI"}
                      </button>
                      {" "}
                      after this.
                    </div>
                  </div>

                  <div className="flex flex-col-reverse gap-3 border-t border-[#E5E7EB] px-5 py-5 sm:flex-row sm:items-center sm:justify-end sm:px-7">
                    <button
                      type="button"
                      onClick={closeManualModal}
                      className="inline-flex items-center justify-center rounded-xl border border-[#D1D5DB] px-4 py-3 text-sm font-medium text-[#4B5563] transition-colors hover:bg-[#F8FAFC] cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={savingManualTrip}
                      className="inline-flex items-center justify-center rounded-xl bg-[#1D4ED8] px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-[#1E40AF] disabled:cursor-not-allowed disabled:opacity-70 cursor-pointer"
                    >
                      {savingManualTrip ? "Saving…" : "Save trip"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {isLoading && (
            <div className="rounded-xl border border-[#E5E7EB] bg-white p-8 text-center text-[#6B7280]">
              Loading your trips…
            </div>
          )}

          {!isLoading && (
            <div className="mb-8">
              <h2
                className="text-[#0A2140] mb-4"
                style={{ fontSize: "20px", fontWeight: "600" }}
              >
                Your trips
              </h2>
              <div className="space-y-4">
                {trips.length === 0 && (
                  <div className="rounded-xl border border-[#E5E7EB] bg-white p-8 text-center text-[#6B7280]">
                    {isSignedIn
                      ? "No trips yet. Add one manually here or use AI and it will be saved directly to your account."
                      : "No trips yet. Create an account when you want to save your bookings and trip history."}
                  </div>
                )}

                {trips.map((trip, idx) => (
                  <div
                    key={trip.id}
                    onClick={(e) => handleCardClick(trip.id, e)}
                    className="relative bg-white rounded-xl border border-[#E5E7EB] hover:border-[#D1D5DB] transition-all cursor-pointer animate-slide-up"
                    style={{ animationDelay: `${idx * 0.05}s` }}
                  >
                    <div className="p-4 sm:p-6">
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4 mb-4">
                        <div className="flex-1">
                          <h3
                            className="text-[#0A2140] mb-1"
                            style={{ fontSize: "18px", fontWeight: "600" }}
                          >
                            {trip.origin} → {trip.destination}
                          </h3>
                          <p className="text-[#6B7280] text-sm">
                            {[trip.airline, trip.flight_number].filter(Boolean).join(" • ") || "—"}
                          </p>
                        </div>

                        <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto border-t sm:border-0 border-[#E5E7EB] pt-3 sm:pt-0 mt-1 sm:mt-0">
                          <span
                            className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusPillClass(trip.status)}`}
                          >
                            {formatStatusLabel(trip.status)}
                          </span>

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                data-trip-menu
                                onClick={(e) => e.stopPropagation()}
                                className="h-9 w-9 p-0 text-[#9CA3AF] hover:text-[#374151] hover:bg-[#F3F4F6] rounded-md inline-flex items-center justify-center transition-colors cursor-pointer border-none bg-transparent"
                              >
                                <MoreVertical className="w-5 h-5 text-[#9CA3AF]" />
                                <span className="sr-only">Open trip menu</span>
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align="end"
                              className="w-48 bg-white border-[#E5E7EB] shadow-lg rounded-md p-1 z-50"
                            >
                              <DropdownMenuItem
                                className="flex items-center gap-2 cursor-pointer text-[#374151] hover:bg-[#F3F4F6] px-2 py-1.5 rounded-sm outline-none"
                                onSelect={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleTogglePause(trip);
                                }}
                              >
                                {normalizeTripStatus(trip.status) === "paused" ? (
                                  <Play className="w-4 h-4" />
                                ) : (
                                  <Pause className="w-4 h-4" />
                                )}
                                {normalizeTripStatus(trip.status) === "paused"
                                  ? "Resume trip"
                                  : "Pause trip"}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="flex items-center gap-2 cursor-pointer text-[#374151] hover:bg-[#F3F4F6] px-2 py-1.5 rounded-sm outline-none"
                                onSelect={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleManualEditTrip(trip);
                                }}
                              >
                                <Pencil className="w-4 h-4" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="flex items-center gap-2 cursor-pointer text-[#374151] hover:bg-[#F3F4F6] px-2 py-1.5 rounded-sm outline-none"
                                onSelect={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleTripAssistance(trip);
                                }}
                              >
                                <CircleHelp className="w-4 h-4" />
                                Assistance
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="flex items-center gap-2 cursor-pointer text-[#DC2626] hover:bg-[#FEE2E2] hover:text-[#DC2626] px-2 py-1.5 rounded-sm outline-none"
                                onSelect={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleDelete(trip.id);
                                }}
                              >
                                <Trash2 className="w-4 h-4" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <p
                            className="text-xs text-[#9CA3AF] mb-1"
                            style={{ fontWeight: "500" }}
                          >
                            Departure
                          </p>
                          <p
                            className="text-[#374151] text-sm"
                            style={{ fontWeight: "500" }}
                          >
                            {formatDate(trip.departure_date)}
                          </p>
                        </div>
                        <div>
                          <p
                            className="text-xs text-[#9CA3AF] mb-1"
                            style={{ fontWeight: "500" }}
                          >
                            Class
                          </p>
                          <p
                            className="text-[#374151] text-sm"
                            style={{ fontWeight: "500" }}
                          >
                            {trip.cabin_class || "—"}
                          </p>
                        </div>
                        <div>
                          <p
                            className="text-xs text-[#9CA3AF] mb-1"
                            style={{ fontWeight: "500" }}
                          >
                            Trip type
                          </p>
                          <p
                            className="text-[#374151] text-sm"
                            style={{ fontWeight: "500" }}
                          >
                            {formatTripType(trip.trip_type)}
                          </p>
                        </div>
                        <div>
                          <p
                            className="text-xs text-[#9CA3AF] mb-1"
                            style={{ fontWeight: "500" }}
                          >
                            Cost
                          </p>
                          <p
                            className="text-[#374151] text-sm"
                            style={{ fontWeight: "500" }}
                          >
                            {trip.ticket_cost != null
                              ? `${trip.currency === "INR" ? "₹" : trip.currency === "USD" ? "$" : trip.currency ? `${trip.currency} ` : "$"}${trip.ticket_cost.toLocaleString("en-US")}`
                              : "—"}
                          </p>
                        </div>
                      </div>
                    </div>

                    {expandedId === trip.id && (
                      <div className="border-t border-[#E5E7EB] px-4 sm:px-6 py-4 sm:py-5 bg-[#FAFAFA]">
                        {normalizeTripStatus(trip.status) !== "completed" &&
                          normalizeTripStatus(trip.status) !== "cancelled" && (
                            <div className="mb-4 rounded-xl border border-[#DBEAFE] bg-white p-4">
                              <p className="text-[#0A2140] text-sm font-semibold mb-2">
                                Did you book this trip?
                              </p>
                              <div className="flex flex-col sm:flex-row gap-2">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    void handleDidBook(trip, true);
                                  }}
                                  className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-[#1D4ED8] hover:bg-[#1E40AF] disabled:opacity-50 border-none cursor-pointer"
                                >
                                  Yes
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    void handleDidBook(trip, false);
                                  }}
                                  className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6] border border-[#E5E7EB] cursor-pointer"
                                >
                                  Not yet
                                </button>
                              </div>
                            </div>
                          )}
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-y-5 gap-x-4">
                          <div>
                            <p
                              className="text-xs text-[#9CA3AF] mb-1"
                              style={{ fontWeight: "500" }}
                            >
                              Passenger
                            </p>
                            <p
                              className="text-[#0A2140] text-sm"
                              style={{ fontWeight: "600" }}
                            >
                              {trip.passenger_name || "—"}
                            </p>
                          </div>
                          <div>
                            <p
                              className="text-xs text-[#9CA3AF] mb-1"
                              style={{ fontWeight: "500" }}
                            >
                              Flight number
                            </p>
                            <p
                              className="text-[#0A2140] text-sm font-mono"
                              style={{ fontWeight: "600" }}
                            >
                              {trip.flight_number || "—"}
                            </p>
                          </div>
                          <div>
                            <p
                              className="text-xs text-[#9CA3AF] mb-1"
                              style={{ fontWeight: "500" }}
                            >
                              Trip type
                            </p>
                            <p
                              className="text-[#0A2140] text-sm"
                              style={{ fontWeight: "600" }}
                            >
                              {formatTripType(trip.trip_type)}
                            </p>
                          </div>
                          <div>
                            <p
                              className="text-xs text-[#9CA3AF] mb-1"
                              style={{ fontWeight: "500" }}
                            >
                              Booking reference
                            </p>
                            <p
                              className="text-[#0A2140] text-sm font-mono"
                              style={{ fontWeight: "600" }}
                            >
                              {trip.booking_ref || "—"}
                            </p>
                          </div>
                          <div>
                            <p
                              className="text-xs text-[#9CA3AF] mb-1"
                              style={{ fontWeight: "500" }}
                            >
                              Confirmation code
                            </p>
                            <p
                              className="text-[#0A2140] text-sm font-mono"
                              style={{ fontWeight: "600" }}
                            >
                              {trip.confirmation_code || "—"}
                            </p>
                          </div>
                          <div>
                            <p
                              className="text-xs text-[#9CA3AF] mb-1"
                              style={{ fontWeight: "500" }}
                            >
                              Ticket number
                            </p>
                            <p
                              className="text-[#0A2140] text-sm font-mono"
                              style={{ fontWeight: "600" }}
                            >
                              {trip.ticket_number || "—"}
                            </p>
                          </div>
                          <div>
                            <p
                              className="text-xs text-[#9CA3AF] mb-1"
                              style={{ fontWeight: "500" }}
                            >
                              Seat
                            </p>
                            <p
                              className="text-[#0A2140] text-sm"
                              style={{ fontWeight: "600" }}
                            >
                              {trip.seat_number || "—"}
                            </p>
                          </div>
                          <div>
                            <p
                              className="text-xs text-[#9CA3AF] mb-1"
                              style={{ fontWeight: "500" }}
                            >
                              Departure
                            </p>
                            <p
                              className="text-[#0A2140] text-sm"
                              style={{ fontWeight: "600" }}
                            >
                              {formatDate(trip.departure_date)} {formatTime(trip.departure_date)}
                            </p>
                          </div>
                          <div>
                            <p
                              className="text-xs text-[#9CA3AF] mb-1"
                              style={{ fontWeight: "500" }}
                            >
                              {trip.trip_type === "round_trip" ? "Return" : "Arrival"}
                            </p>
                            <p
                              className="text-[#0A2140] text-sm"
                              style={{ fontWeight: "600" }}
                            >
                              {formatDate(trip.arrival_date)} {formatTime(trip.arrival_date)}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
