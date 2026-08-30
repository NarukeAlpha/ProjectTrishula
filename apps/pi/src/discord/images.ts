import type { ImageContent } from "@earendil-works/pi-ai";
import { z } from "zod";

export const MAX_DISCORD_CONTEXT_IMAGES = 4;
export const MAX_DISCORD_INPUT_IMAGE_BYTES = 8 * 1_024 * 1_024;
export const MAX_DISCORD_INPUT_IMAGE_TOTAL_BYTES = 16 * 1_024 * 1_024;
const MAX_IMAGE_CACHE_BYTES = 24 * 1_024 * 1_024;
const IMAGE_CACHE_TTL_MS = 5 * 60_000;
const IMAGE_REQUEST_TIMEOUT_MS = 10_000;
const MAX_DISCORD_IMAGE_PIXELS = 25_000_000;
const MAX_DISCORD_IMAGE_DIMENSION = 8_192;

export const discordImageMediaTypeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export function isDiscordAttachmentImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      (hostname === "cdn.discordapp.com" ||
        hostname === "media.discordapp.net") &&
      url.pathname.startsWith("/attachments/")
    );
  } catch {
    return false;
  }
}

export const discordImageAttachmentSchema = z
  .object({
    attachmentId: z.string().regex(/^\d{1,32}$/),
    url: z
      .url()
      .max(2_000)
      .refine(isDiscordAttachmentImageUrl, "Discord attachment URL required."),
    filename: z.string().trim().min(1).max(200),
    mediaType: discordImageMediaTypeSchema,
    sizeBytes: z.number().int().positive().max(MAX_DISCORD_INPUT_IMAGE_BYTES),
    width: z.number().int().positive().max(MAX_DISCORD_IMAGE_DIMENSION).optional(),
    height: z
      .number()
      .int()
      .positive()
      .max(MAX_DISCORD_IMAGE_DIMENSION)
      .optional(),
  })
  .strict()
  .superRefine((image, context) => {
    if (
      image.width !== undefined &&
      image.height !== undefined &&
      image.width * image.height > MAX_DISCORD_IMAGE_PIXELS
    ) {
      context.addIssue({
        code: "custom",
        message: "Discord image dimensions exceed the pixel limit.",
      });
    }
  });

export type DiscordImageAttachment = z.infer<
  typeof discordImageAttachmentSchema
>;

export interface DiscordImageContextMessage {
  images?: readonly DiscordImageAttachment[] | undefined;
}

interface CachedImage {
  content: ImageContent;
  sizeBytes: number;
  expiresAt: number;
}

export interface DiscordImageLoaderOptions {
  fetch?: typeof fetch;
  now?: () => number;
}

function normalizedMediaType(value: string | null): string | undefined {
  const normalized = value?.split(";", 1)[0]?.trim().toLowerCase();
  return normalized === "image/jpg" ? "image/jpeg" : normalized;
}

async function boundedResponseBuffer(
  response: Response,
  maxBytes: number,
): Promise<Buffer> {
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
    throw new Error("Discord image exceeds the byte limit.");
  }
  if (response.body === null) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("Discord image exceeds the byte limit.");
    }
    chunks.push(result.value);
  }
  return Buffer.concat(chunks, size);
}

function selectedContextImages(
  messages: readonly DiscordImageContextMessage[],
): DiscordImageAttachment[] {
  const candidates = messages.flatMap((message) => message.images ?? []);
  const unique = new Map<string, DiscordImageAttachment>();
  for (const candidate of candidates) {
    const parsed = discordImageAttachmentSchema.safeParse(candidate);
    if (parsed.success) unique.set(parsed.data.url, parsed.data);
  }
  return [...unique.values()].slice(-MAX_DISCORD_CONTEXT_IMAGES);
}

export class DiscordImageInputLoader {
  private readonly cache = new Map<string, CachedImage>();
  private cacheBytes = 0;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;

  constructor(options: DiscordImageLoaderOptions = {}) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
  }

  async load(
    messages: readonly DiscordImageContextMessage[],
    signal?: AbortSignal,
  ): Promise<ImageContent[]> {
    this.removeExpired();
    const candidates = selectedContextImages(messages);
    const loaded = await Promise.all(
      candidates.map(async (image) => {
        try {
          return await this.loadOne(image, signal);
        } catch (error) {
          if (signal?.aborted) throw signal.reason ?? error;
          return null;
        }
      }),
    );
    const result: ImageContent[] = [];
    let totalBytes = 0;
    for (const image of loaded) {
      if (image === null) continue;
      if (totalBytes + image.sizeBytes > MAX_DISCORD_INPUT_IMAGE_TOTAL_BYTES) {
        continue;
      }
      totalBytes += image.sizeBytes;
      result.push(image.content);
    }
    return result;
  }

  clear(): void {
    this.cache.clear();
    this.cacheBytes = 0;
  }

  private async loadOne(
    image: DiscordImageAttachment,
    signal?: AbortSignal,
  ): Promise<CachedImage> {
    const cached = this.cache.get(image.url);
    if (cached !== undefined && cached.expiresAt > this.now()) {
      this.cache.delete(image.url);
      this.cache.set(image.url, cached);
      return cached;
    }

    const timeout = AbortSignal.timeout(IMAGE_REQUEST_TIMEOUT_MS);
    const requestSignal = signal
      ? AbortSignal.any([signal, timeout])
      : timeout;
    const response = await this.fetch(image.url, {
      method: "GET",
      headers: {
        accept: image.mediaType,
        "user-agent": "ProjectTrishulaDiscordMedia/1.0",
      },
      redirect: "error",
      signal: requestSignal,
    });
    if (!response.ok) {
      throw new Error(`Discord image returned HTTP ${response.status}.`);
    }
    const responseMediaType = normalizedMediaType(
      response.headers.get("content-type"),
    );
    if (responseMediaType !== image.mediaType) {
      throw new Error("Discord image content type did not match its metadata.");
    }
    const bytes = await boundedResponseBuffer(
      response,
      Math.min(image.sizeBytes, MAX_DISCORD_INPUT_IMAGE_BYTES),
    );
    if (bytes.length === 0) throw new Error("Discord image was empty.");
    const entry: CachedImage = {
      content: {
        type: "image",
        data: bytes.toString("base64"),
        mimeType: image.mediaType,
      },
      sizeBytes: bytes.length,
      expiresAt: this.now() + IMAGE_CACHE_TTL_MS,
    };
    this.addToCache(image.url, entry);
    return entry;
  }

  private addToCache(url: string, image: CachedImage): void {
    const existing = this.cache.get(url);
    if (existing !== undefined) this.cacheBytes -= existing.sizeBytes;
    this.cache.delete(url);
    while (
      this.cache.size > 0 &&
      this.cacheBytes + image.sizeBytes > MAX_IMAGE_CACHE_BYTES
    ) {
      const oldest = this.cache.entries().next();
      if (oldest.done) break;
      const [oldestUrl, oldestImage] = oldest.value;
      this.cache.delete(oldestUrl);
      this.cacheBytes -= oldestImage.sizeBytes;
    }
    if (image.sizeBytes <= MAX_IMAGE_CACHE_BYTES) {
      this.cache.set(url, image);
      this.cacheBytes += image.sizeBytes;
    }
  }

  private removeExpired(): void {
    const now = this.now();
    for (const [url, image] of this.cache) {
      if (image.expiresAt > now) continue;
      this.cache.delete(url);
      this.cacheBytes -= image.sizeBytes;
    }
  }
}
