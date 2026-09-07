import { createHash } from "node:crypto";
import type { MarketResearchEvidenceItem } from "./contracts.js";
import { isNonPublicHostname } from "./public-url.js";

const TRACKING_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "referrer",
]);

export function requirePublicHttpsUrl(raw: string): URL {
  const url = new URL(raw);
  if (
    url.protocol !== "https:"
    || url.username !== ""
    || url.password !== ""
    || url.port !== ""
    || isNonPublicHostname(url.hostname)
  ) throw new Error("source_unavailable");
  return url;
}

export function canonicalSourceUrl(raw: string): string {
  const url = requirePublicHttpsUrl(raw);
  url.hash = "";
  const searchKeys = Array.from(url.searchParams.keys());
  for (const key of searchKeys) {
    if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMETERS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizedContentFingerprint(
  title: string | undefined,
  highlights: readonly string[],
): string {
  const normalized = `${title ?? ""}\n${highlights.join("\n")}`
    .normalize("NFKC")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return sha256(normalized);
}

export interface DeduplicatedEvidence {
  retained: MarketResearchEvidenceItem[];
  duplicateUrls: Array<{ retainedEvidenceId: string; duplicateUrl: string }>;
}

export function deduplicateEvidence(
  evidence: readonly MarketResearchEvidenceItem[],
): DeduplicatedEvidence {
  const canonical = new Map<string, MarketResearchEvidenceItem>();
  const content = new Map<string, MarketResearchEvidenceItem>();
  const retained: MarketResearchEvidenceItem[] = [];
  const duplicateUrls: DeduplicatedEvidence["duplicateUrls"] = [];
  for (const item of evidence) {
    const canonicalKey = item.canonicalUrlHash;
    const contentKey = item.contentHash;
    const duplicate = (canonicalKey ? canonical.get(canonicalKey) : undefined)
      ?? content.get(contentKey);
    if (duplicate) {
      if (item.url !== undefined) {
        duplicateUrls.push({ retainedEvidenceId: duplicate.evidenceId, duplicateUrl: item.url });
      }
      continue;
    }
    retained.push(item);
    if (canonicalKey) canonical.set(canonicalKey, item);
    content.set(contentKey, item);
  }
  return { retained, duplicateUrls };
}

export function sanitizeUntrustedEvidenceText(value: string, maximum: number): string {
  return value
    .normalize("NFKC")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}
