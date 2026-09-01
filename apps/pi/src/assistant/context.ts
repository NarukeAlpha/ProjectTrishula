import { createHash } from "node:crypto";

export interface CanonicalConversationMessage {
  eventId: string;
  ordinal: number;
  role: "human" | "assistant";
  authorId?: string | undefined;
  displayName?: string | undefined;
  content: string;
  createdAt: string;
}

export interface PortableConversationSummary {
  participants: Array<{ authorId: string; displayName?: string | undefined }>;
  acceptedFacts: Array<{
    statement: string;
    subjectAuthorId?: string | undefined;
    assertedByAuthorId?: string | undefined;
    sourceEventIds: string[];
    asOf?: string | undefined;
    freshness?: "current" | "limited" | "unknown" | undefined;
  }>;
  corrections: Array<{
    rejectedStatement: string;
    replacementStatement: string;
    correctedByAuthorId?: string | undefined;
    sourceEventIds: string[];
    asOf?: string | undefined;
  }>;
  unresolvedQuestions: Array<{
    question: string;
    askedByAuthorId: string;
    sourceEventIds: string[];
  }>;
  commitments: Array<{
    statement: string;
    owner:
      | { kind: "assistant" }
      | { kind: "participant"; authorId: string };
    status: "open" | "resolved" | "cancelled";
    sourceEventIds: string[];
  }>;
  conversationPreferences: Array<{
    statement: string;
    authorId: string;
    sourceEventIds: string[];
  }>;
  sourceFreshnessNotes: Array<{
    statement: string;
    sourceEventIds: string[];
    asOf?: string | undefined;
    freshness: "current" | "limited" | "unknown";
  }>;
}

export interface DurableConversationContext {
  sourceRevision: number;
  sourceHumanRevision: number;
  activeCheckpointId?: string | undefined;
  portableSummary?: PortableConversationSummary | undefined;
  recentEvents: CanonicalConversationMessage[];
  tail: {
    estimatorVersion: "utf8-bytes-div-3-plus-message-overhead:v1";
    tokenBudget: number;
    estimatedTokens: number;
    compactedThroughOrdinal: number;
    omittedEventCount: number;
    firstRetainedOrdinal?: number | undefined;
    lastRetainedOrdinal?: number | undefined;
    complete: boolean;
  };
}

export const EMPTY_PORTABLE_CONVERSATION_SUMMARY: PortableConversationSummary = {
  participants: [],
  acceptedFacts: [],
  corrections: [],
  unresolvedQuestions: [],
  commitments: [],
  conversationPreferences: [],
  sourceFreshnessNotes: [],
};

export function conversationCacheKey(
  conversationId: string,
  epoch: number,
  ownerBindingVersion: number,
): string {
  return createHash("sha256")
    .update(JSON.stringify([conversationId, epoch, ownerBindingVersion]), "utf8")
    .digest("hex");
}

export function composeDurableConversationContext(context: DurableConversationContext): string {
  return JSON.stringify({
    checkpoint: context.portableSummary ?? null,
    tail: context.tail,
    recentConversation: context.recentEvents.map((event) => ({
      eventId: event.eventId,
      ordinal: event.ordinal,
      role: event.role,
      authorId: event.authorId,
      displayName: event.displayName,
      content: event.content,
      createdAt: event.createdAt,
    })),
  });
}
