/* oxlint-disable anti-slop/no-known-value-widening, anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-unsafe-dictionary-type, anti-slop/no-conditional-empty-object-spread -- Discord SDK errors are untyped; this boundary normalizes them and omits unavailable exact optional fields. */
import { createHash } from "node:crypto";
import {
  ChannelType,
  PermissionFlagsBits,
  type AnyThreadChannel,
  type Client,
  type ForumChannel,
  type Message,
} from "discord.js";
import type { MarketResearchPublicationClient } from "./convex-client.js";
import type {
  ClaimedPublication,
  MarketResearchChartRequest,
  MarketResearchSafeError,
  PublicationAcknowledgement,
} from "./contracts.js";
import type { MarketChartRenderer } from "../media/chart-img.js";
import type { ProviderMarketChartSpec, RenderedMarketChart } from "../media/market-chart.js";
import { PublicationTelemetry, type PublicationLogSink } from "./publication-telemetry.js";

const MAX_RECENT_FORUM_THREADS = 100;
const MAX_RECENT_THREAD_MESSAGES = 100;
const DEFAULT_RECONCILIATION_DELAYS_MS = [250, 750, 1_500] as const;

interface ReconciledStarter {
  state: "found";
  threadId: string;
  messageId: string;
}

type StarterReconciliation = ReconciledStarter | { state: "none" } | { state: "duplicate"; earliest: ReconciledStarter };

export interface ForumPublisherOptions {
  client: Client;
  convex: MarketResearchPublicationClient;
  workerId: string;
  reconciliationDelaysMs?: readonly number[];
  delay?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  chartImages?: MarketChartRenderer;
  chartsEnabled?: boolean;
  publicationLog?: PublicationLogSink;
  monotonicNow?: () => number;
}

export interface PublicationErrorDecision {
  code: MarketResearchSafeError;
  retryable: boolean;
  retryAfterMs?: number;
}

type ReplyReconciliation = { state: "none" } | { state: "found"; messageId: string } | { state: "duplicate"; earliestMessageId: string };

const TRADING_VIEW_SYMBOLS: Readonly<Record<string, string>> = {
  AAPL: "NASDAQ:AAPL", MSFT: "NASDAQ:MSFT", XOM: "NYSE:XOM", COP: "NYSE:COP",
  NVDA: "NASDAQ:NVDA", AMD: "NASDAQ:AMD", MU: "NASDAQ:MU", SPY: "AMEX:SPY",
  QQQ: "NASDAQ:QQQ", XLE: "AMEX:XLE", XLK: "AMEX:XLK", SMH: "NASDAQ:SMH",
  SOXX: "NASDAQ:SOXX", DIA: "AMEX:DIA", IWM: "AMEX:IWM", XLU: "AMEX:XLU",
  CVX: "NYSE:CVX", SLB: "NYSE:SLB", OXY: "NYSE:OXY", VST: "NYSE:VST",
  CEG: "NASDAQ:CEG", NRG: "NYSE:NRG", VRT: "NYSE:VRT", ETN: "NYSE:ETN",
  GEV: "NYSE:GEV", AVGO: "NASDAQ:AVGO", ARM: "NASDAQ:ARM", TSM: "NYSE:TSM",
  ASML: "NASDAQ:ASML", SNDK: "NASDAQ:SNDK", QCOM: "NASDAQ:QCOM",
  INTC: "NASDAQ:INTC", MRVL: "NASDAQ:MRVL", AMZN: "NASDAQ:AMZN",
  GOOGL: "NASDAQ:GOOGL", META: "NASDAQ:META", TSLA: "NASDAQ:TSLA", ORCL: "NYSE:ORCL",
};

