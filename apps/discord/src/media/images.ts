import { z } from "zod";

export const MAX_DISCORD_CONTEXT_IMAGES = 4;
export const MAX_DISCORD_INPUT_IMAGE_BYTES = 8 * 1_024 * 1_024;
const MAX_DISCORD_IMAGE_PIXELS = 25_000_000;
const MAX_DISCORD_IMAGE_DIMENSION = 8_192;

export const discordImageMediaTypeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export type DiscordImageMediaType = z.infer<
  typeof discordImageMediaTypeSchema
>;

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

export interface DiscordAttachmentLike {
  id: string;
  url: string;
  name: string;
  contentType: string | null;
  size: number;
  width?: number | null;
  height?: number | null;
}

function normalizedMediaType(value: string | null): string | undefined {
  if (value === null) return undefined;
  const normalized = value.split(";", 1)[0]?.trim().toLowerCase();
  return normalized === "image/jpg" ? "image/jpeg" : normalized;
}

export function discordImageAttachments(
  attachments: Iterable<DiscordAttachmentLike>,
): DiscordImageAttachment[] {
  const images: DiscordImageAttachment[] = [];
  for (const attachment of attachments) {
    const mediaType = normalizedMediaType(attachment.contentType);
    const parsed = discordImageAttachmentSchema.safeParse({
      attachmentId: attachment.id,
      url: attachment.url,
      filename: attachment.name,
      mediaType,
      sizeBytes: attachment.size,
      width: attachment.width ?? undefined,
      height: attachment.height ?? undefined,
    });
    if (!parsed.success) continue;
    images.push(parsed.data);
    if (images.length === MAX_DISCORD_CONTEXT_IMAGES) break;
  }
  return images;
}
