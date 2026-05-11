import { NextRequest, NextResponse } from "next/server";

import { randomUUID } from "crypto";

import { getCurrentDbUser } from "@/lib/current-db-user";
import { prisma } from "@/lib/prisma";
import { recomputeTravelStatsForUser } from "@/lib/travel-stats";

import {
  buildRecommendationMessage,
  buildLoyaltyProgramMetadata,
  loyaltyProgramSchema,
  LoyaltyProgramMetadata,
  parseLoyaltyProgramMetadata,
  toNullableTrimmedString,
} from "./shared";

type LoyaltyProgramRow = {
  id: string;
  user_id: string;
  airline_name: string | null;
  program_name: string | null;
  member_number: string | null;
  current_miles: number | null;
  tier_status: string | null;
  next_tier: string | null;
  miles_to_next_tier: number | null;
  metadata: unknown;
  created_at: Date | null;
  updated_at: Date | null;
};

function serializeProgram(program: LoyaltyProgramRow) {
  const metadata: LoyaltyProgramMetadata = parseLoyaltyProgramMetadata(program.metadata);
  return {
    id: program.id,
    user_id: program.user_id,
    airline: program.airline_name ?? "",
    program_name: program.program_name ?? "",
    member_number: program.member_number ?? "",
    current_miles: program.current_miles ?? 0,
    tier_status: program.tier_status ?? "",
    next_tier: program.next_tier ?? "",
    miles_to_next_tier: program.miles_to_next_tier ?? 0,
    created_at: program.created_at,
    updated_at: program.updated_at,
    ...metadata,
  };
}

export async function GET() {
  const currentDbUser = await getCurrentDbUser({ createIfMissing: true });
  if (!currentDbUser) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  try {
    const programs = await prisma.$queryRaw<LoyaltyProgramRow[]>`
      SELECT
        id,
        user_id,
        airline_name,
        program_name,
        member_number,
        current_miles,
        tier_status,
        next_tier,
        miles_to_next_tier,
        metadata,
        created_at,
        updated_at
      FROM loyalty_programs
      WHERE user_id = ${currentDbUser.id}
      ORDER BY created_at DESC
    `;
    return NextResponse.json({ programs: programs.map((program) => serializeProgram(program)) });
  } catch (err) {
    console.error("GET /api/loyalty/programs error:", err);
    return NextResponse.json(
      { detail: "Failed to load loyalty programs." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const currentDbUser = await getCurrentDbUser({ createIfMissing: true });
  if (!currentDbUser) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = loyaltyProgramSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { detail: parsed.error.errors[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const payload = parsed.data;
    const airline = payload.airline.trim();
    const programName = payload.program_name.trim();
    const memberNumber = payload.member_number.trim();
    const tierStatus = payload.tier_status.trim();
    const nextTier = payload.next_tier.trim();
    const milesToNextTier = payload.miles_to_next_tier ?? 0;
    const now = new Date();

    if (tierStatus === nextTier) {
      return NextResponse.json(
        { detail: "Choose a different tier to upgrade to." },
        { status: 400 },
      );
    }

    const recommendation = buildRecommendationMessage({
      tierStatus,
      nextTier,
      milesToNextTier,
      plannedOrigin: toNullableTrimmedString(payload.planned_origin),
      plannedDestination: toNullableTrimmedString(payload.planned_destination),
      plannedFlightNumber: toNullableTrimmedString(payload.planned_flight_number),
    });
    const metadata = buildLoyaltyProgramMetadata({
      planned_origin: toNullableTrimmedString(payload.planned_origin),
      planned_destination: toNullableTrimmedString(payload.planned_destination),
      planned_flight_number: toNullableTrimmedString(payload.planned_flight_number),
      traveler_name: toNullableTrimmedString(payload.traveler_name),
      traveler_email: toNullableTrimmedString(payload.traveler_email),
      traveler_phone: toNullableTrimmedString(payload.traveler_phone),
      notes: toNullableTrimmedString(payload.notes),
      recommendation_message: recommendation,
    });

    const program = await prisma.$transaction(async (tx) => {
      const createdId = randomUUID();

      await tx.$executeRaw`
        INSERT INTO loyalty_programs
          (id, user_id, airline_name, program_name, member_number, member_number_last4, current_miles, tier_status, next_tier, miles_to_next_tier, metadata, created_at, updated_at)
        VALUES
          (${createdId}, ${currentDbUser.id}, ${airline}, ${programName}, ${memberNumber}, ${memberNumber.slice(-4) || null}, ${payload.current_miles}, ${tierStatus}, ${nextTier}, ${milesToNextTier}, ${JSON.stringify(metadata)}::jsonb, ${now}, ${now})
      `;

      await tx.$executeRaw`
        INSERT INTO loyalty_activities
          (id, user_id, program_id, activity_date, description, activity_type, miles_change, balance_after, metadata, created_at, updated_at)
        VALUES
          (${randomUUID()}, ${currentDbUser.id}, ${createdId}, ${now}, ${`Saved ${programName} membership details`}, ${"EARNED"}::"LoyaltyActivityType", ${0}, ${payload.current_miles}, ${JSON.stringify({ source: "frontend.loyalty.programs.post" })}::jsonb, ${now}, ${now})
      `;

      const rows = await tx.$queryRaw<LoyaltyProgramRow[]>`
        SELECT
          id,
          user_id,
          airline_name,
          program_name,
          member_number,
          current_miles,
          tier_status,
          next_tier,
          miles_to_next_tier,
          metadata,
          created_at,
          updated_at
        FROM loyalty_programs
        WHERE id = ${createdId}
        LIMIT 1
      `;

      return rows[0];
    });

    await recomputeTravelStatsForUser(currentDbUser.id);
    return NextResponse.json({ program: serializeProgram(program) }, { status: 201 });
  } catch (err) {
    console.error("POST /api/loyalty/programs error:", err);
    return NextResponse.json(
      { detail: "Failed to save loyalty program." },
      { status: 500 },
    );
  }
}
