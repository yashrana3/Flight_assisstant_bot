import { NextRequest } from "next/server";

import { proxyToBackend } from "@/lib/backend-proxy";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { sessionId } = await context.params;
  return proxyToBackend(request, `/api/sessions/${encodeURIComponent(sessionId)}`, {
    requireAuth: true,
  });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { sessionId } = await context.params;
  return proxyToBackend(request, `/api/sessions/${encodeURIComponent(sessionId)}`, {
    requireAuth: true,
  });
}
