import { describe, expect, it, vi } from "vitest";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { z } from "zod";
import type {
  ActorCredentialStore,
  StoredRobinhoodConnection,
} from "../src/broker/actor-store.js";
import {
  OAUTH_TRANSACTION_TTL_MS,
  ROBINHOOD_MCP_URL,
  RobinhoodMcpClient,
  type RobinhoodMcpClientOptions,
} from "../src/broker/mcp-client.js";
import type { CanonicalJsonValue } from "../src/results/canonical-json.js";

const actorId = "workos_actor_a";
const redirectUri = "https://convex.example.com/http/broker/robinhood/callback";
const codeVerifier = "v".repeat(43);
const protectedResourceMetadataUrl = "https://agent.robinhood.com/.well-known/oauth-protected-resource/mcp/trading";
const authorizationServerMetadataUrl = "https://agent.robinhood.com/.well-known/oauth-authorization-server/mcp/trading";
const registrationUrl = "https://agent.robinhood.com/oauth/trading/register";
const tokenUrl = "https://api.robinhood.com/oauth2/token/";
const registrationSchema = z.object({
  application_type: z.literal("web"),
  client_name: z.literal("Phone Trading POC"),
  grant_types: z.tuple([z.literal("authorization_code"), z.literal("refresh_token")]),
  redirect_uris: z.tuple([z.literal(redirectUri)]),
  response_types: z.tuple([z.literal("code")]),
  scope: z.literal("internal"),
  token_endpoint_auth_method: z.literal("none"),
}).strict();

class MemoryActorStore implements ActorCredentialStore {
  value: StoredRobinhoodConnection | undefined;

  async read(requestedActorId: string): Promise<StoredRobinhoodConnection | undefined> {
    if (requestedActorId !== actorId) throw new Error("Actor does not match this Pi runtime.");
    return this.value ? structuredClone(this.value) : undefined;
  }

  async write(value: StoredRobinhoodConnection): Promise<void> {
    if (value.actorId !== actorId) throw new Error("Actor does not match this Pi runtime.");
    this.value = structuredClone(value);
  }

  async delete(requestedActorId: string): Promise<void> {
    if (requestedActorId !== actorId) throw new Error("Actor does not match this Pi runtime.");
    this.value = undefined;
  }

  async update(
    requestedActorId: string,
    update: (current: StoredRobinhoodConnection | undefined) => StoredRobinhoodConnection,
  ): Promise<StoredRobinhoodConnection> {
    if (requestedActorId !== actorId) throw new Error("Actor does not match this Pi runtime.");
    const next = update(this.value ? structuredClone(this.value) : undefined);
    this.value = structuredClone(next);
    return structuredClone(next);
  }
}

async function beginAuthorization(provider: OAuthClientProvider): Promise<void> {
  if (!provider.state) throw new Error("OAuth provider state callback is unavailable.");
  if (!provider.saveClientInformation) throw new Error("OAuth provider client registration is unavailable.");
  const state = await provider.state();
  await provider.saveClientInformation({
    client_id: "test-robinhood-client",
    redirect_uris: [redirectUri],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: "internal",
  });
  await provider.saveCodeVerifier(codeVerifier);
  const authorizationUrl = new URL("https://robinhood.com/oauth");
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", "test-robinhood-client");
  authorizationUrl.searchParams.set("code_challenge", "c".repeat(43));
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("scope", "internal");
  authorizationUrl.searchParams.set("resource", ROBINHOOD_MCP_URL);
  await provider.redirectToAuthorization(authorizationUrl);
}

async function finishAuthorization(provider: OAuthClientProvider): Promise<void> {
  expect(await provider.codeVerifier()).toBe(codeVerifier);
  await provider.saveTokens({
    access_token: "access-token",
    refresh_token: "refresh-token",
    token_type: "Bearer",
    scope: "internal",
    expires_in: 3_600,
  });
}

function createClient(
  store: MemoryActorStore,
  options: {
    now?: () => number;
    authorize?: (provider: OAuthClientProvider, authorizationCode: string | undefined) => Promise<void>;
  } = {},
): RobinhoodMcpClient {
  const clientOptions: RobinhoodMcpClientOptions = {
    store,
    serverUrl: ROBINHOOD_MCP_URL,
    redirectUri,
    authorize: async (provider, authorizationOptions) => {
      await (options.authorize
        ? options.authorize(
          provider,
          "authorizationCode" in authorizationOptions
            ? authorizationOptions.authorizationCode
            : undefined,
        )
        : "authorizationCode" in authorizationOptions
          ? finishAuthorization(provider)
          : beginAuthorization(provider));
    },
    verifyConnection: async () => undefined,
  };
  if (options.now) clientOptions.now = options.now;
  return new RobinhoodMcpClient(clientOptions);
}

