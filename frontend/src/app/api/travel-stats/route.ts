import { NextResponse } from "next/server";

import { getCurrentDbUser } from "@/lib/current-db-user";
import { recomputeTravelStatsForUser } from "@/lib/travel-stats";

export async function GET() {
  const currentDbUser = await getCurrentDbUser({ createIfMissing: true });
  if (!currentDbUser) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = await recomputeTravelStatsForUser(currentDbUser.id);
    return NextResponse.json(payload);
  } catch (err) {
    console.error("GET /api/travel-stats error:", err);
    return NextResponse.json(
      { detail: "Failed to load travel stats." },
      { status: 500 },
    );
  }
}

