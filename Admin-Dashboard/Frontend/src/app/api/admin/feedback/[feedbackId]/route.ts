import { NextRequest, NextResponse } from "next/server";

import { getRouteError } from "@/backend/admin-api";
import { getFeedbackDetailData, updateFeedbackStatus } from "@/backend/admin-data";
import type { UiFeedbackStatus } from "@/lib/admin-types";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ feedbackId: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { feedbackId } = await context.params;
    return NextResponse.json(await getFeedbackDetailData(feedbackId));
  } catch (err) {
    const { status, detail } = getRouteError(err);
    return NextResponse.json({ detail }, { status });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { feedbackId } = await context.params;
    const body = (await request.json()) as { status?: UiFeedbackStatus };

    if (!body.status) {
      return NextResponse.json(
        { detail: "status is required." },
        { status: 400 },
      );
    }

    return NextResponse.json(await updateFeedbackStatus(feedbackId, body.status));
  } catch (err) {
    const { status, detail } = getRouteError(err);
    return NextResponse.json({ detail }, { status });
  }
}
