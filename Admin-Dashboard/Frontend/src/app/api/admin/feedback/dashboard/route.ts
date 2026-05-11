import { NextResponse } from "next/server";

import { getFeedbackDashboardData } from "@/backend/admin-data";
import { getRouteError } from "@/backend/admin-api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getFeedbackDashboardData());
  } catch (err) {
    const { status, detail } = getRouteError(err);
    return NextResponse.json({ detail }, { status });
  }
}
