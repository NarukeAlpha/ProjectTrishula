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
