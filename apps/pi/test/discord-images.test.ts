import { describe, expect, it, vi } from "vitest";
import {
  DiscordImageInputLoader,
  isDiscordAttachmentImageUrl,
} from "../src/discord/images.js";

const image = {
  attachmentId: "123456789012345678",
  url: "https://cdn.discordapp.com/attachments/10/20/chart.png?ex=abc",
  filename: "chart.png",
  mediaType: "image/png" as const,
  sizeBytes: 4,
  width: 2,
  height: 2,
};

function imageResponse(
  bytes = Uint8Array.from([1, 2, 3, 4]),
  mediaType = "image/png",
): Response {
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": mediaType,
      "content-length": String(bytes.length),
    },
  });
}

describe("Discord image input loading", () => {
  it("loads validated Discord images into transient Pi image content", async () => {
    const fetchImage = vi.fn(async () => imageResponse());
    const loader = new DiscordImageInputLoader({ fetch: fetchImage });

    const first = await loader.load([{ images: [image] }]);
    const second = await loader.load([{ images: [image] }]);

    expect(first).toEqual([
      {
        type: "image",
        data: Buffer.from([1, 2, 3, 4]).toString("base64"),
        mimeType: "image/png",
      },
    ]);
    expect(second).toEqual(first);
    expect(fetchImage).toHaveBeenCalledOnce();
    expect(fetchImage).toHaveBeenCalledWith(
      image.url,
      expect.objectContaining({ method: "GET", redirect: "error" }),
    );
  });

  it("does not fetch spoofed hosts or mismatched response media", async () => {
    const fetchImage = vi.fn(async () => imageResponse(undefined, "image/jpeg"));
    const loader = new DiscordImageInputLoader({ fetch: fetchImage });

    await expect(
      loader.load([
        {
          images: [
            {
              ...image,
              url: "https://example.com/attachments/10/20/chart.png",
            },
          ],
        },
      ]),
    ).resolves.toEqual([]);
    expect(fetchImage).not.toHaveBeenCalled();

    await expect(loader.load([{ images: [image] }])).resolves.toEqual([]);
    expect(fetchImage).toHaveBeenCalledOnce();
  });

  it("requires Discord CDN attachment paths", () => {
    expect(isDiscordAttachmentImageUrl(image.url)).toBe(true);
    expect(
      isDiscordAttachmentImageUrl("https://cdn.discordapp.com/emojis/20.png"),
    ).toBe(false);
    expect(
      isDiscordAttachmentImageUrl(
        "https://cdn.discordapp.com.evil.test/attachments/10/20/chart.png",
      ),
    ).toBe(false);
  });
});