export function chartSpecForMarketResearch(
  request: MarketResearchChartRequest,
): ProviderMarketChartSpec | null {
  const tradingViewSymbol = TRADING_VIEW_SYMBOLS[request.symbol];
  if (!tradingViewSymbol) return null;
  const interval = request.timeframe === "60m"
    ? "1h" as const
    : request.timeframe === "daily"
      ? "1D" as const
      : request.timeframe === "weekly"
        ? "1W" as const
        : request.timeframe;
  return {
    symbol: request.symbol,
    title: `${request.symbol} ${request.timeframe} chart`,
    tradingViewSymbol,
    interval,
    style: "candle",
    includeVolume: true,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function editionMarker(editionId: string): string {
  return `Edition ID: MR-${editionId}`;
}

function partMarker(claim: ClaimedPublication): string {
  return claim.delivery.sequence === 0 ? editionMarker(claim.editionId) : `Part ${claim.delivery.sequence}/`;
}

function errorFields(error: unknown): { status?: number; code?: string | number } {
  if (typeof error !== "object" || error === null) return {};
  const value = error as Record<string, unknown>;
  return {
    ...(typeof value.status === "number" ? { status: value.status } : {}),
    ...(typeof value.code === "string" || typeof value.code === "number" ? { code: value.code } : {}),
  };
}

function discordRetryAfterMs(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const value = error as Record<string, unknown>;
  const raw = typeof value.rawError === "object" && value.rawError !== null
    ? value.rawError as Record<string, unknown>
    : undefined;
  const seconds = typeof value.retry_after === "number"
    ? value.retry_after
    : typeof raw?.retry_after === "number"
      ? raw.retry_after
      : undefined;
  const milliseconds = typeof value.retryAfterMs === "number"
    ? value.retryAfterMs
    : typeof value.retryAfter === "number"
      ? value.retryAfter
      : seconds === undefined
        ? undefined
        : seconds * 1_000;
  if (milliseconds === undefined || !Number.isFinite(milliseconds)) return undefined;
  return Math.max(1_000, Math.min(15 * 60 * 1_000, Math.ceil(milliseconds)));
}

export function classifyPublicationError(
  error: unknown,
  operation: "starter" | "reply",
): PublicationErrorDecision {
  const fields = errorFields(error);
  if (fields.status === 429 || fields.code === 42_029) {
    const retryAfterMs = discordRetryAfterMs(error);
    return {
      code: "discord_rate_limited",
      retryable: true,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    };
  }
  if (fields.status === 403 || fields.code === 50_013) {
    return { code: "discord_permission_failed", retryable: false };
  }
  if (operation === "starter" && fields.status === 400) {
    return { code: "discord_thread_create_failed", retryable: false };
  }
  return operation === "starter"
    ? { code: "discord_thread_reconcile_ambiguous", retryable: false }
    : { code: "discord_reply_failed", retryable: true };
}

function matchesPublicationMessage(
  message: Pick<Message, "author" | "content">,
  claim: ClaimedPublication,
  botUserId: string,
): boolean {
  return message.author.id === botUserId
    && message.content.includes(partMarker(claim))
    && sha256(message.content) === claim.delivery.contentHash;
}

async function starterForThread(
  thread: AnyThreadChannel,
  claim: ClaimedPublication,
  botUserId: string,
): Promise<ReconciledStarter | null> {
  if (!thread.isThread() || thread.parentId !== claim.forumChannelId) return null;
  try {
    const starter = await thread.fetchStarterMessage({ force: true });
    return starter && matchesPublicationMessage(starter, claim, botUserId)
      ? { state: "found", threadId: thread.id, messageId: starter.id }
      : null;
  } catch {
    return null;
  }
}

async function recentThreads(forum: ForumChannel): Promise<AnyThreadChannel[]> {
  const [active, archived] = await Promise.all([
    forum.threads.fetchActive(false),
    forum.threads.fetchArchived({ type: "public", limit: MAX_RECENT_FORUM_THREADS }, false),
  ]);
  const unique = new Map<string, AnyThreadChannel>();
  for (const thread of [...active.threads.values(), ...archived.threads.values()]) {
    if (thread.parentId === forum.id) unique.set(thread.id, thread);
  }
  return [...unique.values()]
    .sort((left, right) => (left.createdTimestamp ?? 0) - (right.createdTimestamp ?? 0))
    .slice(-MAX_RECENT_FORUM_THREADS);
}

async function reconcileStarterOnce(
  forum: ForumChannel,
  claim: ClaimedPublication,
  botUserId: string,
): Promise<StarterReconciliation> {
  const matches: ReconciledStarter[] = [];
  for (const thread of await recentThreads(forum)) {
    const match = await starterForThread(thread, claim, botUserId);
    if (match) matches.push(match);
  }
  if (matches.length === 0) return { state: "none" };
  if (matches.length > 1) {
    const earliest = matches[0];
    return earliest === undefined ? { state: "none" } : { state: "duplicate", earliest };
  }
  return matches[0] ?? { state: "none" };
}

async function reconcileReply(
  thread: AnyThreadChannel,
  claim: ClaimedPublication,
  botUserId: string,
): Promise<ReplyReconciliation> {
  const messages = await thread.messages.fetch({ limit: MAX_RECENT_THREAD_MESSAGES });
  const matches = [...messages.values()]
    .filter((message) => matchesPublicationMessage(message, claim, botUserId))
    .sort((left, right) => left.createdTimestamp - right.createdTimestamp);
  if (matches.length === 0) return { state: "none" };
  if (matches.length > 1) return { state: "duplicate", earliestMessageId: matches[0]?.id ?? "" };
  return { state: "found", messageId: matches[0]?.id ?? "" };
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class ForumPublisher {
  private readonly delays: readonly number[];
  private readonly delay: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private readonly telemetry: PublicationTelemetry;
  private polling = false;

  constructor(private readonly options: ForumPublisherOptions) {
    this.delays = options.reconciliationDelaysMs ?? DEFAULT_RECONCILIATION_DELAYS_MS;
    this.delay = options.delay ?? sleep;
    this.random = options.random ?? Math.random;
    this.telemetry = new PublicationTelemetry(options.publicationLog, options.monotonicNow);
  }

  async poll(): Promise<boolean> {
    if (this.polling || !this.options.client.isReady()) return false;
    this.polling = true;
    try {
      const claim = await this.options.convex.claimPublication(this.options.workerId);
      if (!claim.claimed) return false;
      await this.publish(claim);
      return true;
    } finally {
      this.polling = false;
    }
  }

  async publish(claim: ClaimedPublication): Promise<void> {
    const botUserId = this.options.client.user?.id;
    if (!botUserId) return;
    this.telemetry.record(claim, "attempt", { outcome: "started" });
    if (!(await this.heartbeat(claim))) return;
    const fetched = await this.options.client.channels.fetch(claim.forumChannelId);
    if (fetched?.type !== ChannelType.GuildForum || fetched.guildId !== claim.guildId) {
      await this.fail(claim, { code: "forum_wrong_channel_type", retryable: false });
      return;
    }
    if (claim.delivery.kind === "starter") {
      await this.publishStarter(fetched, claim, botUserId);
    } else {
      await this.publishReply(claim, botUserId);
    }
  }

  private async publishStarter(
    forum: ForumChannel,
    claim: ClaimedPublication,
    botUserId: string,
  ): Promise<void> {
    if (!claim.delivery.content.includes(editionMarker(claim.editionId))) {
      await this.fail(claim, { code: "composition_schema_invalid", retryable: false });
      return;
    }
    const immediate = await this.safeStarterReconciliation(forum, claim, botUserId);
    if (await this.adoptOrStop(claim, immediate)) return;
    if (claim.delivery.attempts > 1 && claim.lastErrorCode !== "discord_rate_limited") {
      const reconciled = await this.reconcileStarterWithBackoff(forum, claim, botUserId);
      if (await this.adoptOrStop(claim, reconciled)) return;
      await this.fail(claim, { code: "discord_thread_reconcile_ambiguous", retryable: false });
      return;
    }

    let thread: AnyThreadChannel;
    try {
      const files = await this.renderCharts(claim, forum, botUserId);
      thread = await this.telemetry.measure(claim, "send",
        () => forum.threads.create({
          name: claim.forumTitle,
          message: {
            content: claim.delivery.content,
            allowedMentions: { parse: [] },
            ...(files.length === 0 ? {} : { files }),
          },
          appliedTags: claim.forumTagIds,
        }),
        () => ({ outcome: "sent", attachmentCount: files.length }),
        (error) => ({ outcome: "failed", ...classifyPublicationError(error, "starter") }),
      );
    } catch (error) {
      const decision = classifyPublicationError(error, "starter");
      if (decision.code !== "discord_thread_reconcile_ambiguous") {
        await this.fail(claim, decision);
        return;
      }
      const reconciled = await this.reconcileStarterWithBackoff(forum, claim, botUserId);
      if (await this.adoptOrStop(claim, reconciled)) return;
      await this.fail(claim, decision);
      return;
    }

    for (const delay of [0, ...this.delays]) {
      if (delay > 0) await this.delay(Math.round(delay * (0.75 + this.random() * 0.5)));
      if (!(await this.heartbeat(claim))) return;
      const starter = await this.telemetry.measure(claim, "verify_starter",
        () => starterForThread(thread, claim, botUserId),
        (result) => ({ outcome: result ? "verified" : "unverified" }),
      );
      if (starter) {
        await this.acknowledge(claim, {
          status: "sent",
          discordThreadId: starter.threadId,
          discordMessageId: starter.messageId,
        });
        return;
      }
    }
    const reconciled = await this.reconcileStarterWithBackoff(forum, claim, botUserId);
    if (await this.adoptOrStop(claim, reconciled)) return;
    await this.fail(claim, { code: "discord_thread_reconcile_ambiguous", retryable: false });
  }

  private async publishReply(claim: ClaimedPublication, botUserId: string): Promise<void> {
    if (!claim.threadId || !claim.starterMessageId) {
      await this.fail(claim, { code: "discord_thread_reconcile_failed", retryable: false });
      return;
    }
    const fetched = await this.options.client.channels.fetch(claim.threadId);
    if (!fetched?.isThread() || fetched.guildId !== claim.guildId || fetched.parentId !== claim.forumChannelId) {
      await this.fail(claim, { code: "discord_thread_reconcile_failed", retryable: false });
      return;
    }
    const existing = await this.reconcileReply(fetched, claim, botUserId);
    if (existing.state === "duplicate") {
      await this.stopForDuplicateReply(claim, fetched.id, existing.earliestMessageId);
      return;
    }
    if (existing.state === "found") {
      await this.acknowledge(claim, {
        status: "sent",
        discordThreadId: fetched.id,
        discordMessageId: existing.messageId,
      });
      return;
    }
    try {
      const files = await this.renderCharts(claim, fetched, botUserId);
      const message = await this.telemetry.measure(claim, "send",
        () => fetched.send({
          content: claim.delivery.content,
          allowedMentions: { parse: [] },
          nonce: claim.delivery.nonce,
          enforceNonce: true,
          ...(files.length === 0 ? {} : { files }),
        }),
        () => ({ outcome: "sent", attachmentCount: files.length }),
        (error) => ({ outcome: "failed", ...classifyPublicationError(error, "reply") }),
      );
      await this.acknowledge(claim, {
        status: "sent",
        discordThreadId: fetched.id,
        discordMessageId: message.id,
      });
    } catch (error) {
      try {
        const reconciled = await this.reconcileReply(fetched, claim, botUserId);
        if (reconciled.state === "duplicate") {
          await this.stopForDuplicateReply(claim, fetched.id, reconciled.earliestMessageId);
          return;
        }
        if (reconciled.state === "found") {
          await this.acknowledge(claim, {
            status: "sent",
            discordThreadId: fetched.id,
            discordMessageId: reconciled.messageId,
          });
          return;
        }
      } catch {
        // The fenced failure below retains the first missing sequence for retry.
      }
      await this.fail(claim, classifyPublicationError(error, "reply"));
    }
  }

  private async safeStarterReconciliation(
    forum: ForumChannel,
    claim: ClaimedPublication,
    botUserId: string,
  ): Promise<StarterReconciliation> {
    try {
      return await this.telemetry.measure(claim, "reconcile",
        () => reconcileStarterOnce(forum, claim, botUserId),
        (result) => ({ outcome: result.state }),
        () => ({ outcome: "failed", code: "discord_thread_reconcile_failed" }),
      );
    } catch {
      return { state: "none" };
    }
  }

  private async reconcileStarterWithBackoff(
    forum: ForumChannel,
    claim: ClaimedPublication,
    botUserId: string,
  ): Promise<StarterReconciliation> {
    for (const delay of this.delays) {
      await this.delay(Math.round(delay * (0.75 + this.random() * 0.5)));
      if (!(await this.heartbeat(claim))) return { state: "none" };
      const result = await this.safeStarterReconciliation(forum, claim, botUserId);
      if (result.state !== "none") return result;
    }
    return { state: "none" };
  }

  private async adoptOrStop(
    claim: ClaimedPublication,
    reconciliation: StarterReconciliation,
  ): Promise<boolean> {
    if (reconciliation.state === "none") return false;
    if (reconciliation.state === "duplicate") {
      await this.adopt(
        claim,
        reconciliation.earliest.threadId,
        reconciliation.earliest.messageId,
        true,
      );
      return true;
    }
    await this.adopt(
      claim,
      reconciliation.threadId,
      reconciliation.messageId,
    );
    return true;
  }

  private async fail(claim: ClaimedPublication, decision: PublicationErrorDecision): Promise<void> {
    await this.acknowledge(claim, {
      status: "failed",
      code: decision.code,
      retryable: decision.retryable,
      ...(decision.retryAfterMs === undefined ? {} : { retryAfterMs: decision.retryAfterMs }),
    });
  }

  private async stopForDuplicateReply(
    claim: ClaimedPublication,
    threadId: string,
    earliestMessageId: string,
  ): Promise<void> {
    await this.acknowledge(claim, {
      status: "failed",
      discordThreadId: threadId,
      discordMessageId: earliestMessageId,
      code: "discord_thread_reconcile_ambiguous",
      retryable: false,
    });
  }

  private async renderCharts(
    claim: ClaimedPublication,
    channel: ForumChannel | AnyThreadChannel,
    botUserId: string,
  ): Promise<RenderedMarketChart[]> {
    const requestedCharts = Math.max(claim.delivery.chartRequests.length, claim.delivery.chartAttachmentIds.length);
    const renderer = this.options.chartImages;
    const unavailable = (
      !this.options.chartsEnabled
      || renderer === undefined
      || claim.delivery.chartRequests.length === 0
      || channel.permissionsFor(botUserId)?.has(PermissionFlagsBits.AttachFiles) !== true
    );
    return this.telemetry.measure(claim, "charts", async () => {
      const files: RenderedMarketChart[] = [];
      if (unavailable) return files;
      for (const request of claim.delivery.chartRequests) {
        const spec = chartSpecForMarketResearch(request);
        if (spec === null) continue;
        try {
          files.push(await renderer.render(spec));
        } catch {
          // Optional image failures are counted below; text publication continues.
        }
      }
      return files;
    }, (files) => ({
      outcome: unavailable ? "skipped" : files.length === requestedCharts ? "complete" : files.length > 0 ? "partial" : "failed",
      requestedCharts,
      renderedCharts: files.length,
      unavailableCharts: requestedCharts - files.length,
      code: files.length < requestedCharts ? "chart_unavailable" : undefined,
    }));
  }

  private heartbeat(claim: ClaimedPublication): Promise<boolean> {
    return this.telemetry.measure(claim, "heartbeat",
      () => this.options.convex.heartbeatPublication(claim),
      (accepted) => ({ outcome: accepted ? "accepted" : "fence_rejected" }),
    );
  }

  private acknowledge(claim: ClaimedPublication, result: PublicationAcknowledgement): Promise<boolean> {
    return this.telemetry.measure(claim, "acknowledge",
      () => this.options.convex.acknowledgePublication(claim, result),
      (accepted) => ({
        outcome: accepted ? "accepted" : "fence_rejected",
        acknowledgement: result.status,
        code: result.code,
        retryable: result.retryable,
        retryAfterMs: result.retryAfterMs,
      }),
      () => ({ outcome: "failed", acknowledgement: result.status, code: result.code, retryable: result.retryable }),
    );
  }

  private adopt(claim: ClaimedPublication, threadId: string, messageId: string, duplicateIncident?: boolean): Promise<boolean> {
    return this.telemetry.measure(claim, "adopt",
      () => this.options.convex.adoptReconciledStarter(claim, threadId, messageId, undefined, duplicateIncident),
      (accepted) => ({ outcome: accepted ? "accepted" : "fence_rejected", duplicateIncident: duplicateIncident ?? false }),
      () => ({ outcome: "failed", duplicateIncident: duplicateIncident ?? false }),
    );
  }

  private reconcileReply(thread: AnyThreadChannel, claim: ClaimedPublication, botUserId: string): Promise<ReplyReconciliation> {
    return this.telemetry.measure(claim, "reconcile",
      () => reconcileReply(thread, claim, botUserId),
      (result) => ({ outcome: result.state }),
      () => ({ outcome: "failed", code: "discord_thread_reconcile_failed" }),
    );
  }
}

export {
  editionMarker,
  matchesPublicationMessage,
  reconcileReply,
  reconcileStarterOnce,
};
