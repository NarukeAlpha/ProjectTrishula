/* oxlint-disable anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type, anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-known-value-widening, anti-slop/no-conditional-empty-object-spread -- The official Exa SDK exposes version-dependent provider payloads; this adapter validates and bounds every value before domain use. */
import { AgentRunCancelledError, AgentRunFailedError, Exa } from "exa-js";
import type { Logger } from "../runtime/logger.js";
import type { ResearchPlanSlot } from "./research-plan.js";
import { MarketResearchExaError, classifyExaError } from "./exa-errors.js";
import {
  canonicalSourceUrl,
  normalizedContentFingerprint,
  requirePublicHttpsUrl,
  sanitizeUntrustedEvidenceText,
  sha256,
} from "./source-normalizer.js";

const EXA_ORIGIN = "https://api.exa.ai";
const DEFAULT_HIGHLIGHT_QUERY = "market-moving facts, named assets, exact dates, official actions, guidance, risks, and quantified claims";

export interface ExaSearchSdkOptions {
  type: "auto";
  category: "news" | "financial report";
  userLocation: "US";
  numResults: number;
  moderation: true;
  startPublishedDate: string;
  endPublishedDate: string;
  includeDomains?: string[];
  excludeDomains?: string[];
  contents: {
    highlights: true;
    maxAgeHours: 1;
    livecrawlTimeout: 12_000;
  };
}

export interface ExaContentsSdkOptions {
  highlights: { query: string };
  maxAgeHours: 1;
  livecrawlTimeout: 12_000;
  text?: { maxCharacters: 12_000 };
}

export interface ExaSdkTransport {
  search(query: string, options: ExaSearchSdkOptions, signal?: AbortSignal): Promise<unknown>;
  getContents(urls: string | string[], options: ExaContentsSdkOptions, signal?: AbortSignal): Promise<unknown>;
  runFinancialDataset?(request: FinancialDatasetEvaluationRequest, signal?: AbortSignal): Promise<unknown>;
}

class OfficialExaSdkTransport implements ExaSdkTransport {
  private readonly client: Exa;

  constructor(apiKey: string) {
    this.client = new Exa(apiKey, EXA_ORIGIN);
  }

  search(query: string, options: ExaSearchSdkOptions, signal?: AbortSignal): Promise<unknown> {
    throwIfAborted(signal);
    // exa-js 2.19.0 does not accept an AbortSignal for Search or Contents.
    // The client therefore closes the edition budget on abort and keeps the
    // paid-work permits occupied until the in-flight SDK promise settles.
    return this.client.search(query, options);
  }

  getContents(urls: string | string[], options: ExaContentsSdkOptions, signal?: AbortSignal): Promise<unknown> {
    throwIfAborted(signal);
    return this.client.getContents(urls, options);
  }

  runFinancialDataset(request: FinancialDatasetEvaluationRequest, signal?: AbortSignal): Promise<unknown> {
    throwIfAborted(signal);
    return this.client.agent.runs.createAndWait({
      query: request.query,
      dataSources: [{ provider: "financial_datasets" }],
      outputSchema: request.outputSchema,
      effort: "auto",
      budget: { maxCostDollars: request.maxCostDollars },
      metadata: { evaluationId: request.evaluationId },
    });
  }
}

class Semaphore {
  private active = 0;
  private readonly waiting: Array<{
    resolve: () => void;
    reject: (reason: Error) => void;
    signal?: AbortSignal;
    abort?: () => void;
  }> = [];

  constructor(private readonly limit: number) {}

  async use<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal);
    try {
      throwIfAborted(signal);
      return await operation();
    } finally {
      this.release();
    }
  }

  private acquire(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: (typeof this.waiting)[number] = {
        resolve: () => {
          if (waiter.abort) signal?.removeEventListener("abort", waiter.abort);
          resolve();
        },
        reject,
        ...(signal === undefined ? {} : { signal }),
      };
      waiter.abort = () => {
        const index = this.waiting.indexOf(waiter);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(abortError(signal));
      };
      signal?.addEventListener("abort", waiter.abort, { once: true });
      this.waiting.push(waiter);
    });
  }

  private release(): void {
    while (this.waiting.length > 0) {
      const waiter = this.waiting.shift();
      if (!waiter) break;
      if (waiter.signal?.aborted) {
        waiter.reject(abortError(waiter.signal));
        continue;
      }
      waiter.resolve();
      return;
    }
    this.active -= 1;
  }
}

