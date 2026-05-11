import { NextRequest } from "next/server";

import { proxyToBackend } from "@/lib/backend-proxy";
import { getCurrentDbUser } from "@/lib/current-db-user";
import { recomputeTravelStatsForUser } from "@/lib/travel-stats";

type RouteContext = {
  params: Promise<{
    tripId: string;
  }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { tripId } = await context.params;
  return proxyToBackend(request, `/api/trips/${encodeURIComponent(tripId)}`, {
    requireAuth: true,
  });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { tripId } = await context.params;
  const response = await proxyToBackend(request, `/api/trips/${encodeURIComponent(tripId)}`, {
    requireAuth: true,
  });
  if (response.ok) {
    const currentDbUser = await getCurrentDbUser({ createIfMissing: true });
    if (currentDbUser) {
      await recomputeTravelStatsForUser(currentDbUser.id);
    }
  }
  return response;
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { tripId } = await context.params;
  const response = await proxyToBackend(request, `/api/trips/${encodeURIComponent(tripId)}`, {
    requireAuth: true,
  });
  if (response.ok) {
    const currentDbUser = await getCurrentDbUser({ createIfMissing: true });
    if (currentDbUser) {
      await recomputeTravelStatsForUser(currentDbUser.id);
    }
  }
  return response;
}
