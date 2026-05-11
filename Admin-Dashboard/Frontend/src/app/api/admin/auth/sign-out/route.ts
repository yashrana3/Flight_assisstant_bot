import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { adminSessionCookieSecureFromHeaders } from "@/lib/admin-cookie-secure";
import { ADMIN_SESSION_COOKIE } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

export async function POST() {
  const headerList = await headers();
  const secure = adminSessionCookieSecureFromHeaders(
    headerList.get("x-forwarded-proto"),
    "http:",
  );

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    expires: new Date(0),
  });
  return response;
}