interface RawExaResult {
  id?: unknown;
  title?: unknown;
  url?: unknown;
  publishedDate?: unknown;
  author?: unknown;
  highlights?: unknown;
  text?: unknown;
  status?: unknown;
}

interface RawExaResponse {
  requestId?: unknown;
  resolvedSearchType?: unknown;
  searchTime?: unknown;
  costDollars?: { total?: unknown; search?: unknown; contents?: unknown };
  results?: unknown;
  statuses?: unknown;
  output?: unknown;
}

export interface SearchEvidenceResult {
  evidenceId: string;
  exaDocumentId: string;
  title: string;
  url: string;
  publishedDate?: string;
  author?: string;
  highlights: string[];
  contentHash: string;
}

export interface SearchEvidenceBatch {
  queryId: string;
  requestId: string;
  resolvedSearchType?: string;
  searchTimeMs?: number;
  costUsd: number;
  results: SearchEvidenceResult[];
  retrievedAt: string;
}

export interface ContentEvidenceStatus {
  url: string;
  status: "available" | "cached" | "delayed" | "stale" | "unknown" | "blocked" | "unavailable";
  requestId?: string;
  title?: string;
  author?: string;
  publishedDate?: string;
  highlights: string[];
  text?: string;
  costUsd: number;
  errorCode?: string;
  retrievedAt: string;
}

export interface ContentEvidenceBatch {
  results: ContentEvidenceStatus[];
  costUsd: number;
}

export interface FinancialDatasetEvaluationRequest {
  evaluationId: string;
  query: string;
  outputSchema: Record<string, unknown>;
  maxCostDollars: number;
}

export interface StructuredMarketEvidence {
  evaluationId: string;
  status: "completed" | "failed";
  raw: unknown;
}

export interface ExaCostEvent {
  operation: "search" | "contents" | "financial_datasets";
  outcome: "settled" | "abandoned" | "failed";
  costUsd: number | null;
  late: boolean;
  observedAt: string;
  requestId?: string;
}

export interface ExaClientOptions {
  apiKey: string;
  searchConcurrency: number;
  contentsConcurrency: number;
  requestTimeoutMs: number;
  maximumSearchRequests: number;
  maximumContentPages: number;
  maximumCostUsd?: number;
  logger: Logger;
  transport?: ExaSdkTransport;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  now?: () => Date;
  onCostEvent?: (event: Readonly<ExaCostEvent>) => void | Promise<void>;
}

function rawResponse(value: unknown): RawExaResponse {
  if (typeof value !== "object" || value === null) throw new Error("exa_invalid_request");
  return value as RawExaResponse;
}

function rawResults(response: RawExaResponse): RawExaResult[] {
  if (!Array.isArray(response.results)) return [];
  return response.results.filter((value): value is RawExaResult => typeof value === "object" && value !== null);
}

function cost(response: RawExaResponse): number | null {
  const total = response.costDollars?.total;
  return typeof total === "number" && Number.isFinite(total) && total >= 0 ? total : null;
}

