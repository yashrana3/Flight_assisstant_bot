import { NextRequest } from "next/server";

import { proxyToBackend } from "@/lib/backend-proxy";
import { getCurrentDbUser } from "@/lib/current-db-user";
import { recomputeTravelStatsForUser } from "@/lib/travel-stats";

export async function POST(request: NextRequest) {
  const response = await proxyToBackend(request, "/api/trips/ai-create", { requireAuth: true });
  if (response.ok) {
    const currentDbUser = await getCurrentDbUser({ createIfMissing: true });
    if (currentDbUser) {
      await recomputeTravelStatsForUser(currentDbUser.id);
    }
  }
  return response;
}
