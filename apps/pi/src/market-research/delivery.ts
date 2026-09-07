import { createHash } from "node:crypto";
import type {
  MorningPaperEditionV1,
} from "./contracts.js";
import { deliveryPartSchema, type MarketResearchJobResult } from "./contracts.js";
import { neutralizeUntrustedDiscordMarkdown, splitSemanticContent } from "./semantic-chunker.js";

const MAX_REPLY_BODY_CHARACTERS = 1_850;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function starterContent(edition: MorningPaperEditionV1): string {
  const stories = edition.topStories.slice(0, 5).map((story) => `- ${story.text}`).join("\n");
  const events = edition.scheduledEvents.slice(0, 5).map((event) => `- ${event.text}`).join("\n") || "- No confirmed high-risk event";
  const setups = edition.primaryBoard.slice(0, 5).map((setup) => `- ${setup.symbol}: ${setup.label} (${setup.score})`).join("\n") || "- No qualified setup";
  const dataWarning = edition.dataQuality[0]?.text;
  return [
    `${edition.editionLabel} - ${edition.editionDate}`,
    `As of ${edition.asOf} | ${edition.regime}`,
    ...edition.regimeLines.map((line) => line.text),
    "Stories",
    stories,
    "Highest-risk scheduled events",
    events,
    "Long-only research board",
    setups,
    ...(dataWarning ? [`Data quality: ${dataWarning}`] : []),
    `Edition ID: MR-${edition.editionId}`,
  ].join("\n");
}

export function materializeDeliveryParts(
  edition: MorningPaperEditionV1,
): MarketResearchJobResult["deliveries"] {
  const starter = neutralizeUntrustedDiscordMarkdown(starterContent(edition));
  if (starter.length > 2_000) throw new Error("composition_schema_invalid");
  const chartRequestsBySection = new Map<string, string[]>();
  for (const request of edition.chartRequests) {
    const requests = chartRequestsBySection.get(request.sectionId) ?? [];
    requests.push(request.chartRequestId);
    chartRequestsBySection.set(request.sectionId, requests);
  }
  const rawReplies = edition.sections.flatMap((section) =>
    splitSemanticContent(neutralizeUntrustedDiscordMarkdown(section.markdown), MAX_REPLY_BODY_CHARACTERS).map((content, chunkIndex) => ({
      sectionId: section.sectionId,
      heading: section.heading,
      content,
      chartAttachmentIds: chunkIndex === 0
        ? chartRequestsBySection.get(section.sectionId) ?? []
        : [],
    })),
  );
  const total = rawReplies.length;
  const deliveries: MarketResearchJobResult["deliveries"] = [];
  const starterHash = sha256(starter);
  deliveries.push(deliveryPartSchema.parse({
    deliveryId: `${edition.editionId}:starter`,
    idempotencyKey: `${edition.editionId}:starter`,
    sequence: 0,
    kind: "starter",
    content: starter,
    contentHash: starterHash,
    sourceSectionIds: [],
    chartAttachmentIds: [],
    nonce: sha256(`${edition.editionId}:starter`).slice(0, 24),
  }));
  rawReplies.forEach((reply, index) => {
    const sequence = index + 1;
    const prefix = `Part ${sequence}/${total} - ${reply.heading}\n`;
    const content = `${prefix}${reply.content}`;
    if (content.length > 2_000) throw new Error("composition_schema_invalid");
    deliveries.push(deliveryPartSchema.parse({
      deliveryId: `${edition.editionId}:reply:${String(sequence).padStart(4, "0")}`,
      idempotencyKey: `${edition.editionId}:reply:${String(sequence).padStart(4, "0")}`,
      sequence,
      kind: "reply",
      content,
      contentHash: sha256(content),
      sourceSectionIds: [reply.sectionId],
      chartAttachmentIds: reply.chartAttachmentIds,
      nonce: sha256(`${edition.editionId}:reply:${sequence}`).slice(0, 24),
    }));
  });
  return deliveries;
}
