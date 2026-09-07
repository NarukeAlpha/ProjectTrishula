import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { LunaConversationStore, type LunaConversationIdentity } from "../src/discord/conversations.js";

const identity: LunaConversationIdentity = {
  conversationId: "discord:123",
  epoch: 0,
  ownerBindingVersion: 1,
  revision: 1,
  personalityVersion: "trishula-discord-v1",
  systemPromptHash: "system",
  capabilityProfileHash: "capability",
};

function session() {
  const value: AgentSession = Object.create(null);
  value.dispose = vi.fn();
  return value;
}

describe("Luna durable hot-session cache", () => {
  it("reuses one Luna session across two completed turns after a canonical rebase", async () => {
    const store = new LunaConversationStore();
    const created = session();
    const create = vi.fn(async () => created);
    const rebase = vi.fn();

    const first = await store.acquire(identity, "turn_1", { create, rebase });
    store.completeTurn(identity, "turn_1");
    const second = await store.acquire(
      { ...identity, revision: 3 },
      "turn_2",
      { create, rebase },
    );

    expect(first).toEqual({ session: created, reused: false });
    expect(second).toEqual({ session: created, reused: true });
    expect(create).toHaveBeenCalledOnce();
    expect(rebase).toHaveBeenCalledOnce();
    expect(created.dispose).not.toHaveBeenCalled();
  });

  it("has durable parity when hot reuse is disabled", async () => {
    const store = new LunaConversationStore({ reuseEnabled: false });
    const firstSession = session();
    const secondSession = session();
    const create = vi.fn()
      .mockResolvedValueOnce(firstSession)
      .mockResolvedValueOnce(secondSession);
    const rebase = vi.fn();

    await store.acquire(identity, "turn_1", { create, rebase });
    store.completeTurn(identity, "turn_1");
    const second = await store.acquire(
      { ...identity, revision: 3 },
      "turn_2",
      { create, rebase },
    );

    expect(second).toEqual({ session: secondSession, reused: false });
    expect(create).toHaveBeenCalledTimes(2);
    expect(rebase).not.toHaveBeenCalled();
    expect(firstSession.dispose).toHaveBeenCalledOnce();
  });

  it("never reuses across an epoch or policy boundary", async () => {
    const store = new LunaConversationStore();
    const firstSession = session();
    const secondSession = session();
    const create = vi.fn()
      .mockResolvedValueOnce(firstSession)
      .mockResolvedValueOnce(secondSession);
    const rebase = vi.fn();

    await store.acquire(identity, "turn_1", { create, rebase });
    store.completeTurn(identity, "turn_1");
    await store.acquire(
      { ...identity, systemPromptHash: "changed" },
      "turn_2",
      { create, rebase },
    );

    expect(firstSession.dispose).toHaveBeenCalledOnce();
    expect(rebase).not.toHaveBeenCalled();
  });

  it("PERS-094 rebuilds when the active checkpoint identity changes", async () => {
    const store = new LunaConversationStore();
    const firstSession = session();
    const secondSession = session();
    const create = vi.fn()
      .mockResolvedValueOnce(firstSession)
      .mockResolvedValueOnce(secondSession);
    const rebase = vi.fn();

    await store.acquire(
      { ...identity, activeCheckpointId: "checkpoint_1" },
      "turn_1",
      { create, rebase },
    );
    store.completeTurn(
      { ...identity, activeCheckpointId: "checkpoint_1" },
      "turn_1",
    );
    const next = await store.acquire(
      { ...identity, revision: 2, activeCheckpointId: "checkpoint_2" },
      "turn_2",
      { create, rebase },
    );

    expect(next).toEqual({ session: secondSession, reused: false });
    expect(firstSession.dispose).toHaveBeenCalledOnce();
    expect(rebase).not.toHaveBeenCalled();
  });
});
