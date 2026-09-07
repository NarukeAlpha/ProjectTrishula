import {
  MARKET_RESEARCH_MAX_CHECKPOINT_BYTES,
  MARKET_RESEARCH_MAX_EVIDENCE_BYTES,
  assertEvidencePacketSize,
  jsonByteLength,
  marketResearchEvidenceItemSchema,
  morningPaperEvidenceSchema,
  type MarketResearchEvidenceItem,
  type MorningPaperEvidenceV1,
} from "./contracts.js";

export function normalizeEvidenceItems(
  items: readonly MarketResearchEvidenceItem[],
): MarketResearchEvidenceItem[] {
  return items.map((item) => marketResearchEvidenceItemSchema.parse(item));
}

export function boundedEvidencePacket(packet: MorningPaperEvidenceV1): MorningPaperEvidenceV1 {
  let candidate = morningPaperEvidenceSchema.parse(packet);
  if (jsonByteLength(candidate) <= MARKET_RESEARCH_MAX_EVIDENCE_BYTES) return candidate;
  const requiredKinds = new Set(["official", "calendar", "quote", "source_status"]);
  const optional = candidate.evidence.filter((item) => !requiredKinds.has(item.kind));
  const required = candidate.evidence.filter((item) => requiredKinds.has(item.kind));
  while (optional.length > 0) {
    optional.pop();
    candidate = { ...candidate, evidence: [...required, ...optional] };
    const retainedIds = new Set(candidate.evidence.map((item) => item.evidenceId));
    candidate = {
      ...candidate,
      allowedSourceIds: candidate.allowedSourceIds.filter((sourceId) => retainedIds.has(sourceId)),
      session: {
        ...candidate.session,
        sourceIds: candidate.session.sourceIds.filter((sourceId) => retainedIds.has(sourceId)),
      },
      requestedSourceStatus: candidate.requestedSourceStatus.map((status) => {
        const retainedSourceIds = status.sourceIds.filter((sourceId) => retainedIds.has(sourceId));
        return status.status === "contributed" && retainedSourceIds.length === 0
          ? {
              ...status,
              status: "no_material_item" as const,
              detail: "No retained material item remained after the bounded evidence reduction.",
              sourceIds: retainedSourceIds,
            }
          : { ...status, sourceIds: retainedSourceIds };
      }),
      conflicts: candidate.conflicts
        .map((conflict) => ({
          ...conflict,
          sourceIds: conflict.sourceIds.filter((sourceId) => retainedIds.has(sourceId)),
        }))
        .filter((conflict) => conflict.sourceIds.length > 0),
    };
    if (jsonByteLength(candidate) <= MARKET_RESEARCH_MAX_EVIDENCE_BYTES) {
      return morningPaperEvidenceSchema.parse(candidate);
    }
  }
  assertEvidencePacketSize(candidate);
  return candidate;
}

export function evidenceCheckpoints(
  evidence: readonly MarketResearchEvidenceItem[],
): MarketResearchEvidenceItem[][] {
  const checkpoints: MarketResearchEvidenceItem[][] = [];
  let current: MarketResearchEvidenceItem[] = [];
  for (const item of evidence) {
    if (jsonByteLength(item) > MARKET_RESEARCH_MAX_CHECKPOINT_BYTES) {
      throw new Error("evidence_below_minimum");
    }
    const next = [...current, item];
    if (current.length > 0 && jsonByteLength(next) > MARKET_RESEARCH_MAX_CHECKPOINT_BYTES) {
      checkpoints.push(current);
      current = [item];
    } else current = next;
  }
  if (current.length > 0) checkpoints.push(current);
  return checkpoints;
}
