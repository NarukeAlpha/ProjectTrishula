export const ROBINHOOD_OAUTH_TRANSACTION_TTL_MS = 20 * 60 * 1_000;

function isRobinhoodHost(hostname: string): boolean {
  return hostname.toLowerCase() === "robinhood.com";
}

export function requireRobinhoodAuthorizationUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Robinhood authorization URL is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    !isRobinhoodHost(url.hostname) ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  ) {
    throw new Error("Robinhood authorization URL must use an HTTPS Robinhood host.");
  }
  return url.toString();
}

export function requireRobinhoodOAuthState(value: string): string {
  const state = value.trim();
  if (state.length === 0 || state.length > 512) {
    throw new Error("Robinhood OAuth state is invalid.");
  }
  return state;
}

export function requireRobinhoodOAuthCode(value: string): string {
  const code = value.trim();
  if (code.length === 0 || code.length > 8_192) {
    throw new Error("Robinhood OAuth code is invalid.");
  }
  return code;
}

export interface ParsedRobinhoodCallback {
  state: string;
  code?: string;
  error?: string;
  errorDescription?: string;
}

function isAllowedCallbackUrl(url: URL): boolean {
  if (url.username !== "" || url.password !== "") return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") {
    const hostname = url.hostname.toLowerCase();
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
  }
  return false;
}

export function parseRobinhoodCallbackInput(rawValue: string): ParsedRobinhoodCallback {
  const trimmed = rawValue.trim();
  if (trimmed.length === 0 || trimmed.length > 16_384) {
    throw new Error("Paste the full redirect URL from your browser address bar.");
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Paste the full redirect URL from your browser address bar.");
  }
  if (!isAllowedCallbackUrl(url)) {
    throw new Error("Robinhood callback URL must use HTTPS or a localhost loopback address.");
  }
  const state = requireRobinhoodOAuthState(url.searchParams.get("state") ?? "");
  const providerError = url.searchParams.get("error")?.trim();
  if (providerError) {
    const parsed: ParsedRobinhoodCallback = {
      state,
      error: providerError.slice(0, 128),
    };
    const description = url.searchParams.get("error_description")?.trim();
    if (description) parsed.errorDescription = description.slice(0, 512);
    return parsed;
  }
  const code = requireRobinhoodOAuthCode(url.searchParams.get("code") ?? "");
  return { code, state };
}

export function requireWebAppOrigin(value = process.env.WEB_APP_ORIGIN): string {
  if (!value?.trim()) throw new Error("WEB_APP_ORIGIN is not configured.");
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("WEB_APP_ORIGIN is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("WEB_APP_ORIGIN must be an HTTPS origin.");
  }
  return url.origin;
}
