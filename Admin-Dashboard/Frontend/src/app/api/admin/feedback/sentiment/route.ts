import { NextResponse } from "next/server";

import { getFeedbackSentimentData } from "@/backend/admin-data";
import { getRouteError } from "@/backend/admin-api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getFeedbackSentimentData());
  } catch (err) {
    const { status, detail } = getRouteError(err);
    return NextResponse.json({ detail }, { status });
  }
}
