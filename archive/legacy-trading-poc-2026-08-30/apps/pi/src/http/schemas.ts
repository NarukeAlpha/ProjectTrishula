import { z } from "zod";

const stableId = z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9:_-]+$/);
const boundedText = z.string().max(512 * 1024);

const historyPart = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: boundedText }).strict(),
  z.object({
    type: z.literal("tool"),
    toolCallId: z.string().min(1).max(2_048),
    name: z.string().trim().min(1).max(128),
    status: z.enum(["completed", "failed", "canceled"]),
    inputSummary: z.string().max(2_000).optional(),
    outputSummary: z.string().max(8_000).optional(),
    durationMs: z.number().finite().nonnegative().optional(),
  }).strict(),
  z.object({
    type: z.literal("error"),
    code: z.string().trim().min(1).max(128),
    message: z.string().max(8_000),
    retryable: z.boolean(),
  }).strict(),
]);

const historyMessage = z.object({
  messageId: stableId,
  role: z.enum(["user", "assistant"]),
  parts: z.array(historyPart).max(256),
}).strict();

export const runRequestSchema = z.object({
  commandId: stableId,
  runId: stableId,
  assistantMessageId: stableId,
  actorId: stableId,
  threadId: stableId,
  prompt: boundedText.refine((value) => value.trim().length > 0, "Prompt is empty."),
  history: z.array(historyMessage).max(1_000),
}).strict();

export const cancelParamsSchema = z.object({ runId: stableId }).strict();

export const cancelBodySchema = z.object({
  commandId: stableId,
  runId: stableId,
  actorId: stableId,
}).strict();

export const actorBodySchema = z.object({ actorId: stableId }).strict();

export const robinhoodCompleteSchema = z.object({
  actorId: stableId,
  code: z.string().trim().min(1).max(8_192),
  state: z.string().trim().min(1).max(512),
}).strict();

export const orderExecutionSchema = z.object({
  actorId: stableId,
  proposalId: stableId,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
