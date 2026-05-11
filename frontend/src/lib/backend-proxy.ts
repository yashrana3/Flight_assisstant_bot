import { NextRequest, NextResponse } from "next/server";

import { getCurrentDbUser } from "@/lib/current-db-user";

const BACKEND_URL = process.env.BACKEND_URL;
const INTERNAL_PROXY_SECRET =
  process.env.BACKEND_PROXY_SECRET ?? process.env.JWT_SECRET;
const USER_LOOKUP_TIMEOUT_MS = Number(process.env.PROXY_USER_LOOKUP_TIMEOUT_MS ?? 8000);
// Flight search and grounded chat can legitimately take a while, so keep this
// comfortably above the old 30s default to avoid false "assistant unavailable"
// errors on normal requests.
const BACKEND_FETCH_TIMEOUT_MS = Number(process.env.PROXY_BACKEND_TIMEOUT_MS ?? 60000);

if (!BACKEND_URL) {
  throw new Error("BACKEND_URL environment variable is required.");
}
if (!INTERNAL_PROXY_SECRET) {
  throw new Error(
    "BACKEND_PROXY_SECRET or JWT_SECRET environment variable is required.",
  );
}

function buildBackendUrl(path: string, search: string): string {
  const base = BACKEND_URL.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}${search}`;
}

function copyRequestHeaders(
  request: NextRequest,
  userId?: string | null,
): Headers {
  const headers = new Headers();
  const authorization = request.headers.get("authorization");
  const contentType = request.headers.get("content-type");
  const accept = request.headers.get("accept");

  if (authorization) headers.set("authorization", authorization);
  if (contentType) headers.set("content-type", contentType);
  if (accept) headers.set("accept", accept);
  if (userId) {
    headers.set("x-user-id", userId);
    headers.set("x-internal-auth", INTERNAL_PROXY_SECRET);
  }

  return headers;
}

type ProxyOptions = {
  requireAuth?: boolean;
  includeUserContext?: boolean;
};

export async function proxyToBackend(
  request: NextRequest,
  backendPath: string,
  options: ProxyOptions = {},
): Promise<NextResponse> {
  let currentDbUser: Awaited<ReturnType<typeof getCurrentDbUser>> = null;
  const shouldResolveUser = Boolean(options.requireAuth || options.includeUserContext);

  if (shouldResolveUser) {
    try {
      currentDbUser = await Promise.race([
        getCurrentDbUser({
          createIfMissing: true,
        }),
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), USER_LOOKUP_TIMEOUT_MS);
        }),
      ]);
    } catch {
      // If Clerk fails for any reason, avoid crashing the proxy.
      // The backend will behave as a guest/anonymous request.
      currentDbUser = null;
    }
  }

  if (options.requireAuth && !currentDbUser) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const headers = copyRequestHeaders(request, currentDbUser?.id ?? null);
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  let backendResponse: Response;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BACKEND_FETCH_TIMEOUT_MS);

  try {
    backendResponse = await fetch(
      buildBackendUrl(backendPath, request.nextUrl.search),
      {
        method: request.method,
        headers,
        body: hasBody ? await request.text() : undefined,
        signal: controller.signal,
      },
    );
  } catch {
    clearTimeout(timeoutId);
    return NextResponse.json(
      {
        detail:
          "Backend unavailable or timed out. Try again in a moment.",
      },
      { status: 504 },
    );
  }
  clearTimeout(timeoutId);

  const responseHeaders = new Headers();
  const contentType = backendResponse.headers.get("content-type");
  const cacheControl = backendResponse.headers.get("cache-control");
  const xAccelBuffering = backendResponse.headers.get("x-accel-buffering");

  if (contentType) {
    responseHeaders.set("content-type", contentType);
  }
  if (cacheControl) {
    responseHeaders.set("cache-control", cacheControl);
  }
  if (xAccelBuffering) {
    responseHeaders.set("x-accel-buffering", xAccelBuffering);
  }

  return new NextResponse(backendResponse.body, {
    status: backendResponse.status,
    headers: responseHeaders,
  });
}
