import { NextRequest, NextResponse } from "next/server";

import { getCurrentDbUser } from "@/lib/current-db-user";
import { prisma } from "@/lib/prisma";

type LoyaltyActivityRow = {
  id: string;
  activity_date: Date | null;
  description: string | null;
  activity_type: string | null;
  miles_change: number | null;
  balance_after: number | null;
};

export async function GET(request: NextRequest) {
  const currentDbUser = await getCurrentDbUser({ createIfMissing: true });
  if (!currentDbUser) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const programId = request.nextUrl.searchParams.get("program_id")?.trim();
  const limitRaw = request.nextUrl.searchParams.get("limit");
  const parsedLimit = Number(limitRaw ?? "5");
  const limit = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.min(parsedLimit, 20))
    : 5;

  if (!programId) {
    return NextResponse.json(
      { detail: "program_id query parameter is required" },
      { status: 400 },
    );
  }

  try {
    const program = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM loyalty_programs
      WHERE id = ${programId} AND user_id = ${currentDbUser.id}
      LIMIT 1
    `;

    if (program.length === 0) {
      return NextResponse.json({ detail: "Program not found" }, { status: 404 });
    }

    const activities = await prisma.$queryRaw<LoyaltyActivityRow[]>`
      SELECT
        id,
        activity_date,
        description,
        activity_type::text AS activity_type,
        miles_change,
        balance_after
      FROM loyalty_activities
      WHERE user_id = ${currentDbUser.id} AND program_id = ${programId}
      ORDER BY activity_date DESC, created_at DESC
      LIMIT ${limit}
    `;

    return NextResponse.json({
      activities: activities.map((a) => ({
        id: a.id,
        date: a.activity_date,
        description: a.description,
        type: (a.activity_type ?? "EARNED").toLowerCase(),
        miles: a.miles_change ?? 0,
        balance: a.balance_after ?? 0,
      })),
    });
  } catch (err) {
    console.error("GET /api/loyalty/activities error:", err);
    return NextResponse.json(
      { detail: "Failed to load loyalty activities." },
      { status: 500 },
    );
  }
}
