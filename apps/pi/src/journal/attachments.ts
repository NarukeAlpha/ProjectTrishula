import type { ImageContent } from "@earendil-works/pi-ai";
import {
  createTimeoutAbortSignal,
  MAX_JOURNAL_CHART_BYTES,
  readBoundedBytes,
  sniffJournalImage,
  type JournalChartMimeType,
  type JournalChatAttachment,
} from "./contracts.js";

const DEFAULT_ATTACHMENT_TIMEOUT_MS = 15_000;

export interface FetchedJournalAttachment {
  attachment: JournalChatAttachment;
  image: ImageContent;
  mimeType: JournalChartMimeType;
  width: number;
  height: number;
}

export type FetchAttachmentResult =
  | { ok: true; value: FetchedJournalAttachment }
  | { ok: false; attachment: JournalChatAttachment; reason: string };

export interface AttachmentFetchOptions {
  convexSiteUrl: string;
  allowedOrigins?: readonly string[];
  maxBytes?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export function deriveAllowedAttachmentOrigins(
  convexSiteUrl: string,
  extraOrigins: readonly string[] = [],
): ReadonlySet<string> {
  const origins = new Set<string>();
  const siteUrl = new URL(convexSiteUrl);
  origins.add(siteUrl.origin);
  if (siteUrl.protocol === "https:" && siteUrl.hostname.endsWith(".convex.site")) {
    const deploymentPrefix = siteUrl.hostname.slice(0, -".convex.site".length);
    if (deploymentPrefix.length > 0) {
      origins.add(`https://${deploymentPrefix}.convex.cloud`);
    }
  }
  for (const extra of extraOrigins) {
    try {
      origins.add(new URL(extra).origin);
    } catch {
      // Ignore malformed optional override entries.
    }
  }
  return origins;
}

export function isAllowedAttachmentUrl(
  rawUrl: string,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.username !== "" || parsed.password !== "") return false;
  return allowedOrigins.has(parsed.origin);
}

export async function fetchJournalAttachment(
  attachment: JournalChatAttachment,
  options: AttachmentFetchOptions,
  signal?: AbortSignal,
): Promise<FetchAttachmentResult> {
  if (attachment.url === null) {
    return { ok: false, attachment, reason: "Attachment URL is missing." };
  }
  const allowedOrigins = deriveAllowedAttachmentOrigins(
    options.convexSiteUrl,
    options.allowedOrigins,
  );
  if (!isAllowedAttachmentUrl(attachment.url, allowedOrigins)) {
    return { ok: false, attachment, reason: "Attachment URL origin is not allowed." };
  }

  const maxBytes = options.maxBytes ?? MAX_JOURNAL_CHART_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_ATTACHMENT_TIMEOUT_MS;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const combined = createTimeoutAbortSignal(timeoutMs, "attachment_fetch_timeout", signal);

  let response: Response;
  try {
    response = await fetchImpl(attachment.url, {
      method: "GET",
      redirect: "error",
      signal: combined.signal,
    });
  } catch (error) {
    combined.cleanup();
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error("journal_run_aborted");
    }
    const reason = error instanceof Error ? error.message : "Could not download attachment.";
    return { ok: false, attachment, reason };
  }

  let readResult: Awaited<ReturnType<typeof readBoundedBytes>>;
  try {
    if (!response.ok) {
      return {
        ok: false,
        attachment,
        reason: `Attachment download failed with HTTP ${response.status}.`,
      };
    }
    readResult = await readBoundedBytes(response, maxBytes);
  } finally {
    combined.cleanup();
  }

  if (!readResult.ok) {
    const reason = readResult.reason === "too_large"
      ? `Attachment exceeded ${maxBytes} bytes.`
      : "Attachment image body was empty or unreadable.";
    return { ok: false, attachment, reason };
  }

  const sniffed = sniffJournalImage(readResult.bytes);
  if (sniffed === null) {
    return {
      ok: false,
      attachment,
      reason: "Attachment bytes are not a valid PNG, JPEG, or WEBP image.",
    };
  }

  const data = Buffer.from(readResult.bytes).toString("base64");
  return {
    ok: true,
    value: {
      attachment,
      image: {
        type: "image",
        data,
        mimeType: sniffed.mimeType,
      },
      mimeType: sniffed.mimeType,
      width: sniffed.width,
      height: sniffed.height,
    },
  };
}
