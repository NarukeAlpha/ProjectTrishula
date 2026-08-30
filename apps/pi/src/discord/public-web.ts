import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { z } from "zod";

const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 512 * 1_024;
const REQUEST_TIMEOUT_MS = 10_000;
const BLOCKED_HOST_SUFFIXES = [".internal", ".local", ".localhost", ".home", ".lan"];
const blockedAddresses = new BlockList();

for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) blockedAddresses.addSubnet(address, prefix, "ipv4");

for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
  ["2001:2::", 48],
] as const) blockedAddresses.addSubnet(address, prefix, "ipv6");

interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface PublicFetchResult {
  url: string;
  status: number;
  contentType: string;
  body: string;
  fetchedAt: string;
}

export interface PublicSearchResult {
  title: string;
  url: string;
  snippet: string;
}

function normalizedHostname(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

export function isPublicIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedAddresses.check(address, "ipv4");
  if (family !== 6) return false;
  if (address.toLowerCase().startsWith("::ffff:")) return false;
  const first = address.toLowerCase().replace(/^\[|\]$/g, "")[0];
  return (first === "2" || first === "3") && !blockedAddresses.check(address, "ipv6");
}

export function assertPublicHttpsUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Only HTTPS URLs are allowed.");
  if (url.username || url.password) throw new Error("URL credentials are not allowed.");
  if (url.port && url.port !== "443") throw new Error("Only the standard HTTPS port is allowed.");
  const hostname = normalizedHostname(url);
  if (!hostname || hostname === "localhost" || BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new Error("Local network hosts are not allowed.");
  }
  if (isIP(hostname) > 0 && !isPublicIp(hostname)) throw new Error("Private network addresses are not allowed.");
  return url;
}

async function resolvePublicAddress(url: URL): Promise<ResolvedAddress> {
  const hostname = normalizedHostname(url);
  if (isIP(hostname) > 0) {
    if (!isPublicIp(hostname)) throw new Error("Private network addresses are not allowed.");
    const family = isIP(hostname);
    if (family !== 4 && family !== 6) throw new Error("The URL contains an unsupported address family.");
    return { address: hostname, family };
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIp(address))) {
    throw new Error("The host did not resolve only to public addresses.");
  }
  const selected = addresses[0];
  if (!selected) throw new Error("The host did not resolve to an address.");
  if (selected.family !== 4 && selected.family !== 6) throw new Error("The host resolved to an unsupported address family.");
  return { address: selected.address, family: selected.family };
}

async function requestOnce(url: URL, signal?: AbortSignal): Promise<{
  status: number;
  headers: import("node:http").IncomingHttpHeaders;
  body: Buffer;
}> {
  const resolved = await resolvePublicAddress(url);
  return await new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    let timer: NodeJS.Timeout | undefined;
    const settle = <T>(callback: (value: T) => void, value: T): void => {
      if (timer) clearTimeout(timer);
      callback(value);
    };
    const request = httpsRequest(url, {
      headers: {
        accept: "text/html,application/xhtml+xml,application/json,text/plain,application/xml;q=0.9,*/*;q=0.1",
        "user-agent": "ProjectTrishulaResearch/1.0",
      },
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [resolved]);
        else callback(null, resolved.address, resolved.family);
      },
      signal,
    }, (response) => {
      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_RESPONSE_BYTES) {
          response.destroy(new Error("The public response exceeded the byte limit."));
          return;
        }
        chunks.push(buffer);
      });
      response.once("end", () => settle(resolve, {
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
      response.once("error", (error) => settle(reject, error));
    });
    timer = setTimeout(() => request.destroy(new Error("The public request timed out.")), REQUEST_TIMEOUT_MS);
    timer.unref();
    request.once("error", (error) => settle(reject, error));
    request.end();
  });
}