function pendingState(store: MemoryActorStore): string {
  const state = store.value?.oauthTransaction?.state;
  if (!state) throw new Error("Test OAuth state is unavailable.");
  return state;
}

function jsonResponse(value: CanonicalJsonValue): Response {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

function createRobinhoodFetchMock() {
  const registrations: Array<z.infer<typeof registrationSchema>> = [];
  const tokenRequests: URLSearchParams[] = [];
  const fetchFn = vi.fn(async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    if (url.href === protectedResourceMetadataUrl) {
      return jsonResponse({
        authorization_servers: [ROBINHOOD_MCP_URL],
        bearer_methods_supported: ["header"],
        resource: ROBINHOOD_MCP_URL,
        scopes_supported: ["internal"],
      });
    }
    if (url.href === authorizationServerMetadataUrl) {
      return jsonResponse({
        authorization_endpoint: "https://robinhood.com/oauth",
        code_challenge_methods_supported: ["S256"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        issuer: ROBINHOOD_MCP_URL,
        registration_endpoint: registrationUrl,
        response_types_supported: ["code"],
        scopes_supported: ["internal"],
        token_endpoint: tokenUrl,
        token_endpoint_auth_methods_supported: ["none"],
      });
    }
    if (url.href === registrationUrl && init?.method === "POST") {
      const registration = registrationSchema.parse(JSON.parse(String(init.body)));
      registrations.push(registration);
      return jsonResponse({ ...registration, client_id: "test-robinhood-client" });
    }
    if (url.href === tokenUrl && init?.method === "POST") {
      tokenRequests.push(new URLSearchParams(String(init.body)));
      return jsonResponse({
        access_token: "test-access-token",
        backup_code: "provider-extension",
        expires_in: 3_600,
        mfa_code: "provider-extension",
        refresh_token: "test-refresh-token",
        scope: "internal",
        token_type: "Bearer",
        user_uuid: "provider-extension",
      });
    }
    throw new Error(`Unexpected OAuth fetch: ${init?.method ?? "GET"} ${url.origin}${url.pathname}`);
  });
  return { fetchFn, registrations, tokenRequests };
}

describe("Robinhood OAuth transaction", () => {
  it("uses Robinhood metadata, DCR, PKCE, and resource binding through the real SDK", async () => {
    const store = new MemoryActorStore();
    const oauth = createRobinhoodFetchMock();
    const client = new RobinhoodMcpClient({
      store,
      serverUrl: ROBINHOOD_MCP_URL,
      redirectUri,
      fetchFn: oauth.fetchFn,
      verifyConnection: async () => undefined,
    });

    const pending = await client.start(actorId);

    expect(oauth.registrations).toHaveLength(1);
    expect(oauth.registrations[0]).toMatchObject({
      application_type: "web",
      client_name: "Phone Trading POC",
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: [redirectUri],
      response_types: ["code"],
      scope: "internal",
      token_endpoint_auth_method: "none",
    });
    expect(pending.status).toBe("authorization_required");
    expect(pending.authorizationUrl).toBeDefined();
    const authorizationUrl = new URL(pending.authorizationUrl!);
    expect(authorizationUrl.origin).toBe("https://robinhood.com");
    expect(authorizationUrl.pathname).toBe("/oauth");
    expect(authorizationUrl.searchParams.get("response_type")).toBe("code");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(redirectUri);
    expect(authorizationUrl.searchParams.get("scope")).toBe("internal");
    expect(authorizationUrl.searchParams.get("resource")).toBe(ROBINHOOD_MCP_URL);
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizationUrl.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorizationUrl.searchParams.get("state")).toBe(pendingState(store));
    expect(authorizationUrl.searchParams.get("client_id")).toBe("test-robinhood-client");

    const metadataHash = store.value?.clientRegistration?.metadataHash;
    expect(store.value?.clientRegistration).toMatchObject({
      issuer: ROBINHOOD_MCP_URL,
      resource: ROBINHOOD_MCP_URL,
      redirectUri,
      scope: "internal",
    });
    expect(metadataHash).toMatch(/^[a-f0-9]{64}$/);

    await client.start(actorId);
    expect(oauth.registrations).toHaveLength(1);
    if (!store.value?.clientRegistration) throw new Error("Test registration binding is unavailable.");
    store.value.clientRegistration.metadataHash = "0".repeat(64);

    await client.start(actorId);
    expect(oauth.registrations).toHaveLength(2);
    expect(store.value?.clientRegistration?.metadataHash).toBe(metadataHash);

    const state = pendingState(store);
    await expect(client.complete(actorId, "test-authorization-code", state)).resolves.toMatchObject({
      grantedScopes: ["internal"],
      status: "connected",
    });

    expect(oauth.tokenRequests).toHaveLength(1);
    const tokenRequest = oauth.tokenRequests[0]!;
    expect(tokenRequest.get("grant_type")).toBe("authorization_code");
    expect(tokenRequest.get("code")).toBe("test-authorization-code");
    expect(tokenRequest.get("code_verifier")).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
    expect(tokenRequest.get("redirect_uri")).toBe(redirectUri);
    expect(tokenRequest.get("resource")).toBe(ROBINHOOD_MCP_URL);
    expect(tokenRequest.get("client_id")).toBe("test-robinhood-client");
    expect(store.value?.tokens).toEqual({
      access_token: "test-access-token",
      expires_in: 3_600,
      refresh_token: "test-refresh-token",
      scope: "internal",
      token_type: "Bearer",
    });
  });

  it("stores bounded expected metadata and a twenty-minute expiry", async () => {
    const store = new MemoryActorStore();
    const now = 1_800_000_000_000;
    const client = createClient(store, { now: () => now });

    const status = await client.start(actorId);

    expect(status).toMatchObject({ status: "authorization_required" });
    expect(store.value?.oauthTransaction).toMatchObject({
      expectedIssuer: ROBINHOOD_MCP_URL,
      expectedResource: ROBINHOOD_MCP_URL,
      expectedRedirectUri: redirectUri,
      createdAt: now,
      expiresAt: now + OAUTH_TRANSACTION_TTL_MS,
      codeVerifier,
    });
  });

  it("consumes state once and clears transient data after success", async () => {
    const store = new MemoryActorStore();
    const client = createClient(store);
    await client.start(actorId);
    const state = pendingState(store);

    await expect(client.complete(actorId, "authorization-code", state)).resolves.toMatchObject({
      status: "connected",
      grantedScopes: ["internal"],
    });
    expect(store.value?.oauthTransaction).toBeUndefined();
    expect(store.value?.tokens?.access_token).toBe("access-token");
    await expect(client.complete(actorId, "authorization-code", state)).rejects.toThrow(/transaction/);
  });

  it("rejects a mismatched state without destroying the pending transaction", async () => {
    const store = new MemoryActorStore();
    const client = createClient(store);
    await client.start(actorId);
    const transaction = structuredClone(store.value?.oauthTransaction);

    await expect(client.complete(actorId, "authorization-code", "x".repeat(32))).rejects.toThrow(/state mismatch/);
    expect(store.value?.oauthTransaction).toEqual(transaction);
  });

  it("rejects and clears an expired transaction before token exchange", async () => {
    const store = new MemoryActorStore();
    let now = 1_800_000_000_000;
    const exchange = vi.fn(async (provider: OAuthClientProvider, code: string | undefined) => {
      if (code) await finishAuthorization(provider);
      else await beginAuthorization(provider);
    });
    const client = createClient(store, { now: () => now, authorize: exchange });
    await client.start(actorId);
    const state = pendingState(store);
    now += OAUTH_TRANSACTION_TTL_MS;

    await expect(client.complete(actorId, "authorization-code", state)).rejects.toThrow(/expired/);
    expect(store.value?.oauthTransaction).toBeUndefined();
    expect(exchange).toHaveBeenCalledTimes(1);
  });

  it("allows only one of two concurrent callback attempts", async () => {
    const store = new MemoryActorStore();
    const client = createClient(store);
    await client.start(actorId);
    const state = pendingState(store);

    const results = await Promise.allSettled([
      client.complete(actorId, "authorization-code", state),
      client.complete(actorId, "authorization-code", state),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("clears the claimed transaction after token-exchange failure", async () => {
    const store = new MemoryActorStore();
    const client = createClient(store, {
      authorize: async (provider, code) => {
        if (!code) await beginAuthorization(provider);
        else throw new Error("token exchange failed");
      },
    });
    await client.start(actorId);
    const state = pendingState(store);

    await expect(client.complete(actorId, "authorization-code", state)).rejects.toThrow(/exchange/);
    expect(store.value?.oauthTransaction).toBeUndefined();
    expect(store.value?.tokens).toBeUndefined();
  });

  it("clears partial transaction data after authorization-start failure", async () => {
    const store = new MemoryActorStore();
    const client = createClient(store, {
      authorize: async (provider) => {
        await provider.saveCodeVerifier(codeVerifier);
        throw new Error("authorization discovery failed");
      },
    });

    await expect(client.start(actorId)).rejects.toThrow(/discovery/);
    expect(store.value?.oauthTransaction).toBeUndefined();
  });

  it("clears a transaction whose expected redirect metadata changed", async () => {
    const store = new MemoryActorStore();
    const client = createClient(store);
    await client.start(actorId);
    const state = pendingState(store);
    if (!store.value?.oauthTransaction) throw new Error("Test transaction is unavailable.");
    store.value.oauthTransaction.expectedRedirectUri = "https://convex.example.com/http/broker/wrong";

    await expect(client.complete(actorId, "authorization-code", state)).rejects.toThrow(/metadata mismatch/);
    expect(store.value?.oauthTransaction).toBeUndefined();
  });
});
