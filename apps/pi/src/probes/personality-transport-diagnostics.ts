import { z } from "zod";

const MAX_DIAGNOSTIC_BODY_BYTES = 64 * 1_024;
const DIAGNOSTIC_BODY_TIMEOUT_MS = 2_000;
const safeProviderTokenSchema = z.string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/);
const safeProviderParamSchema = z.enum([
  "context_management",
  "context_management.compact_threshold",
  "input",
  "model",
  "previous_response_id",
  "reasoning",
  "reasoning.effort",
  "service_tier",
  "store",
  "stream",
]);
const providerErrorCandidateSchema = z.object({
  code: safeProviderTokenSchema.optional(),
  param: z.string().optional(),
  type: safeProviderTokenSchema.optional(),
}).passthrough();
const providerErrorEnvelopeSchema = providerErrorCandidateSchema.extend({
  error: providerErrorCandidateSchema.optional(),
  response: z.object({
    error: providerErrorCandidateSchema.optional(),
  }).passthrough().optional(),
}).passthrough();
const providerSseEventSchema = providerErrorEnvelopeSchema.extend({
  type: z.string(),
}).passthrough();
const transportErrorCauseSchema = z.object({
  code: safeProviderTokenSchema.optional(),
}).passthrough();

export type PersonalityProbeTransportPhase =
  | "native_compaction"
  | "same_process_continuation"
  | "fresh_runtime_continuation";

type ProbeEndpoint =
  | "chatgpt_codex_responses"
  | "other_https"
  | "non_https"
  | "invalid_url";

type ProbeResponseMedia = "sse" | "json" | "other" | "missing";

export interface PersonalityProbeTransportRecord {
  phase: PersonalityProbeTransportPhase;
  request: number;
  endpoint: ProbeEndpoint;
  outcome: "response" | "transport_error";
  httpStatus?: number;
  responseMedia?: ProbeResponseMedia;
  providerErrorCode?: string;
  providerErrorParam?: z.infer<typeof safeProviderParamSchema>;
  providerErrorType?: string;
  errorName?: string;
  errorCode?: string;
}

interface ProviderErrorMetadata {
  providerErrorCode?: string;
  providerErrorParam?: z.infer<typeof safeProviderParamSchema>;
  providerErrorType?: string;
}

function providerErrorMetadata(
  root: z.infer<typeof providerErrorEnvelopeSchema>,
): ProviderErrorMetadata {
  const candidates = [
    root.error,
    root.response?.error,
    root,
  ];
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    const providerErrorCode = candidate.code;
    const parsedProviderErrorParam = safeProviderParamSchema.safeParse(candidate.param);
    const providerErrorParam = parsedProviderErrorParam.success
      ? parsedProviderErrorParam.data
      : undefined;
    const providerErrorType = candidate.type;
    if (
      providerErrorCode !== undefined
      || providerErrorParam !== undefined
      || providerErrorType !== undefined
    ) {
      const metadata: ProviderErrorMetadata = {};
      if (providerErrorCode !== undefined) metadata.providerErrorCode = providerErrorCode;
      if (providerErrorParam !== undefined) metadata.providerErrorParam = providerErrorParam;
      if (providerErrorType !== undefined) metadata.providerErrorType = providerErrorType;
      return metadata;
    }
  }
  return {};
}

function providerErrorFromBody(text: string): ProviderErrorMetadata {
  try {
    const parsed = providerErrorEnvelopeSchema.safeParse(JSON.parse(text));
    if (parsed.success) return providerErrorMetadata(parsed.data);
  } catch {
    // An SSE response can carry a structured error inside a data field.
  }
  for (const block of text.replaceAll("\r\n", "\n").split("\n\n")) {
    const data = block.split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (data === "" || data === "[DONE]") continue;
    try {
      const parsed = providerSseEventSchema.safeParse(JSON.parse(data));
      if (!parsed.success) continue;
      const eventType = parsed.data.type;
      if (
        eventType !== "error"
        && eventType !== "response.failed"
        && eventType !== "response.incomplete"
      ) continue;
      const metadata = providerErrorMetadata(parsed.data);
      if (
        metadata.providerErrorCode !== undefined
        || metadata.providerErrorParam !== undefined
        || metadata.providerErrorType !== undefined
      ) return metadata;
    } catch {
      // Malformed provider data is diagnosed by the production parser.
    }
  }
  return {};
}

