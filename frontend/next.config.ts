import type { NextConfig } from "next";

const backendUrl = process.env.BACKEND_URL;
const appRoot = process.cwd();

/** Hostnames allowed to load /_next/* in dev when not using localhost (e.g. phone on LAN). Comma-separated. */
const extraDevOrigins =
  process.env.NEXT_DEV_EXTRA_ORIGINS?.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean) ?? [];

if (!backendUrl) {
  // This will only throw at build/start time so the developer knows
  // immediately that the required env var is missing.
  throw new Error(
    "BACKEND_URL environment variable is required. " +
    "Set it in .env.local (development) or your hosting platform (production)."
  );
}

const nextConfig: NextConfig = {
  ...(extraDevOrigins.length > 0
    ? {
        // Enables stricter dev checks; only set when you need LAN IP access (see NEXT_DEV_EXTRA_ORIGINS).
        allowedDevOrigins: ["127.0.0.1", ...extraDevOrigins],
      }
    : {}),
  outputFileTracingRoot: appRoot,
  turbopack: {
    root: appRoot,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "openweathermap.org",
        pathname: "/img/wn/**",
      },
    ],
  },
  // No catch-all /api → backend rewrite: it could bypass App Route handlers
  // (loyalty, profile, etc.) and hit FastAPI instead. Use route.ts + proxyToBackend.
};

export default nextConfig;
