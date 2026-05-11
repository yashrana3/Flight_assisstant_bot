function normalizeBase(base: string): string {
  return base.replace(/\/+$/, "");
}

export function getBackendApiBase(): string {
  const configured =
    process.env.NEXT_PUBLIC_BACKEND_API_BASE ??
    process.env.NEXT_PUBLIC_BACKEND_URL;

  if (configured) {
    return normalizeBase(configured);
  }

  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:8000/api`;
  }

  return "http://127.0.0.1:8000/api";
}

export function backendApiUrl(path: string): string {
  const base = getBackendApiBase();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}
