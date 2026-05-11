import { NextRequest } from "next/server";

import { proxyToBackend } from "@/lib/backend-proxy";

export async function GET(request: NextRequest) {
  return proxyToBackend(request, "/api/sessions", { requireAuth: true });
}

export async function POST(request: NextRequest) {
  return proxyToBackend(request, "/api/sessions", { requireAuth: true });
}