async function boundedDiagnosticBody(response: Response): Promise<string | undefined> {
  if (response.body === null) return undefined;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const timedOut = Symbol("diagnostic_timeout");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof timedOut>((resolve) => {
    timer = setTimeout(() => {
      void reader.cancel().catch(() => undefined);
      resolve(timedOut);
    }, DIAGNOSTIC_BODY_TIMEOUT_MS);
  });
  const read = (async (): Promise<string> => {
    let bytes = 0;
    let text = "";
    while (true) {
      const next = await reader.read();
      if (next.done) return text + decoder.decode();
      bytes += next.value.byteLength;
      if (bytes > MAX_DIAGNOSTIC_BODY_BYTES) {
        await reader.cancel();
        return text;
      }
      text += decoder.decode(next.value, { stream: true });
    }
  })();
  try {
    const result = await Promise.race([read, timeout]);
    return result === timedOut ? undefined : result;
  } catch {
    return undefined;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function endpoint(input: Parameters<typeof globalThis.fetch>[0]): ProbeEndpoint {
  try {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (
      url.protocol === "https:"
      && url.hostname === "chatgpt.com"
      && url.pathname.endsWith("/codex/responses")
    ) return "chatgpt_codex_responses";
    return url.protocol === "https:" ? "other_https" : "non_https";
  } catch {
    return "invalid_url";
  }
}

function responseMedia(response: Response): ProbeResponseMedia {
  const contentType = response.headers.get("content-type")?.toLowerCase();
  if (contentType === undefined) return "missing";
  if (contentType.includes("text/event-stream")) return "sse";
  if (contentType.includes("application/json")) return "json";
  return "other";
}

function transportErrorMetadata(error: Error): Pick<
  PersonalityProbeTransportRecord,
  "errorName" | "errorCode"
> {
  const parsedName = safeProviderTokenSchema.safeParse(error.name);
  const parsedCause = transportErrorCauseSchema.safeParse(error.cause);
  const metadata: Pick<PersonalityProbeTransportRecord, "errorName" | "errorCode"> = {};
  if (parsedName.success) metadata.errorName = parsedName.data;
  if (parsedCause.success && parsedCause.data.code !== undefined) {
    metadata.errorCode = parsedCause.data.code;
  }
  return metadata;
}

export class PersonalityProbeTransportDiagnostics {
  private readonly records: PersonalityProbeTransportRecord[] = [];
  private readonly inspections: Promise<void>[] = [];

  constructor(
    private readonly upstreamFetch: typeof globalThis.fetch = globalThis.fetch,
  ) {}

  fetchFor(phase: PersonalityProbeTransportPhase): typeof globalThis.fetch {
    return async (input, init) => {
      const record: PersonalityProbeTransportRecord = {
        phase,
        request: this.records.length + 1,
        endpoint: endpoint(input),
        outcome: "transport_error",
      };
      this.records.push(record);
      try {
        const response = await this.upstreamFetch(input, init);
        record.outcome = "response";
        record.httpStatus = response.status;
        record.responseMedia = responseMedia(response);
        if (!response.ok || record.responseMedia === "sse") {
          const inspection = boundedDiagnosticBody(response.clone())
            .then((body) => {
              if (body === undefined) return;
              Object.assign(record, providerErrorFromBody(body));
            })
            .catch(() => undefined);
          this.inspections.push(inspection);
        }
        return response;
      } catch (error) {
        if (error instanceof Error) {
          Object.assign(record, transportErrorMetadata(error));
        }
        throw error;
      }
    };
  }

  async snapshot(): Promise<PersonalityProbeTransportRecord[]> {
    await Promise.all(this.inspections);
    return this.records.map((record) => ({ ...record }));
  }
}
