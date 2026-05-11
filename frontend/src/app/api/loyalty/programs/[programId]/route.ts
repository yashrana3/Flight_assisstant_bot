import { NextRequest, NextResponse } from "next/server";

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
} from "../shared";

type RouteContext = {
  params: Promise<{
    programId: string;
  }>;
};

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

export async function PATCH(request: NextRequest, context: RouteContext) {
  const currentDbUser = await getCurrentDbUser({ createIfMissing: true });
  if (!currentDbUser) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const { programId } = await context.params;

  try {
    const rows = await prisma.$queryRaw<LoyaltyProgramRow[]>`
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
      WHERE id = ${programId} AND user_id = ${currentDbUser.id}
      LIMIT 1
    `;
    const existingProgram = rows[0];

    if (!existingProgram) {
      return NextResponse.json({ detail: "Program not found." }, { status: 404 });
    }

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
    const existingMetadata = parseLoyaltyProgramMetadata(existingProgram.metadata);

    if (tierStatus === nextTier) {
      return NextResponse.json(
        { detail: "Choose a different tier to upgrade to." },
        { status: 400 },
      );
    }

    const milesToNextTier =
      payload.miles_to_next_tier ?? existingProgram.miles_to_next_tier;
    const plannedOrigin =
      payload.planned_origin === undefined
        ? existingMetadata.planned_origin
        : toNullableTrimmedString(payload.planned_origin);
    const plannedDestination =
      payload.planned_destination === undefined
        ? existingMetadata.planned_destination
        : toNullableTrimmedString(payload.planned_destination);
    const plannedFlightNumber =
      payload.planned_flight_number === undefined
        ? existingMetadata.planned_flight_number
        : toNullableTrimmedString(payload.planned_flight_number);

    const recommendation = buildRecommendationMessage({
      tierStatus,
      nextTier,
      milesToNextTier,
      plannedOrigin,
      plannedDestination,
      plannedFlightNumber,
    });
    const metadata = buildLoyaltyProgramMetadata({
      planned_origin: plannedOrigin,
      planned_destination: plannedDestination,
      planned_flight_number: plannedFlightNumber,
      traveler_name:
        payload.traveler_name === undefined
          ? existingMetadata.traveler_name
          : toNullableTrimmedString(payload.traveler_name),
      traveler_email:
        payload.traveler_email === undefined
          ? existingMetadata.traveler_email
          : toNullableTrimmedString(payload.traveler_email),
      traveler_phone:
        payload.traveler_phone === undefined
          ? existingMetadata.traveler_phone
          : toNullableTrimmedString(payload.traveler_phone),
      notes:
        payload.notes === undefined
          ? existingMetadata.notes
          : toNullableTrimmedString(payload.notes),
      recommendation_message: recommendation,
    });

    const updatedAt = new Date();

    await prisma.$executeRaw`
      UPDATE loyalty_programs
      SET
        airline_name = ${airline},
        program_name = ${programName},
        member_number = ${memberNumber},
        member_number_last4 = ${memberNumber.slice(-4) || null},
        current_miles = ${payload.current_miles},
        tier_status = ${tierStatus},
        next_tier = ${nextTier},
        miles_to_next_tier = ${milesToNextTier},
        metadata = ${JSON.stringify(metadata)}::jsonb,
        updated_at = ${updatedAt}
      WHERE id = ${programId} AND user_id = ${currentDbUser.id}
    `;

    const updatedRows = await prisma.$queryRaw<LoyaltyProgramRow[]>`
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
      WHERE id = ${programId} AND user_id = ${currentDbUser.id}
      LIMIT 1
    `;
    const program = updatedRows[0];

    await recomputeTravelStatsForUser(currentDbUser.id);
    return NextResponse.json({ program: serializeProgram(program) });
  } catch (err) {
    console.error("PATCH /api/loyalty/programs/[programId] error:", err);
    return NextResponse.json(
      { detail: "Failed to update loyalty program." },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const currentDbUser = await getCurrentDbUser({ createIfMissing: true });
  if (!currentDbUser) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const { programId } = await context.params;

  try {
    const result = await prisma.loyaltyProgram.deleteMany({
      where: {
        id: programId,
        user_id: currentDbUser.id,
      },
    });

    if (result.count === 0) {
      return NextResponse.json({ detail: "Program not found." }, { status: 404 });
    }

    await recomputeTravelStatsForUser(currentDbUser.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/loyalty/programs/[programId] error:", err);
    return NextResponse.json(
      { detail: "Failed to delete loyalty program." },
      { status: 500 },
    );
  }
}
