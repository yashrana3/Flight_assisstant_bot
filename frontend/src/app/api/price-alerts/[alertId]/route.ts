import { NextRequest, NextResponse } from "next/server";

import { proxyToBackend } from "@/lib/backend-proxy";
import { getCurrentDbUser } from "@/lib/current-db-user";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    alertId: string;
  }>;
};

function parseAlertDateRange(dateRange: string | null) {
  if (!dateRange?.trim()) {
    return { departureDate: null, returnDate: null };
  }

  const parts = dateRange
    .split("to")
    .map((part) => part.trim())
    .filter(Boolean);

  return {
    departureDate: parts[0] || null,
    returnDate: parts[1] || null,
  };
}

function serializePriceAlertSnapshot(alert: {
  id: string;
  origin: string;
  destination: string;
  airline: string | null;
  date_range: string | null;
  current_price: { toNumber(): number } | null;
  lowest_price: { toNumber(): number } | null;
  currency: string | null;
  trend: string | null;
  change_pct: string | null;
  is_active: boolean | null;
  created_at: Date | null;
  updated_at: Date | null;
}) {
  const { departureDate, returnDate } = parseAlertDateRange(alert.date_range);
  const normalizedTrend = (alert.trend || "flat").toLowerCase();

  return {
    id: alert.id,
    origin: alert.origin,
    destination: alert.destination,
    route: `${alert.origin} → ${alert.destination}`,
    airline: alert.airline,
    dateRange: alert.date_range,
    currentPrice: alert.current_price?.toNumber() ?? null,
    lowestPrice: alert.lowest_price?.toNumber() ?? null,
    currency: alert.currency,
    trend: normalizedTrend,
    changePct: alert.change_pct,
    active: Boolean(alert.is_active),
    createdAt: alert.created_at?.toISOString() ?? null,
    updatedAt: alert.updated_at?.toISOString() ?? null,
    analysisSummary: null,
    priceOutlook: normalizedTrend === "down" ? "low" : null,
    timingHint: null,
    livePriceSource: null,
    livePriceCheckedAt: alert.updated_at?.toISOString() ?? null,
    departureDate,
    returnDate,
    liveSearchAvailable: Boolean(departureDate),
    bookUrl: null,
  };
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { alertId } = await context.params;

  const refresh = request.nextUrl.searchParams.get("refresh");
  const shouldUseLocalSnapshot =
    refresh === null || refresh.toLowerCase() === "false";

  if (shouldUseLocalSnapshot) {
    const currentDbUser = await getCurrentDbUser({ createIfMissing: true });
    if (!currentDbUser) {
      return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
    }

    try {
      const alert = await prisma.priceAlert.findFirst({
        where: {
          id: alertId,
          user_id: currentDbUser.id,
        },
      });

      if (!alert) {
        return NextResponse.json({ detail: "Alert not found" }, { status: 404 });
      }

      return NextResponse.json({ alert: serializePriceAlertSnapshot(alert) });
    } catch (err) {
      console.error("GET /api/price-alerts/[alertId] local snapshot error:", err);
      return NextResponse.json(
        { detail: "Failed to load alert." },
        { status: 500 },
      );
    }
  }

  return proxyToBackend(
    request,
    `/api/price-alerts/${encodeURIComponent(alertId)}`,
    { requireAuth: true },
  );
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { alertId } = await context.params;
  const requestClone = request.clone();

  try {
    const payload = await requestClone.json() as {
      is_active?: boolean;
      refresh_live?: boolean;
    };
    const keys = Object.keys(payload ?? {});
    const isToggleOnly =
      typeof payload?.is_active === "boolean" &&
      keys.every((key) => key === "is_active" || key === "refresh_live");

    if (isToggleOnly) {
      const currentDbUser = await getCurrentDbUser({ createIfMissing: true });
      if (!currentDbUser) {
        return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
      }

      const existingAlert = await prisma.priceAlert.findFirst({
        where: {
          id: alertId,
          user_id: currentDbUser.id,
        },
      });

      if (!existingAlert) {
        return NextResponse.json({ detail: "Alert not found" }, { status: 404 });
      }

      const updatedAlert = await prisma.priceAlert.update({
        where: { id: alertId },
        data: {
          is_active: payload.is_active,
          updated_at: new Date(),
        },
      });

      return NextResponse.json({ alert: serializePriceAlertSnapshot(updatedAlert) });
    }
  } catch {
    // Fall back to backend proxy for non-JSON or full alert updates.
  }

  return proxyToBackend(
    request,
    `/api/price-alerts/${encodeURIComponent(alertId)}`,
    { requireAuth: true },
  );
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { alertId } = await context.params;
  return proxyToBackend(
    request,
    `/api/price-alerts/${encodeURIComponent(alertId)}`,
    { requireAuth: true },
  );
}
