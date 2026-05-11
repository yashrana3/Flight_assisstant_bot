import { NextRequest } from "next/server";

import { proxyToBackend } from "@/lib/backend-proxy";

type RouteContext = {
  params: Promise<{
    alertId: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { alertId } = await context.params;
  return proxyToBackend(
    request,
    `/api/price-alerts/${encodeURIComponent(alertId)}/ai-edit`,
    { requireAuth: true },
  );
}
