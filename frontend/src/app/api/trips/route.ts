import { NextRequest } from "next/server";

import { proxyToBackend } from "@/lib/backend-proxy";
import { getCurrentDbUser } from "@/lib/current-db-user";
import { recomputeTravelStatsForUser } from "@/lib/travel-stats";

export async function GET(request: NextRequest) {
  return proxyToBackend(request, "/api/trips", { requireAuth: true });
}

export async function POST(request: NextRequest) {
  const response = await proxyToBackend(request, "/api/trips", { requireAuth: true });
  if (response.ok) {
    const currentDbUser = await getCurrentDbUser({ createIfMissing: true });
    if (currentDbUser) {
      await recomputeTravelStatsForUser(currentDbUser.id);
    }
  }
  return response;
}
