import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getCurrentDbUser } from "@/lib/current-db-user";

type RouteContext = {
  params: Promise<{
    itineraryId: string;
  }>;
};

export async function DELETE(_request: NextRequest, context: RouteContext) {
  let currentDbUser = null;
  try {
    currentDbUser = await getCurrentDbUser({ createIfMissing: true });
  } catch {
    currentDbUser = null;
  }

  if (!currentDbUser) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const { itineraryId } = await context.params;

  try {
    const result = await prisma.$executeRaw`
      DELETE FROM itineraries
      WHERE id = ${itineraryId} AND user_id = ${currentDbUser.id}
    `;

    if (result === 0) {
      return NextResponse.json({ detail: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error("DELETE /api/itineraries error:", err);
    return NextResponse.json(
      { detail: "Failed to delete itinerary." },
      { status: 500 },
    );
  }
}
