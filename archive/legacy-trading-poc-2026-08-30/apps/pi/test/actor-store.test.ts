import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ConvexActorStore, defaultConnection } from "../src/broker/actor-store.js";

const actorId = "workos_actor_a";
const encryptionKey = "a-test-encryption-key-with-at-least-32-chars";

const envelopeSchema = z.object({
  schemaVersion: z.literal(1),
  actorId: z.string(),
  provider: z.literal("robinhood"),
  keyVersion: z.number(),
  algorithm: z.literal("A256GCM"),
  iv: z.string(),
  ciphertext: z.string(),
  authTag: z.string(),
}).strict();

const getBodySchema = z.object({
  schemaVersion: z.literal(1),
  actorId: z.string(),
  provider: z.literal("robinhood"),
}).strict();

const putBodySchema = z.object({
  schemaVersion: z.literal(1),
  actorId: z.string(),
  provider: z.literal("robinhood"),
  expectedRevision: z.number(),
  credential: envelopeSchema,
}).strict();

const deleteBodySchema = z.object({
  schemaVersion: z.literal(1),
  actorId: z.string(),
  provider: z.literal("robinhood"),
  expectedRevision: z.number(),
}).strict();

type Envelope = z.infer<typeof envelopeSchema>;

type JsonResponseBody =
  | { schemaVersion: 1; credential: Envelope | null; revision: number; extra?: boolean }
  | { schemaVersion: 1; stored: true; revision: number }
  | { schemaVersion: 1; deleted: boolean; revision: number }
  | { error: string };

