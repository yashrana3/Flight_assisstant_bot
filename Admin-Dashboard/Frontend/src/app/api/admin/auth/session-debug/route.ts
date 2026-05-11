import { NextRequest, NextResponse } from "next/server";

import { adminSessionCookieSecureFromRequest } from "@/lib/admin-cookie-secure";
import { ADMIN_SESSION_COOKIE } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

/**
 * Safe diagnostics for cookie / HTTPS mismatches (Vercel vs raw VPS).
 * Enable on the server only: ADMIN_DEBUG_SESSION=1
 * Does not return cookie values or tokens.
 */
export async function GET(request: NextRequest) {
  if (process.env.ADMIN_DEBUG_SESSION !== "1") {
    return NextResponse.json(
      { detail: "Set ADMIN_DEBUG_SESSION=1 on the server to enable this route." },
      { status: 404 },
    );
  }

  const cookie = request.cookies.get(ADMIN_SESSION_COOKIE);
  const secureComputed = adminSessionCookieSecureFromRequest(request);
  const forced = process.env.ADMIN_SESSION_COOKIE_SECURE?.trim() ?? null;

  return NextResponse.json({
    ok: true,
    nodeEnv: process.env.NODE_ENV,
    host: request.headers.get("host"),
    url: request.nextUrl.toString(),
    forwardedProto: request.headers.get("x-forwarded-proto"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    nextUrlProtocol: request.nextUrl.protocol,
    adminSessionCookiePresent: Boolean(cookie?.value?.length),
    adminSessionCookieLength: cookie?.value?.length ?? 0,
    /** What sign-in uses for Set-Cookie Secure flag */
    computedSecureFlagForSignIn: secureComputed,
    /** Env override: null | "0"|"false"|"1"|"true" */
    ADMIN_SESSION_COOKIE_SECURE: forced,
    hints: buildHints(request, secureComputed, forced),
  });
}

function buildHints(
  request: NextRequest,
  secureComputed: boolean,
  forced: string | null,
): string[] {
  const hints: string[] = [];
  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase() ??
    request.nextUrl.protocol.replace(":", "");

  if (proto === "http" && secureComputed) {
    hints.push(
      "Browser may refuse Secure cookies on http:// pages — cookie may never stick after sign-in.",
    );
  }
  if (forced === "1" || forced === "true") {
    hints.push(
      "ADMIN_SESSION_COOKIE_SECURE forces Secure=true; HTTP deployments usually need unset or ADMIN_SESSION_COOKIE_SECURE=0.",
    );
  }
  if (!proto.includes("https") && request.headers.get("host")) {
    hints.push(
      "Using plain HTTP; production HTTPS (or ADMIN_SESSION_COOKIE_SECURE=0) avoids Secure-cookie drops.",
    );
  }
  return hints;
}
