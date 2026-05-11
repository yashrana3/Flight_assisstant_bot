import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { getCurrentDbUser } from "@/lib/current-db-user";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required.");
}

/**
 * GET /api/auth/backend-token
 * Exchanges a valid Clerk session for a FastAPI-compatible JWT.
 * Called by the client after Clerk sign-in to get auth credentials
 * for backend API calls.
 */
export async function GET() {
  const user = await getCurrentDbUser({ createIfMissing: true });
  if (!user) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const expiresIn = process.env.JWT_EXPIRES_IN ?? "7d";
  const secret = new TextEncoder().encode(JWT_SECRET);

  const token = await new SignJWT({
    sub: user.id,
    email: user.email,
    first_name: user.firstName ?? undefined,
    last_name: user.lastName ?? undefined,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret);

  return NextResponse.json({ token, user_id: user.id });
}
