import { isIP } from "node:net";

function isNonPublicIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  const first = octets[0] ?? -1;
  const second = octets[1] ?? -1;
  const third = octets[2] ?? -1;
  return first === 0
    || first === 10
    || first === 127
    || first >= 224
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0 && third === 0)
    || (first === 192 && second === 0 && third === 2)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || (first === 198 && second === 51 && third === 100)
    || (first === 203 && second === 0 && third === 113);
}

export function isNonPublicHostname(value: string): boolean {
  const hostname = value.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/u, "");
  if (
    hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
  ) return true;
  const ipVersion = isIP(hostname);
  if (ipVersion === 4) return isNonPublicIpv4(hostname);
  if (ipVersion === 6) {
    const first = hostname[0];
    return hostname.startsWith("::ffff:")
      || (first !== "2" && first !== "3")
      || hostname.startsWith("2001:2:")
      || hostname.startsWith("2001:db8:");
  }
  return false;
}
