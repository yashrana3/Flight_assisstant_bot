import { NextRequest, NextResponse } from "next/server";

import { getRealtimeData } from "@/backend/admin-data";
import { getRouteError } from "@/backend/admin-api";
import { getRangeDaysFromRequest } from "@/app/api/admin/_range";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const rangeDays = getRangeDaysFromRequest(request);

  try {
    return NextResponse.json(await getRealtimeData(rangeDays));
  } catch (err) {
    const { status, detail } = getRouteError(err);
    console.error("[admin-realtime-route] failed", {
      rangeDays,
      status,
      detail,
      error: err instanceof Error ? err.stack ?? err.message : String(err),
    });
    return NextResponse.json({ detail }, { status });
  }
}
