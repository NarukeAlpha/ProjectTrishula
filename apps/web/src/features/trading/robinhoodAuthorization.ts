const ROBINHOOD_AUTHORIZATION_HOST = "robinhood.com";

export function safeRobinhoodAuthorizationUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== ROBINHOOD_AUTHORIZATION_HOST ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}
