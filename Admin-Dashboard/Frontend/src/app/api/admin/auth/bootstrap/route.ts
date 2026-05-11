import { NextRequest, NextResponse } from "next/server";

import { bootstrapAdmin, getRouteError } from "@/backend/admin-api";
import { adminSessionCookieSecureFromRequest } from "@/lib/admin-cookie-secure";
import { ADMIN_SESSION_COOKIE, ADMIN_SESSION_MAX_AGE_SECONDS } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const payload = await bootstrapAdmin({
      username: String(body?.username ?? ""),
      full_name: String(body?.fullName ?? ""),
      email: String(body?.email ?? ""),
      password: String(body?.password ?? ""),
    });

    const response = NextResponse.json({ admin: payload.admin });
    response.cookies.set(ADMIN_SESSION_COOKIE, payload.accessToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: adminSessionCookieSecureFromRequest(request),
      path: "/",
      maxAge: payload.expiresInSeconds || ADMIN_SESSION_MAX_AGE_SECONDS,
    });
    return response;
  } catch (err) {
    const { status, detail } = getRouteError(err);
    return NextResponse.json({ detail }, { status });
  }
}