function abortError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error("aborted");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    const timer = setTimeout(resolve, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function stringField(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" && value.trim() ? sanitizeUntrustedEvidenceText(value, maximum) : undefined;
}

function hostnameMatchesDomain(hostname: string, domain: string): boolean {
  const normalized = domain.trim().toLowerCase().replace(/^\.+|\.+$/gu, "");
  return normalized.length > 0 && (hostname === normalized || hostname.endsWith(`.${normalized}`));
}

export function resultUrlMatchesSlotPolicy(url: string, slot: ResearchPlanSlot): boolean {
  const hostname = new URL(url).hostname.toLowerCase();
  if (slot.excludeDomains?.some((domain) => hostnameMatchesDomain(hostname, domain))) return false;
  return slot.includeDomains === undefined
    || slot.includeDomains.some((domain) => hostnameMatchesDomain(hostname, domain));
}

export class MarketResearchExaClient {
  private readonly searchSemaphore: Semaphore;
  private readonly contentsSemaphore: Semaphore;
  private readonly evaluationSemaphore = new Semaphore(1);
  private readonly transport: ExaSdkTransport;
  private readonly sleep: NonNullable<ExaClientOptions["sleep"]>;
  private readonly random: NonNullable<ExaClientOptions["random"]>;
  private readonly now: NonNullable<ExaClientOptions["now"]>;
  private readonly costGate: Semaphore | undefined;
  private searchRequests = 0;
  private contentPages = 0;
  private accruedCostUsd = 0;
  private budgetClosed = false;
  private costStatus: "known" | "unknown" = "known";
  private readonly costEvents: ExaCostEvent[] = [];

  constructor(private readonly options: ExaClientOptions) {
    if (!options.apiKey.trim()) throw new Error("exa_not_configured");
    this.searchSemaphore = new Semaphore(options.searchConcurrency);
    this.contentsSemaphore = new Semaphore(options.contentsConcurrency);
    this.transport = options.transport ?? new OfficialExaSdkTransport(options.apiKey);
    this.sleep = options.sleep ?? wait;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? (() => new Date());
    this.costGate = options.maximumCostUsd === undefined ? undefined : new Semaphore(1);
  }

  usage(): {
    searchRequests: number;
    contentPages: number;
    costUsd: number;
    costStatus: "known" | "unknown";
    budgetClosed: boolean;
  } {
    return {
      searchRequests: this.searchRequests,
      contentPages: this.contentPages,
      costUsd: this.accruedCostUsd,
      costStatus: this.costStatus,
      budgetClosed: this.budgetClosed,
    };
  }

  costLedger(): readonly ExaCostEvent[] {
    return this.costEvents.map((event) => ({ ...event }));
  }

  async searchNews(slot: ResearchPlanSlot, signal?: AbortSignal): Promise<SearchEvidenceBatch> {
    throwIfAborted(signal);
    this.assertCostAvailable();
    if (slot.policyResolution !== undefined) {
      throw new Error("Source-policy-resolved slots must not call Exa.");
    }
    if (this.searchRequests >= this.options.maximumSearchRequests) throw new MarketResearchExaError({
      code: "exa_budget_exhausted", retryable: false, maximumRetries: 0, scope: "request", finalForSource: true,
    });
    const searchOptions: ExaSearchSdkOptions = {
      type: "auto",
      category: slot.category,
      userLocation: "US",
      numResults: slot.numResults,
      moderation: true,
      startPublishedDate: slot.startPublishedDate,
      endPublishedDate: slot.endPublishedDate,
      contents: { highlights: true, maxAgeHours: 1, livecrawlTimeout: 12_000 },
    };
    if (slot.includeDomains !== undefined) searchOptions.includeDomains = slot.includeDomains;
    if (slot.excludeDomains !== undefined) searchOptions.excludeDomains = slot.excludeDomains;
    const { raw, requestCost } = await this.retry(
      () => this.withTimeout(
        (requestSignal, markProviderStarted) => this.withCostGate(
          () => this.searchSemaphore.use(async () => {
            this.assertCostAvailable();
            if (this.searchRequests >= this.options.maximumSearchRequests) throw new MarketResearchExaError({
              code: "exa_budget_exhausted", retryable: false, maximumRetries: 0, scope: "request", finalForSource: true,
            });
            this.searchRequests += 1;
            markProviderStarted();
            return this.paidRequest("search", requestSignal,
              () => this.transport.search(slot.query, searchOptions, requestSignal));
          }, requestSignal),
          requestSignal,
        ),
        signal,
      ),
      signal,
    );
    const requestId = stringField(raw.requestId, 256) ?? `missing-${slot.queryId}`;
    const results: SearchEvidenceResult[] = [];
    for (const result of rawResults(raw).slice(0, slot.numResults)) {
      const rawUrl = stringField(result.url, 2_000);
      const exaDocumentId = stringField(result.id, 256);
      if (!rawUrl || !exaDocumentId) continue;
      let url: string;
      try {
        url = canonicalSourceUrl(rawUrl);
      } catch {
        continue;
      }
      if (!resultUrlMatchesSlotPolicy(url, slot)) continue;
      const title = stringField(result.title, 500);
      if (!title || /\b(?:advertorial|paid content|sponsored content|stock promotion)\b/i.test(title)) continue;
      const highlights = Array.isArray(result.highlights)
        ? result.highlights
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => sanitizeUntrustedEvidenceText(entry, 2_000))
          .filter(Boolean)
          .slice(0, 20)
        : [];
      const evidence: SearchEvidenceResult = {
        evidenceId: `exa-${sha256(`${requestId}:${exaDocumentId}`).slice(0, 32)}`,
        exaDocumentId,
        title,
        url,
        highlights,
        contentHash: normalizedContentFingerprint(title, highlights),
      };
      const publishedDate = stringField(result.publishedDate, 100);
      const author = stringField(result.author, 200);
      if (publishedDate !== undefined && !Number.isNaN(Date.parse(publishedDate))) {
        evidence.publishedDate = new Date(publishedDate).toISOString();
      }
      if (author !== undefined) evidence.author = author;
      results.push(evidence);
    }
    const batch: SearchEvidenceBatch = {
      queryId: slot.queryId,
      requestId,
      costUsd: requestCost,
      results,
      retrievedAt: this.now().toISOString(),
    };
    const resolvedSearchType = stringField(raw.resolvedSearchType, 100);
    if (resolvedSearchType !== undefined) batch.resolvedSearchType = resolvedSearchType;
    if (typeof raw.searchTime === "number" && Number.isFinite(raw.searchTime) && raw.searchTime >= 0) {
      batch.searchTimeMs = raw.searchTime;
    }
    return batch;
  }

  async getSelectedContents(
    urls: readonly string[],
    options: { includeText?: boolean } = {},
    signal?: AbortSignal,
  ): Promise<ContentEvidenceBatch> {
    throwIfAborted(signal);
    this.assertCostAvailable();
    const unique = [...new Set(urls.map((url) => requirePublicHttpsUrl(url).toString()))];
    if (this.contentPages + unique.length > this.options.maximumContentPages) {
      throw new MarketResearchExaError({
        code: "exa_budget_exhausted", retryable: false, maximumRetries: 0, scope: "request", finalForSource: true,
      });
    }
    const contentsOptions: ExaContentsSdkOptions = {
      highlights: { query: DEFAULT_HIGHLIGHT_QUERY },
      maxAgeHours: 1,
      livecrawlTimeout: 12_000,
    };
    if (options.includeText) contentsOptions.text = { maxCharacters: 12_000 };
    const results = await Promise.all(unique.map(async (url) => {
      const retrievedAt = this.now().toISOString();
      try {
        const { raw, requestCost } = await this.retry(
          () => this.withTimeout(
            (requestSignal, markProviderStarted) => this.withCostGate(
              () => this.contentsSemaphore.use(async () => {
                this.assertCostAvailable();
                if (this.contentPages >= this.options.maximumContentPages) throw new MarketResearchExaError({
                  code: "exa_budget_exhausted", retryable: false, maximumRetries: 0, scope: "request", finalForSource: true,
                });
                this.contentPages += 1;
                markProviderStarted();
                return this.paidRequest("contents", requestSignal,
                  () => this.transport.getContents(url, contentsOptions, requestSignal));
              }, requestSignal),
              requestSignal,
            ),
            signal,
          ),
          signal,
        );
        const result = rawResults(raw)[0];
        if (!result) return { url, status: "unavailable" as const, highlights: [], costUsd: requestCost, retrievedAt, errorCode: "source_unavailable" };
        const highlights = Array.isArray(result.highlights)
          ? result.highlights.filter((entry): entry is string => typeof entry === "string")
            .map((entry) => sanitizeUntrustedEvidenceText(entry, 2_000)).filter(Boolean).slice(0, 20)
          : [];
        const rawStatus = stringField(result.status, 50)?.toLowerCase();
        const normalizedStatus: ContentEvidenceStatus["status"] = rawStatus === undefined || rawStatus === "available"
          ? "available"
          : rawStatus === "cached" || rawStatus === "delayed" || rawStatus === "stale" || rawStatus === "unknown" || rawStatus === "blocked"
            ? rawStatus
            : rawStatus === "unavailable" || rawStatus === "failed"
              ? "unavailable"
              : "unknown";
        const item: ContentEvidenceStatus = {
          url,
          status: normalizedStatus,
          highlights,
          costUsd: requestCost,
          retrievedAt,
        };
        const requestId = stringField(raw.requestId, 256);
        const title = stringField(result.title, 500);
        const author = stringField(result.author, 200);
        const publishedDate = stringField(result.publishedDate, 100);
        const text = options.includeText ? stringField(result.text, 12_000) : undefined;
        if (requestId !== undefined) item.requestId = requestId;
        if (title !== undefined) item.title = title;
        if (author !== undefined) item.author = author;
        if (publishedDate !== undefined && !Number.isNaN(Date.parse(publishedDate))) item.publishedDate = new Date(publishedDate).toISOString();
        if (text !== undefined) item.text = text;
        return item;
      } catch (error) {
        const decision = error instanceof MarketResearchExaError ? error.decision : classifyExaError(error);
        if (decision.scope !== "url" && decision.scope !== "batch") throw error;
        return {
          url,
          status: decision.code === "source_rights_blocked" ? "blocked" as const : "unavailable" as const,
          highlights: [],
          costUsd: 0,
          retrievedAt,
          errorCode: decision.code,
          ...(decision.requestId ? { requestId: decision.requestId } : {}),
        };
      }
    }));
    return { results, costUsd: results.reduce((sum, result) => sum + result.costUsd, 0) };
  }

  async runFinancialDatasetEvaluation(
    request: FinancialDatasetEvaluationRequest,
    signal?: AbortSignal,
  ): Promise<StructuredMarketEvidence> {
    throwIfAborted(signal);
    this.assertCostAvailable();
    if (!this.transport.runFinancialDataset) throw new Error("exa_invalid_request");
    try {
      const { raw } = await this.retry(
        () => this.withTimeout(
          (requestSignal, markProviderStarted) => this.withCostGate(
            () => this.evaluationSemaphore.use(() => {
              this.assertCostAvailable();
              markProviderStarted();
              return this.paidRequest("financial_datasets", requestSignal,
                () => this.transport.runFinancialDataset?.(request, requestSignal)
                  ?? Promise.reject(new Error("exa_invalid_request")));
            }, requestSignal),
            requestSignal,
          ),
          signal,
        ),
        signal,
      );
      return { evaluationId: request.evaluationId, status: "completed", raw };
    } catch (error) {
      const decision = classifyExaError(error);
      if (decision.tag === "ZDR_INCOMPATIBLE" || decision.tag === "ZERO_DATA_RETENTION_INCOMPATIBLE") {
        throw new Error("exa_connect_zdr_incompatible");
      }
      throw new MarketResearchExaError(decision);
    }
  }

  private assertCostAvailable(): void {
    if (
      this.budgetClosed
      || (this.options.maximumCostUsd !== undefined && this.accruedCostUsd >= this.options.maximumCostUsd)
    ) {
      throw new MarketResearchExaError({
        code: "exa_budget_exhausted", retryable: false, maximumRetries: 0, scope: "request", finalForSource: true,
      });
    }
  }

  private addCost(value: number): void {
    this.accruedCostUsd += value;
    if (this.options.maximumCostUsd !== undefined && this.accruedCostUsd > this.options.maximumCostUsd) {
      this.options.logger.warn("market_research_exa_cost_cap_reached", { code: "exa_budget_exhausted" });
    }
  }

  private recordCostEvent(event: ExaCostEvent): void {
    this.costEvents.push(event);
    if (this.costEvents.length > 128) this.costEvents.shift();
    const observer = this.options.onCostEvent;
    if (observer) {
      void Promise.resolve().then(() => observer({ ...event })).catch(() => {
        this.options.logger.warn("market_research_exa_cost_observer_failed");
      });
    }
  }

  private async paidRequest(
    operation: ExaCostEvent["operation"],
    signal: AbortSignal,
    invoke: () => Promise<unknown>,
  ): Promise<{ raw: RawExaResponse; requestCost: number }> {
    let providerResolved = false;
    const abandoned = () => this.recordCostEvent({
      operation, outcome: "abandoned", costUsd: null, late: false, observedAt: this.now().toISOString(),
    });
    signal.addEventListener("abort", abandoned, { once: true });
    try {
      const value = await invoke();
      providerResolved = true;
      const raw = rawResponse(value);
      const requestCost = cost(raw);
      this.accountCost(requestCost);
      const requestId = stringField(raw.requestId, 256);
      this.recordCostEvent({
        operation, outcome: "settled", costUsd: requestCost, late: signal.aborted,
        observedAt: this.now().toISOString(),
        ...(requestId === undefined ? {} : { requestId }),
      });
      return { raw, requestCost: requestCost ?? 0 };
    } catch (error) {
      const failedRun = error instanceof AgentRunFailedError || error instanceof AgentRunCancelledError ? error.run : null;
      if (failedRun || providerResolved || signal.aborted) {
        const failedCost = failedRun === null ? null : cost(failedRun);
        this.accountCost(failedCost);
        const requestId = failedRun === null ? undefined : stringField(failedRun.id, 256);
        this.recordCostEvent({
          operation, outcome: "failed", costUsd: failedCost, late: signal.aborted, observedAt: this.now().toISOString(),
          ...(requestId === undefined ? {} : { requestId }),
        });
      }
      throw error;
    } finally {
      signal.removeEventListener("abort", abandoned);
    }
  }

  private accountCost(value: number | null): void {
    if (value === null) {
      this.costStatus = "unknown";
      if (this.options.maximumCostUsd !== undefined) this.budgetClosed = true;
    } else {
      this.addCost(value);
    }
  }

  private withCostGate<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    throwIfAborted(signal);
    return this.costGate === undefined ? operation() : this.costGate.use(operation, signal);
  }

  private async retry<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    let attempt = 0;
    while (true) {
      try {
        throwIfAborted(signal);
        return await operation();
      } catch (error) {
        if (error instanceof MarketResearchExaError) throw error;
        if (this.budgetClosed) {
          throw new MarketResearchExaError({
            code: "exa_budget_exhausted", retryable: false, maximumRetries: 0, scope: "request", finalForSource: true,
          });
        }
        if (error instanceof Error && ["composition_timeout", "edition_lease_lost"].includes(error.message)) {
          throw error;
        }
        const decision = classifyExaError(error);
        if (!decision.retryable || attempt >= decision.maximumRetries) throw new MarketResearchExaError(decision);
        const exponential = Math.min(30_000, 500 * 2 ** attempt);
        const jittered = Math.round(exponential * (0.75 + this.random() * 0.5));
        await this.sleep(Math.max(decision.retryAfterMs ?? 0, jittered), signal);
        attempt += 1;
      }
    }
  }

  private async withTimeout<T>(
    operation: (requestSignal: AbortSignal, markProviderStarted: () => void) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    throwIfAborted(signal);
    let providerStarted = false;
    let operationSettled = false;
    const timeout = new AbortController();
    const abort = () => timeout.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => timeout.abort(new Error("Exa request timed out.")), this.options.requestTimeoutMs);
    const aborted = new Promise<T>((_resolve, reject) => {
      timeout.signal.addEventListener("abort", () => {
        if (providerStarted && !operationSettled) {
          this.budgetClosed = true;
          this.costStatus = "unknown";
        }
        if (signal?.aborted) {
          reject(abortError(signal));
          return;
        }
        const error = new Error("Exa request timed out.") as Error & { code: string };
        error.code = "ETIMEDOUT";
        reject(error);
      }, { once: true });
    });
    const inFlight = Promise.resolve()
      .then(() => operation(timeout.signal, () => { providerStarted = true; }))
      .finally(() => { operationSettled = true; });
    try {
      return await Promise.race([inFlight, aborted]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
}
