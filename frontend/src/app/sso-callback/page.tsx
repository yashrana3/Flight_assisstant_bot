"use client";

import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";

/**
 * Clerk SSO callback page.
 * Clerk redirects here after OAuth (Google, etc.) completes.
 * AuthenticateWithRedirectCallback finishes the handshake and
 * then redirects to `redirectUrlComplete` (set to "/" by the
 * sign-in / sign-up pages that initiated the OAuth flow).
 */
export default function SSOCallbackPage() {
  return <AuthenticateWithRedirectCallback />;
}
