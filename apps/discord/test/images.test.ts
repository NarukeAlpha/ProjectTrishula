import { describe, expect, it } from "vitest";
import { agentMessageSchema, storedMessageSchema } from "../src/contracts.js";
import {
  discordImageAttachments,
  isDiscordAttachmentImageUrl,
  MAX_DISCORD_CONTEXT_IMAGES,
} from "../src/media/images.js";

const validImage = {
  id: "123456789012345678",
  url: "https://cdn.discordapp.com/attachments/10/20/chart.png?ex=abc",
  name: "chart.png",
  contentType: "image/png",
  size: 32_000,
  width: 1_200,
  height: 675,
};

describe("Discord image attachments", () => {
  it("keeps only bounded images hosted on Discord's attachment CDN", () => {
    const images = discordImageAttachments([
      validImage,
      {
        ...validImage,
        id: "223456789012345678",
        url: "https://example.com/attachments/10/20/chart.png",
      },
      {
        ...validImage,
        id: "323456789012345678",
        contentType: "application/pdf",
      },
      ...Array.from({ length: 8 }, (_, index) => ({
        ...validImage,
        id: `${index + 4}23456789012345678`,
        url: `https://media.discordapp.net/attachments/10/${index + 30}/chart.png`,
      })),
    ]);

    expect(images).toHaveLength(MAX_DISCORD_CONTEXT_IMAGES);
    expect(images[0]).toEqual({
      attachmentId: validImage.id,
      url: validImage.url,
      filename: validImage.name,
      mediaType: "image/png",
      sizeBytes: validImage.size,
      width: validImage.width,
      height: validImage.height,
    });
    expect(images.every((image) => isDiscordAttachmentImageUrl(image.url))).toBe(
      true,
    );
  });

  it("rejects oversized files and pixel dimensions", () => {
    expect(
      discordImageAttachments([
        { ...validImage, size: 9 * 1_024 * 1_024 },
        { ...validImage, width: 8_000, height: 8_000 },
      ]),
    ).toEqual([]);
  });

  it("accepts an image-only message but rejects an empty message", () => {
    const images = discordImageAttachments([validImage]);
    const stored = {
      guildId: "10",
      channelId: "20",
      messageId: "30",
      authorId: "40",
      authorName: "Ari",
      content: "",
      images,
      mentionsBot: false,
      isBot: false,
      createdAt: 1,
    };
    expect(storedMessageSchema.safeParse(stored).success).toBe(true);
    expect(
      agentMessageSchema.safeParse({
        messageId: "30",
        sequence: 1,
        authorId: "40",
        authorName: "Ari",
        content: "",
        images,
        isBot: false,
        createdAt: "2026-08-30T12:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      storedMessageSchema.safeParse({ ...stored, images: undefined }).success,
    ).toBe(false);
  });
});