function response(body: JsonResponseBody, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestUrl(input: string | URL | Request): URL {
  if (input instanceof Request) return new URL(input.url);
  return new URL(input.toString());
}

class CredentialVaultFake {
  credential: Envelope | null = null;
  revision = 0;
  conflictEnvelope: Envelope | undefined;
  readonly putBodies: Array<z.infer<typeof putBodySchema>> = [];
  readonly authorizationHeaders: string[] = [];

  readonly fetch: typeof fetch = vi.fn(async (input, init) => {
    this.authorizationHeaders.push(new Headers(init?.headers).get("authorization") ?? "");
    const url = requestUrl(input);
    // SAFETY: Each request body is parsed by a strict route-specific schema below.
    const rawBody: unknown = JSON.parse(String(init?.body));
    if (url.pathname.endsWith("/get")) {
      getBodySchema.parse(rawBody);
      return response({ schemaVersion: 1, credential: this.credential, revision: this.revision });
    }
    if (url.pathname.endsWith("/put")) {
      const body = putBodySchema.parse(rawBody);
      this.putBodies.push(body);
      if (this.conflictEnvelope) {
        this.credential = this.conflictEnvelope;
        this.conflictEnvelope = undefined;
        this.revision += 1;
        return response({ error: "credential_vault_revision_conflict" }, 409);
      }
      if (body.expectedRevision !== this.revision) {
        return response({ error: "credential_vault_revision_conflict" }, 409);
      }
      this.credential = body.credential;
      this.revision += 1;
      return response({ schemaVersion: 1, stored: true, revision: this.revision });
    }
    if (url.pathname.endsWith("/delete")) {
      const body = deleteBodySchema.parse(rawBody);
      if (body.expectedRevision !== this.revision) {
        return response({ error: "credential_vault_revision_conflict" }, 409);
      }
      const deleted = this.credential !== null;
      this.credential = null;
      this.revision += 1;
      return response({ schemaVersion: 1, deleted, revision: this.revision });
    }
    return response({ error: "not_found" }, 404);
  });
}

function createStore(vault: CredentialVaultFake): ConvexActorStore {
  return new ConvexActorStore({
    actorId,
    siteUrl: "http://convex.internal/http",
    sharedSecret: "a-secure-service-secret-with-32-chars",
    encryptionKey,
    keyVersion: 1,
    requestTimeoutMs: 1_000,
    retryAttempts: 1,
    fetch: vault.fetch,
  });
}

describe("Convex actor credential store", () => {
  it("stores only an authenticated opaque envelope and decrypts it for the bound actor", async () => {
    const vault = new CredentialVaultFake();
    const store = createStore(vault);
    const value = {
      ...defaultConnection(actorId),
      tokens: {
        access_token: "token-sentinel-a",
        refresh_token: "refresh-sentinel-a",
        token_type: "Bearer",
      },
    };

    await store.write(value);

    const put = vault.putBodies.at(-1);
    expect(put).toBeDefined();
    expect(put?.credential.ciphertext).not.toContain("token-sentinel-a");
    expect(put?.credential.ciphertext).not.toContain(actorId);
    expect(put).toMatchObject({
      actorId,
      provider: "robinhood",
      expectedRevision: 0,
      credential: { actorId, provider: "robinhood", algorithm: "A256GCM", keyVersion: 1 },
    });
    expect(vault.authorizationHeaders).toEqual([
      "Bearer a-secure-service-secret-with-32-chars",
      "Bearer a-secure-service-secret-with-32-chars",
    ]);
    expect((await store.read(actorId))?.tokens?.access_token).toBe("token-sentinel-a");
    await expect(store.read("workos_actor_b")).rejects.toThrow(/runtime/);
  });

  it("fails closed when the authenticated envelope is modified", async () => {
    const vault = new CredentialVaultFake();
    const store = createStore(vault);
    await store.write(defaultConnection(actorId));
    const current = envelopeSchema.parse(vault.credential);
    vault.credential = {
      ...current,
      authTag: `${current.authTag.startsWith("A") ? "B" : "A"}${current.authTag.slice(1)}`,
    };
    await expect(store.read(actorId)).rejects.toThrow();
  });

  it("refetches once after a revision conflict and preserves the concurrent value", async () => {
    const vault = new CredentialVaultFake();
    const store = createStore(vault);
    await store.write({ ...defaultConnection(actorId), label: "initial" });
    await store.write({
      ...defaultConnection(actorId),
      tokens: { access_token: "concurrent-token", token_type: "Bearer" },
    });
    const concurrentEnvelope = envelopeSchema.parse(vault.credential);
    await store.write({ ...defaultConnection(actorId), label: "stale" });
    vault.conflictEnvelope = concurrentEnvelope;
    let updateCalls = 0;

    await store.update(actorId, (current) => {
      updateCalls += 1;
      return { ...(current ?? defaultConnection(actorId)), label: "updated" };
    });

    const stored = await store.read(actorId);
    expect(updateCalls).toBe(2);
    expect(stored?.label).toBe("updated");
    expect(stored?.tokens?.access_token).toBe("concurrent-token");
  });

  it("serializes concurrent updates for the bound actor", async () => {
    const vault = new CredentialVaultFake();
    const store = createStore(vault);
    await Promise.all([
      store.update(actorId, (current) => ({
        ...(current ?? defaultConnection(actorId)),
        label: "first",
      })),
      store.update(actorId, (current) => ({
        ...(current ?? defaultConnection(actorId)),
        grantedScopes: [...(current?.grantedScopes ?? []), "second"],
      })),
    ]);
    expect(await store.read(actorId)).toMatchObject({ label: "first", grantedScopes: ["second"] });
  });

  it("rejects malformed Convex responses", async () => {
    const store = new ConvexActorStore({
      actorId,
      siteUrl: "http://convex.internal/http",
      sharedSecret: "a-secure-service-secret-with-32-chars",
      encryptionKey,
      keyVersion: 1,
      requestTimeoutMs: 1_000,
      retryAttempts: 1,
      fetch: async () => response({ schemaVersion: 1, credential: null, revision: 0, extra: true }),
    });
    await expect(store.read(actorId)).rejects.toThrow(/invalid broker credential response/);
  });
});
