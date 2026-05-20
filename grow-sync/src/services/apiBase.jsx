const DEFAULT_API_ORIGIN = "http://localhost:4000";

function trimTrailingSlashes(url) {
  return url.replace(/\/+$/, "");
}

export function getApiOrigin() {
  const rawUrl = trimTrailingSlashes(import.meta.env.VITE_API_URL || DEFAULT_API_ORIGIN);
  return rawUrl.endsWith("/api") ? rawUrl.slice(0, -4) : rawUrl;
}

export function getApiBaseUrl() {
  return `${getApiOrigin()}/api`;
}
