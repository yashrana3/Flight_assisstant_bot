import { NextRequest } from "next/server";

import { proxyToBackend } from "@/lib/backend-proxy";
import { getCurrentDbUser } from "@/lib/current-db-user";
import { recomputeTravelStatsForUser } from "@/lib/travel-stats";

type RouteContext = {
  params: Promise<{
    tripId: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { tripId } = await context.params;
  const response = await proxyToBackend(
    request,
    `/api/trips/${encodeURIComponent(tripId)}/ai-edit`,
    { requireAuth: true },
  );
  if (response.ok) {
    const currentDbUser = await getCurrentDbUser({ createIfMissing: true });
    if (currentDbUser) {
      await recomputeTravelStatsForUser(currentDbUser.id);
    }
  }
  return response;
}
