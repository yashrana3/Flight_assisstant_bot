import type { NextRequest } from "next/server";

/**
 * Whether admin session cookies should use the Secure flag.
 * In production, NODE_ENV alone is wrong for HTTP deployments (e.g. http://ip:3001):
 * browsers drop Secure cookies on non-HTTPS pages, so sign-in "works" but the session never sticks.
 *
 * Override: ADMIN_SESSION_COOKIE_SECURE=1 (always secure) or =0 (never secure).
 */
export function adminSessionCookieSecureFromRequest(request: NextRequest): boolean {
  const forced = process.env.ADMIN_SESSION_COOKIE_SECURE?.trim();
  if (forced === "0" || forced === "false") return false;
  if (forced === "1" || forced === "true") return true;

  const forwarded = request.headers.get("x-forwarded-proto");
  const first = forwarded?.split(",")[0]?.trim().toLowerCase();
  if (first === "https") return true;
  if (first === "http") return false;
  return request.nextUrl.protocol === "https:";
}

export function adminSessionCookieSecureFromHeaders(
  forwardedProto: string | null,
  urlProtocol: string,
): boolean {
  const forced = process.env.ADMIN_SESSION_COOKIE_SECURE?.trim();
  if (forced === "0" || forced === "false") return false;
  if (forced === "1" || forced === "true") return true;

  const first = forwardedProto?.split(",")[0]?.trim().toLowerCase();
  if (first === "https") return true;
  if (first === "http") return false;
  return urlProtocol === "https:";
}
