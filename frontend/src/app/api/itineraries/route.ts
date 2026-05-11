import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { getCurrentDbUser } from "@/lib/current-db-user";

const itineraryDaySchema = z.object({
  day: z.string().min(1),
  title: z.string().min(1),
  agenda: z.string().min(1),
  estimated_budget_inr: z.string().min(1).optional(),
});

const itineraryDetailsSchema = z.object({
  days: z.array(itineraryDaySchema).optional().default([]),
  flights: z
    .array(
      z.object({
        from: z.string().min(1),
        to: z.string().min(1),
        date: z.string().min(1),
        airline: z.string().min(1),
        flightNumber: z.string().min(1),
      }),
    )
    .optional()
    .default([]),
  hotels: z
    .array(
      z.object({
        name: z.string().min(1),
        location: z.string().min(1),
        checkIn: z.string().min(1),
        checkOut: z.string().min(1),
      }),
    )
    .optional()
    .default([]),
  activities: z.array(z.string().min(1)).optional().default([]),
  source: z.string().optional(),
  budget_inr: z.number().nullable().optional(),
});

const itineraryCreateSchema = z.object({
  title: z.string().min(1).max(200),
  type: z.string().min(1).max(50),
  dateRange: z.string().max(100).nullable().optional(),
  duration: z.string().max(50).nullable().optional(),
  destinations: z.array(z.string().min(1)).min(1),
  flights: z.number().int().nonnegative().optional().default(0),
  hotels: z.number().int().nonnegative().optional().default(0),
  activities: z.number().int().nonnegative().optional().default(0),
  status: z.string().max(20).nullable().optional(),
  aiSuggestion: z.string().nullable().optional(),
  details: itineraryDetailsSchema.optional().default({
    days: [],
    flights: [],
    hotels: [],
    activities: [],
  }),
});

type ItineraryDetails = z.infer<typeof itineraryDetailsSchema>;

type ItineraryRow = {
  id: string;
  title: string;
  itinerary_type: string;
  status: string;
  start_date: Date | null;
  end_date: Date | null;
  duration_days: number | null;
  destination_labels: string[] | null;
  ai_suggestion: string | null;
  metadata: unknown;
  created_at: Date | null;
  updated_at: Date | null;
};

type ItineraryMetadata = {
  flights?: number;
  hotels?: number;
  activities?: number;
  daysCount?: number;
  dateRangeRaw?: string | null;
  durationRaw?: string | null;
  details?: unknown;
};

const EMPTY_ITINERARY_DETAILS: ItineraryDetails = {
  days: [],
  flights: [],
  hotels: [],
  activities: [],
};

function parseJsonValue<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseItineraryMetadata(value: unknown): ItineraryMetadata {
  if (!value) return {};
  if (typeof value === "string") {
    return parseJsonValue<ItineraryMetadata>(value, {});
  }
  if (typeof value === "object") {
    return value as ItineraryMetadata;
  }
  return {};
}

function normalizeItineraryDetails(value: unknown): ItineraryDetails {
  if (typeof value === "string") {
    return normalizeItineraryDetails(parseJsonValue(value, {}));
  }

  const parsed = itineraryDetailsSchema.safeParse(value ?? {});
  if (parsed.success) {
    return parsed.data;
  }

  return EMPTY_ITINERARY_DETAILS;
}