export async function fetchPublicText(value: string, signal?: AbortSignal): Promise<PublicFetchResult> {
  let url = assertPublicHttpsUrl(value);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await requestOnce(url, signal);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.location;
      if (!location || redirect === MAX_REDIRECTS) throw new Error("The public request exceeded its redirect limit.");
      url = assertPublicHttpsUrl(new URL(location, url).toString());
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`The public request returned HTTP ${response.status}.`);
    }
    const contentType = (response.headers["content-type"] ?? "text/plain").split(";", 1)[0]?.trim().toLowerCase() ?? "text/plain";
    const supported = contentType.startsWith("text/")
      || contentType === "application/json"
      || contentType === "application/xml"
      || contentType === "application/xhtml+xml"
      || contentType.endsWith("+json")
      || contentType.endsWith("+xml");
    if (!supported) throw new Error(`Unsupported public content type: ${contentType}.`);
    return {
      url: url.toString(),
      status: response.status,
      contentType,
      body: response.body.toString("utf8"),
      fetchedAt: new Date().toISOString(),
    };
  }
  throw new Error("The public request did not complete.");
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function textFromHtml(value: string): string {
  return decodeHtml(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resultUrl(href: string): string | undefined {
  try {
    const decoded = decodeHtml(href);
    const candidate = new URL(decoded, "https://html.duckduckgo.com");
    const nested = candidate.searchParams.get("uddg");
    const target = assertPublicHttpsUrl(nested ?? candidate.toString());
    if (target.hostname.endsWith("duckduckgo.com") && !nested) return undefined;
    return target.toString();
  } catch {
    return undefined;
  }
}

export async function searchPublicWeb(query: string, signal?: AbortSignal): Promise<PublicSearchResult[]> {
  const searchUrl = new URL("https://html.duckduckgo.com/html/");
  searchUrl.searchParams.set("q", query.slice(0, 500));
  const result = await fetchPublicText(searchUrl.toString(), signal);
  const rows: PublicSearchResult[] = [];
  const pattern = /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>)?/gi;
  for (const match of result.body.matchAll(pattern)) {
    const url = match[1] ? resultUrl(match[1]) : undefined;
    const title = match[2] ? textFromHtml(match[2]).slice(0, 300) : "";
    if (!url || !title || rows.some((row) => row.url === url)) continue;
    rows.push({ title, url, snippet: textFromHtml(match[3] ?? "").slice(0, 800) });
    if (rows.length === 8) break;
  }
  return rows;
}

export async function readPublicPage(value: string, signal?: AbortSignal) {
  const response = await fetchPublicText(value, signal);
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(response.body);
  return {
    url: response.url,
    title: textFromHtml(titleMatch?.[1] ?? response.url).slice(0, 300),
    content: response.contentType.includes("html")
      ? textFromHtml(response.body).slice(0, 30_000)
      : response.body.replace(/\s+/g, " ").trim().slice(0, 30_000),
    fetchedAt: response.fetchedAt,
  };
}

export async function getPublicMarketData(symbols: string[], signal?: AbortSignal) {
  return await Promise.all(symbols.map(async (rawSymbol) => {
    const symbol = rawSymbol.trim().toUpperCase();
    if (!/^[A-Z0-9.^=-]{1,20}$/.test(symbol)) throw new Error(`Invalid market symbol: ${rawSymbol}.`);
    const sourceUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
    const response = await fetchPublicText(sourceUrl, signal);
    const payload = z.object({
      chart: z.object({
        result: z.array(z.object({
          meta: z.object({
            currency: z.string().optional(),
            symbol: z.string().optional(),
            exchangeName: z.string().optional(),
            instrumentType: z.string().optional(),
            regularMarketPrice: z.number().optional(),
            previousClose: z.number().optional(),
            chartPreviousClose: z.number().optional(),
            regularMarketTime: z.number().optional(),
            timezone: z.string().optional(),
          }),
          timestamp: z.array(z.number()).optional(),
          indicators: z.object({
            quote: z.array(z.object({
              open: z.array(z.number().nullable()).optional(),
              high: z.array(z.number().nullable()).optional(),
              low: z.array(z.number().nullable()).optional(),
              close: z.array(z.number().nullable()).optional(),
              volume: z.array(z.number().nullable()).optional(),
            })).optional(),
          }).optional(),
        })),
      }),
    }).parse(JSON.parse(response.body));
    const chart = payload.chart.result[0];
    if (!chart) throw new Error(`No public market data was returned for ${symbol}.`);
    return {
      symbol,
      sourceUrl: response.url,
      fetchedAt: response.fetchedAt,
      meta: chart.meta ?? {},
      timestamps: chart.timestamp ?? [],
      quotes: chart.indicators?.quote?.[0] ?? {},
    };
  }));
}
