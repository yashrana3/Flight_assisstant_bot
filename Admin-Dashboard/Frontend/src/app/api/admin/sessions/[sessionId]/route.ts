import { NextRequest, NextResponse } from "next/server";

import { getAdminSessionDetail, getRouteError } from "@/backend/admin-api";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { sessionId } = await context.params;
    return NextResponse.json(await getAdminSessionDetail(sessionId));
  } catch (err) {
    const { status, detail } = getRouteError(err);
    return NextResponse.json({ detail }, { status });
  }
}