function formatEnumLabel(value: string | null | undefined): string {
  const normalized = (value ?? "").trim();
  if (!normalized) return "Saved";

  return normalized
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function extractDurationDays(value: string | null | undefined): number | null {
  const normalized = (value ?? "").trim();
  if (!normalized) return null;

  const match = normalized.match(/(\d{1,2})/);
  if (!match) return null;

  return Number(match[1]);
}

function serializeItineraryRow(row: ItineraryRow) {
  const metadata = parseItineraryMetadata(row.metadata);
  const details = normalizeItineraryDetails(metadata.details);
  const daysCount = details.days.length || Number(metadata.daysCount ?? 0);
  const dateRangeRaw =
    typeof metadata.dateRangeRaw === "string" ? metadata.dateRangeRaw : null;
  const durationRaw =
    typeof metadata.durationRaw === "string" ? metadata.durationRaw : null;
  const flights = Number(metadata.flights ?? details.flights.length ?? 0);
  const hotels = Number(metadata.hotels ?? details.hotels.length ?? 0);
  const activities = Number(metadata.activities ?? details.activities.length ?? 0);

  return {
    id: row.id,
    title: row.title,
    type: formatEnumLabel(row.itinerary_type),
    dateRange:
      row.start_date && row.end_date
        ? `${row.start_date.toISOString().slice(0, 10)} to ${row.end_date.toISOString().slice(0, 10)}`
        : dateRangeRaw ?? "—",
    duration:
      row.duration_days
        ? `${row.duration_days} days`
        : durationRaw ?? (daysCount > 0 ? `${daysCount} days` : "—"),
    destinations: row.destination_labels ?? [],
    flights,
    hotels,
    activities,
    daysCount,
    status: formatEnumLabel(row.status),
    aiSuggestion: row.ai_suggestion ?? "",
    details,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET() {
  let currentDbUser = null;
  try {
    currentDbUser = await getCurrentDbUser({ createIfMissing: true });
  } catch {
    currentDbUser = null;
  }

  if (!currentDbUser) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const rows = await prisma.$queryRaw<Array<ItineraryRow>>`
    SELECT id, title, itinerary_type::text AS itinerary_type, status::text AS status, start_date, end_date, duration_days, destination_labels, ai_suggestion, metadata, created_at, updated_at
    FROM itineraries
    WHERE user_id = ${currentDbUser.id}
    ORDER BY created_at DESC
  `;

  return NextResponse.json({
    itineraries: rows.map((row) => serializeItineraryRow(row)),
  });
}

export async function POST(request: NextRequest) {
  let currentDbUser = null;
  try {
    currentDbUser = await getCurrentDbUser({ createIfMissing: true });
  } catch {
    currentDbUser = null;
  }

  if (!currentDbUser) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = itineraryCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { detail: parsed.error.errors[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const payload = parsed.data;
    const details = normalizeItineraryDetails(payload.details);
    const now = new Date();
    const createdId = randomUUID();
    const durationDays =
      extractDurationDays(payload.duration) ??
      (details.days.length > 0 ? details.days.length : null);
    const metadata = {
      flights: payload.flights,
      hotels: payload.hotels,
      activities: payload.activities,
      daysCount: details.days.length,
      details,
      dateRangeRaw: payload.dateRange ?? null,
      durationRaw: payload.duration ?? null,
    };

    const itineraryType = "TRIP_PLAN";
    const itineraryStatus = "SAVED";

    await prisma.$executeRaw`
      INSERT INTO itineraries
      (id, user_id, title, itinerary_type, status, start_date, end_date, duration_days, destination_labels, ai_suggestion, metadata, created_at, updated_at)
      VALUES
      (${createdId}, ${currentDbUser.id}, ${payload.title}, ${itineraryType}::"ItineraryType", ${itineraryStatus}::"ItineraryStatus", ${null}, ${null}, ${durationDays}, ${payload.destinations}, ${payload.aiSuggestion ?? null}, ${JSON.stringify(metadata)}::jsonb, ${now}, ${now})
    `;

    const [created] = await prisma.$queryRaw<Array<ItineraryRow>>`
      SELECT id, title, itinerary_type::text AS itinerary_type, status::text AS status, start_date, end_date, duration_days, destination_labels, ai_suggestion, metadata, created_at, updated_at
      FROM itineraries
      WHERE id = ${createdId}
      LIMIT 1
    `;

    return NextResponse.json({
      itinerary: serializeItineraryRow(created),
    });
  } catch (err) {
    console.error("POST /api/itineraries error:", err);
    return NextResponse.json(
      { detail: "Failed to save itinerary." },
      { status: 500 },
    );
  }
}
