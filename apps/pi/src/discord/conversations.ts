import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { conversationCacheKey } from "../assistant/context.js";

export interface LunaConversationIdentity {
  conversationId: string;
  epoch: number;
  ownerBindingVersion: number;
  revision: number;
  personalityVersion: string;
  systemPromptHash: string;
  capabilityProfileHash: string;
  activeCheckpointId?: string;
}

interface LunaConversationEntry {
  session: AgentSession;
  identity: LunaConversationIdentity;
  activeTurnId?: string;
  lastUsedAt: number;
}

export interface LunaConversationStoreOptions {
  idleTtlMs?: number;
  reuseEnabled?: boolean;
  now?: () => number;
}

export interface LunaConversationAcquireOptions {
  create: () => Promise<AgentSession>;
  rebase: (session: AgentSession) => Promise<void> | void;
}

export class LunaConversationStore {
  private readonly entries = new Map<string, LunaConversationEntry>();
  private readonly idleTtlMs: number;
  private readonly reuseEnabled: boolean;
  private readonly now: () => number;

  constructor(options: LunaConversationStoreOptions = {}) {
    this.idleTtlMs = options.idleTtlMs ?? 60 * 60 * 1_000;
    this.reuseEnabled = options.reuseEnabled ?? true;
    this.now = options.now ?? Date.now;
  }

  async acquire(
    identity: LunaConversationIdentity,
    turnId: string,
    options: LunaConversationAcquireOptions,
  ): Promise<{ session: AgentSession; reused: boolean }> {
    this.evictExpired();
    const key = conversationCacheKey(
      identity.conversationId,
      identity.epoch,
      identity.ownerBindingVersion,
    );
    const existing = this.entries.get(key);
    if (existing !== undefined) {
      if (!this.reuseEnabled || !this.policyCompatible(existing.identity, identity)) {
        existing.session.dispose();
        this.entries.delete(key);
      } else if (existing.activeTurnId === turnId) {
        existing.lastUsedAt = this.now();
        return { session: existing.session, reused: true };
      } else if (existing.activeTurnId !== undefined) {
        existing.session.dispose();
        this.entries.delete(key);
      } else {
        try {
          await options.rebase(existing.session);
          existing.identity = { ...identity };
          existing.activeTurnId = turnId;
          existing.lastUsedAt = this.now();
          return { session: existing.session, reused: true };
        } catch {
          existing.session.dispose();
          this.entries.delete(key);
        }
      }
    }
    const session = await options.create();
    this.entries.set(key, {
      session,
      identity: { ...identity },
      activeTurnId: turnId,
      lastUsedAt: this.now(),
    });
    return { session, reused: false };
  }

  completeTurn(
    identity: LunaConversationIdentity,
    turnId: string,
    retainForRebase = true,
  ): void {
    const key = conversationCacheKey(
      identity.conversationId,
      identity.epoch,
      identity.ownerBindingVersion,
    );
    const entry = this.entries.get(key);
    if (entry === undefined || entry.activeTurnId !== turnId) return;
    if (!retainForRebase || !this.reuseEnabled) {
      entry.session.dispose();
      this.entries.delete(key);
      return;
    }
    delete entry.activeTurnId;
    entry.lastUsedAt = this.now();
  }

  invalidate(identity: Pick<LunaConversationIdentity, "conversationId" | "epoch" | "ownerBindingVersion">): void {
    const key = conversationCacheKey(
      identity.conversationId,
      identity.epoch,
      identity.ownerBindingVersion,
    );
    const entry = this.entries.get(key);
    if (entry === undefined) return;
    entry.session.dispose();
    this.entries.delete(key);
  }

  dispose(): void {
    for (const entry of this.entries.values()) entry.session.dispose();
    this.entries.clear();
  }

  private policyCompatible(
    current: LunaConversationIdentity,
    next: LunaConversationIdentity,
  ): boolean {
    return current.conversationId === next.conversationId
      && current.epoch === next.epoch
      && current.ownerBindingVersion === next.ownerBindingVersion
      && current.personalityVersion === next.personalityVersion
      && current.systemPromptHash === next.systemPromptHash
      && current.capabilityProfileHash === next.capabilityProfileHash
      && current.activeCheckpointId === next.activeCheckpointId;
  }

  private evictExpired(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.lastUsedAt + this.idleTtlMs > now) continue;
      entry.session.dispose();
      this.entries.delete(key);
    }
  }
}
