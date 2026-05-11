import { NextRequest, NextResponse } from "next/server";

import { getBehaviorPageData } from "@/backend/admin-data";
import { getRouteError } from "@/backend/admin-api";
import { getRangeDaysFromRequest } from "@/app/api/admin/_range";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const rangeDays = getRangeDaysFromRequest(request);
    return NextResponse.json(await getBehaviorPageData(rangeDays));
  } catch (err) {
    const { status, detail } = getRouteError(err);
    return NextResponse.json({ detail }, { status });
  }
}
