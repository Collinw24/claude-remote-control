export const DEFAULT_BACKEND_PORT = "3001";
export const DEFAULT_BACKEND_URL = "ws://localhost:3001";

const WS_PROTOCOLS = new Set(["ws:", "wss:"]);

function serializeUrl(url: URL): string {
  const path = url.pathname === "/" ? "" : url.pathname;
  return `${url.protocol}//${url.host}${path}${url.search}${url.hash}`;
}

export function normalizeBackendUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  let candidate = trimmed;
  const hasExplicitScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate);
  if (/^http:\/\//i.test(candidate)) {
    candidate = candidate.replace(/^http:/i, "ws:");
  } else if (/^https:\/\//i.test(candidate)) {
    candidate = candidate.replace(/^https:/i, "wss:");
  } else if (!hasExplicitScheme) {
    candidate = `ws://${candidate}`;
  }

  const url = new URL(candidate);
  if (!hasExplicitScheme && WS_PROTOCOLS.has(url.protocol) && !url.port) {
    url.port = DEFAULT_BACKEND_PORT;
  }

  return serializeUrl(url);
}

export function validateBackendUrl(value: string): string | null {
  if (!value.trim()) return "Backend URL is required.";

  let normalized: string;
  try {
    normalized = normalizeBackendUrl(value);
  } catch {
    return "Backend URL is invalid.";
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return "Backend URL is invalid.";
  }

  if (!WS_PROTOCOLS.has(url.protocol)) {
    return "Use a ws:// or wss:// backend URL.";
  }

  if (!url.hostname) {
    return "Backend URL is invalid.";
  }

  return null;
}
