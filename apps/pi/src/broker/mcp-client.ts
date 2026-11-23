import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  auth,
  refreshAuthorization,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import type { CanonicalJsonValue } from "../results/canonical-json.js";
import {
  defaultConnection,
  type ActorCredentialStore,
  type StoredClientRegistrationBinding,
  type StoredOAuthTransaction,
  type StoredRobinhoodConnection,
} from "./actor-store.js";
import type {
  ApplicationToolArguments,
  McpDiscoveredTool,
  McpToolSchemaObject,
  RobinhoodRunSession,
  RobinhoodSessionOpenResult,
} from "./types.js";

export const ROBINHOOD_MCP_URL = "https://agent.robinhood.com/mcp/trading";
export const ROBINHOOD_MCP_ISSUER = "https://agent.robinhood.com/mcp/trading";
export const ROBINHOOD_OAUTH_TOKEN_URL = "https://api.robinhood.com/oauth2/token/";
export const ROBINHOOD_OAUTH_SCOPE = "internal";
export const OAUTH_TRANSACTION_TTL_MS = 20 * 60 * 1_000;
export const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1_000;
const DEFAULT_ROBINHOOD_FETCH_TIMEOUT_MS = 20_000;

const ROBINHOOD_AUTHORIZATION_URL = "https://robinhood.com/oauth";
const ALLOWED_ROBINHOOD_API_HOSTS: ReadonlySet<string> = new Set([
  "agent.robinhood.com",
  "api.robinhood.com",
]);
const CLIENT_REGISTRATION_PROFILE_VERSION = 1 as const;

export const APPLICATION_MCP_TOOLS = [
  "get_accounts",
  "get_portfolio",
  "get_equity_positions",
  "get_equity_quotes",
  "get_equity_orders",
] as const;

export type ApplicationMcpTool = (typeof APPLICATION_MCP_TOOLS)[number];

export interface RobinhoodConnectionStatus {
  status: "authorization_required" | "connected" | "reauth_required" | "disconnected";
  authorizationUrl?: string;
  label?: string;
  grantedScopes?: string[];
  errorCode?: string;
}

export class RobinhoodReauthRequiredError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RobinhoodReauthRequiredError";
  }
}

interface AuthStartOptions {
  serverUrl: URL;
  fetchFn?: FetchLike;
}

interface AuthCompleteOptions extends AuthStartOptions {
  authorizationCode: string;
}

type Authorize = (
  provider: OAuthClientProvider,
  options: AuthStartOptions | AuthCompleteOptions,
) => Promise<void>;

export interface RobinhoodMcpClientOptions {
  store: ActorCredentialStore;
  serverUrl: string;
  redirectUri: string;
  clientId?: string;
  fetchFn?: FetchLike;
  fetchTimeoutMs?: number;
  now?: () => number;
  authorize?: Authorize;
  verifyConnection?: (actorId: string) => Promise<void>;
  onReauthRequired?: (actorId: string, errorCode: string) => Promise<void>;
}

const MUTATING_TOOL_VERBS = [
  "place",
  "submit",
  "create",
  "cancel",
  "replace",
  "modify",
  "edit",
  "update",
  "delete",
  "remove",
  "buy",
  "sell",
  "trade",
  "execute",
  "transfer",
  "withdraw",
  "deposit",
  "close",
  "approve",
  "revoke",
  "set",
  "write",
  "post",
] as const;

const READ_ONLY_TOOL_PREFIXES = [
  "get_",
  "list_",
  "read_",
  "fetch_",
  "search_",
  "lookup_",
  "find_",
  "describe_",
  "check_",
  "view_",
  "query_",
  "show_",
] as const;

const READ_ONLY_TOOL_KEYWORDS = [
  "quote",
  "quotes",
  "portfolio",
  "account",
  "accounts",
  "position",
  "positions",
  "holdings",
  "orders",
  "history",
  "watchlist",
  "fundamentals",
  "market",
  "option",
  "options",
  "earnings",
  "news",
  "ratings",
  "balance",
  "balances",
  "buying_power",
  "dividend",
  "dividends",
  "split",
  "splits",
  "instrument",
  "instruments",
  "bar",
  "bars",
  "candle",
  "candles",
  "chain",
] as const;

export interface ToolReadOnlyCandidate {
  readonly name: string;
  readonly annotations?: {
    readonly readOnlyHint?: boolean | undefined;
    readonly destructiveHint?: boolean | undefined;
  } | undefined;
}

export function isReadOnlyRobinhoodTool(tool: ToolReadOnlyCandidate): boolean {
  const normalized = tool.name.trim().toLowerCase();
  if (!/^[a-z0-9_.:-]{1,128}$/.test(normalized)) return false;
  if (tool.annotations?.destructiveHint === true) return false;
  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.some((token) => MUTATING_TOOL_VERBS.some((verb) => verb === token))) {
    return false;
  }
  if (tool.annotations?.readOnlyHint === true) return true;
  if (READ_ONLY_TOOL_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return true;
  }
  return tokens.some((token) => READ_ONLY_TOOL_KEYWORDS.some((keyword) => keyword === token));
}

export function isLoopbackRedirectUri(redirectUri: string): boolean {
  try {
    const parsed = new URL(redirectUri);
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === "http:" && (host === "127.0.0.1" || host === "localhost" || host === "[::1]");
  } catch {
    return false;
  }
}

function safeActorId(actorId: string): void {
  if (!/^[A-Za-z0-9:_-]{1,256}$/.test(actorId)) throw new Error("Invalid actor ID.");
}

function stateMatches(expected: string, supplied: string): boolean {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(supplied, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function createGuardedRobinhoodFetch(
  baseFetch: FetchLike,
  timeoutMs: number,
): FetchLike {
  return async (input, init) => {
    const url = input instanceof URL ? input : new URL(input);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:"
      || !ALLOWED_ROBINHOOD_API_HOSTS.has(host)
      || url.username !== ""
      || url.password !== ""
      || (url.port !== "" && url.port !== "443")
    ) {
      throw new Error("Blocked outbound request outside the allowlisted Robinhood HTTPS hosts.");
    }
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal;
    return baseFetch(url, {
      ...init,
      redirect: "error",
      signal,
    });
  };
}

interface RobinhoodClientMetadata extends OAuthClientMetadata {
  application_type: "web" | "native";
  scope: typeof ROBINHOOD_OAUTH_SCOPE;
}

function clientMetadata(redirectUri: string): RobinhoodClientMetadata {
  return {
    redirect_uris: [redirectUri],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    client_name: "Project Trishula",
    application_type: isLoopbackRedirectUri(redirectUri) ? "native" : "web",
    scope: ROBINHOOD_OAUTH_SCOPE,
  };
}

function registrationBinding(redirectUri: string): StoredClientRegistrationBinding {
  const metadataHash = createHash("sha256")
    .update(JSON.stringify(clientMetadata(redirectUri)), "utf8")
    .digest("hex");
  return {
    profileVersion: CLIENT_REGISTRATION_PROFILE_VERSION,
    issuer: ROBINHOOD_MCP_ISSUER,
    resource: ROBINHOOD_MCP_URL,
    redirectUri,
    scope: ROBINHOOD_OAUTH_SCOPE,
    metadataHash,
  };
}

function registrationMatches(
  stored: StoredClientRegistrationBinding | undefined,
  expected: StoredClientRegistrationBinding,
): boolean {
  return stored?.profileVersion === expected.profileVersion
    && stored.issuer === expected.issuer
    && stored.resource === expected.resource
    && stored.redirectUri === expected.redirectUri
    && stored.scope === expected.scope
    && stored.metadataHash === expected.metadataHash;
}

function storedClientInformation(
  clientInformation: OAuthClientInformationMixed,
): OAuthClientInformationMixed {
  const result: OAuthClientInformationMixed = { client_id: clientInformation.client_id };
  if (clientInformation.client_secret !== undefined) result.client_secret = clientInformation.client_secret;
  if (clientInformation.client_id_issued_at !== undefined) {
    result.client_id_issued_at = clientInformation.client_id_issued_at;
  }
  if (clientInformation.client_secret_expires_at !== undefined) {
    result.client_secret_expires_at = clientInformation.client_secret_expires_at;
  }
  return result;
}

function requireDynamicRegistration(
  clientInformation: OAuthClientInformationMixed,
  redirectUri: string,
): void {
  if (!("redirect_uris" in clientInformation)) {
    throw new Error("Robinhood returned incomplete client registration metadata.");
  }
  if (
    clientInformation.redirect_uris.length !== 1
    || clientInformation.redirect_uris[0] !== redirectUri
    || (
      clientInformation.token_endpoint_auth_method !== undefined
      && clientInformation.token_endpoint_auth_method !== "none"
    )
    || (clientInformation.scope !== undefined && clientInformation.scope !== ROBINHOOD_OAUTH_SCOPE)
  ) {
    throw new Error("Robinhood returned mismatched client registration metadata.");
  }
}

function exactParameter(url: URL, name: string, expected: string): boolean {
  const values = url.searchParams.getAll(name);
  return values.length === 1 && values[0] === expected;
}

function requireAuthorizationUrl(
  authorizationUrl: URL,
  clientId: string,
  transaction: StoredOAuthTransaction,
): void {
  const challenge = authorizationUrl.searchParams.getAll("code_challenge");
  if (
    `${authorizationUrl.origin}${authorizationUrl.pathname}` !== ROBINHOOD_AUTHORIZATION_URL
    || authorizationUrl.username !== ""
    || authorizationUrl.password !== ""
    || authorizationUrl.port !== ""
    || authorizationUrl.hash !== ""
    || !exactParameter(authorizationUrl, "response_type", "code")
    || !exactParameter(authorizationUrl, "client_id", clientId)
    || !exactParameter(authorizationUrl, "code_challenge_method", "S256")
    || challenge.length !== 1
    || !/^[A-Za-z0-9_-]{43}$/.test(challenge[0] ?? "")
    || !exactParameter(authorizationUrl, "redirect_uri", transaction.expectedRedirectUri)
    || !exactParameter(authorizationUrl, "state", transaction.state)
    || !exactParameter(authorizationUrl, "scope", ROBINHOOD_OAUTH_SCOPE)
    || !exactParameter(authorizationUrl, "resource", transaction.expectedResource)
  ) {
    throw new Error("Robinhood returned an invalid authorization request.");
  }
}

function currentTransaction(
  current: StoredRobinhoodConnection,
): StoredOAuthTransaction {
  const transaction = current.oauthTransaction;
  if (!transaction) throw new Error("Robinhood OAuth transaction is unavailable.");
  return transaction;
}

function requiredConnection(
  current: StoredRobinhoodConnection | undefined,
): StoredRobinhoodConnection {
  if (!current) throw new Error("Robinhood connection is unavailable.");
  return current;
}

interface McpTextContent {
  readonly type: "text";
  readonly text: string;
}

interface McpToolResult {
  readonly isError?: boolean;
  readonly structuredContent?: CanonicalJsonValue;
  readonly content?: readonly McpTextContent[];
}

interface TransportOptions {
  authProvider: OAuthClientProvider;
  requestInit: RequestInit;
  fetch: FetchLike;
}

const jsonRecordSchema = z.record(z.string(), z.json());

interface MutableToolSchemaObject {
  [key: string]: CanonicalJsonValue;
}

function normalizedToolSchema(rawSchema: z.infer<typeof jsonRecordSchema> | undefined): McpToolSchemaObject {
  const fallback: McpToolSchemaObject = {
    type: "object",
    properties: {},
    additionalProperties: false,
  };
  if (!rawSchema) return fallback;
  const parsed = jsonRecordSchema.safeParse(rawSchema);
  if (!parsed.success) return fallback;
  const schema: MutableToolSchemaObject = { ...parsed.data };
  if (schema.type !== "object") {
    schema.type = "object";
  }
  if (!schema.properties || Array.isArray(schema.properties) || !(schema.properties instanceof Object)) {
    schema.properties = {};
  }
  return schema;
}

function normalizedToolData(result: McpToolResult): CanonicalJsonValue {
  if (result.isError === true) throw new Error("Robinhood MCP tool failed.");
  if (result.structuredContent !== undefined) return result.structuredContent;
  const content = result.content;
  if (!content) return {};
  const text = content.map((part) => part.text).join("\n");
  if (!text) return {};
  const bounded = text.slice(0, 64 * 1024);
  try {
    // SAFETY: MCP text content is parsed only as the bounded JSON result returned by the approved tool.
    return JSON.parse(bounded) as CanonicalJsonValue;
  } catch {
    return { text: bounded };
  }
}

function tokenExpiryFrom(tokens: OAuthTokens, obtainedAt: number): number | undefined {
  if (tokens.expires_in === undefined || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) {
    return undefined;
  }
  return obtainedAt + Math.round(tokens.expires_in * 1_000);
}

function isTokenRefreshFailure(error: Error): boolean {
  const name = error.name.toLowerCase();
  const message = error.message.toLowerCase();
  return (
    name.includes("invalidgrant")
    || name.includes("invalidclient")
    || name.includes("unauthorizedclient")
    || message.includes("invalid_grant")
    || message.includes("invalid_client")
    || message.includes("invalid_token")
    || message.includes("unauthorized")
    || message.includes("http 400")
    || message.includes("http 401")
  );
}

class ActorOAuthProvider implements OAuthClientProvider {
  constructor(
    private readonly actorId: string,
    private readonly store: ActorCredentialStore,
    private readonly redirectUri: string,
    private readonly configuredClientId: string | undefined,
    private readonly now: () => number,
    private readonly interactive: boolean,
  ) {}

  get redirectUrl(): string {
    return this.redirectUri;
  }

  get clientMetadata(): OAuthClientMetadata {
    return clientMetadata(this.redirectUri);
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const record = await this.store.read(this.actorId);
    if (this.configuredClientId) return { client_id: this.configuredClientId };
    if (
      record?.clientInformation
      && registrationMatches(record.clientRegistration, registrationBinding(this.redirectUri))
    ) {
      return record.clientInformation;
    }
    return undefined;
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
    requireDynamicRegistration(clientInformation, this.redirectUri);
    await this.store.update(this.actorId, (current) => ({
      ...(current ?? defaultConnection(this.actorId)),
      clientInformation: storedClientInformation(clientInformation),
      clientRegistration: registrationBinding(this.redirectUri),
      updatedAt: this.now(),
    }));
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await this.store.read(this.actorId))?.tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const obtainedAt = this.now();
    const expiresAt = tokenExpiryFrom(tokens, obtainedAt);
    await this.store.update(this.actorId, (current) => {
      const next: StoredRobinhoodConnection = {
        ...(current ?? defaultConnection(this.actorId)),
        tokens,
        tokenObtainedAt: obtainedAt,
        grantedScopes: tokens.scope?.split(" ").filter(Boolean) ?? current?.grantedScopes ?? [],
        updatedAt: obtainedAt,
      };
      if (expiresAt !== undefined) next.tokenExpiresAt = expiresAt;
      else next.tokenExpiresAt = undefined;
      return next;
    });
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (!this.interactive) {
      throw new RobinhoodReauthRequiredError(
        "token_reauth_required",
        "Robinhood session expired and requires interactive re-authentication.",
      );
    }
    await this.store.update(this.actorId, (current) => {
      const connection = requiredConnection(current);
      const transaction = currentTransaction(connection);
      const clientId = this.configuredClientId ?? connection.clientInformation?.client_id;
      if (!clientId) throw new Error("Robinhood OAuth client is unavailable.");
      requireAuthorizationUrl(authorizationUrl, clientId, transaction);
      return {
        ...connection,
        oauthTransaction: { ...transaction, authorizationUrl: authorizationUrl.toString() },
        updatedAt: this.now(),
      };
    });
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    if (!this.interactive) {
      throw new RobinhoodReauthRequiredError(
        "token_reauth_required",
        "Robinhood session expired and requires interactive re-authentication.",
      );
    }
    await this.store.update(this.actorId, (current) => {
      const connection = requiredConnection(current);
      const transaction = currentTransaction(connection);
      return {
        ...connection,
        oauthTransaction: { ...transaction, codeVerifier },
        updatedAt: this.now(),
      };
    });
  }

  async codeVerifier(): Promise<string> {
    const transaction = currentTransaction(requiredConnection(await this.store.read(this.actorId)));
    if (!transaction.codeVerifier) throw new Error("Robinhood OAuth code verifier is unavailable.");
    return transaction.codeVerifier;
  }

  async state(): Promise<string> {
    if (!this.interactive) {
      throw new RobinhoodReauthRequiredError(
        "token_reauth_required",
        "Robinhood session expired and requires interactive re-authentication.",
      );
    }
    return currentTransaction(requiredConnection(await this.store.read(this.actorId))).state;
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier"): Promise<void> {
    await this.store.update(this.actorId, (current) => {
      const next = current ?? defaultConnection(this.actorId);
      if (scope === "all" || scope === "client") {
        next.clientInformation = undefined;
        next.clientRegistration = undefined;
      }
      if (scope === "all" || scope === "tokens") {
        next.tokens = undefined;
        next.tokenObtainedAt = undefined;
        next.tokenExpiresAt = undefined;
      }
      if ((scope === "all" || scope === "verifier") && next.oauthTransaction) {
        const { authorizationUrl: _authorizationUrl, codeVerifier: _codeVerifier, ...transaction } = next.oauthTransaction;
        next.oauthTransaction = transaction;
      }
      next.updatedAt = this.now();
      return next;
    });
  }
}

export class RobinhoodMcpClient {
  private readonly serverUrl: URL;
  private readonly now: () => number;
  private readonly guardedFetch: FetchLike;
  private readonly authorize: Authorize;
  private readonly actorLocks = new Map<string, Promise<void>>();

  constructor(private readonly options: RobinhoodMcpClientOptions) {
    this.serverUrl = new URL(options.serverUrl);
    if (this.serverUrl.toString() !== ROBINHOOD_MCP_URL) {
      throw new Error("Robinhood MCP URL must be the fixed official HTTPS endpoint.");
    }
    this.now = options.now ?? Date.now;
    this.guardedFetch = createGuardedRobinhoodFetch(
      options.fetchFn ?? fetch,
      options.fetchTimeoutMs ?? DEFAULT_ROBINHOOD_FETCH_TIMEOUT_MS,
    );
    this.authorize = options.authorize ?? (async (provider, authorizationOptions) => {
      if ("authorizationCode" in authorizationOptions) {
        await auth(provider, authorizationOptions);
      } else {
        await auth(provider, authorizationOptions);
      }
    });
  }

  start(actorId: string): Promise<RobinhoodConnectionStatus> {
    return this.serialized(actorId, () => this.startUnlocked(actorId));
  }

  complete(actorId: string, code: string, state: string): Promise<RobinhoodConnectionStatus> {
    return this.serialized(actorId, () => this.completeUnlocked(actorId, code, state));
  }

  status(actorId: string): Promise<RobinhoodConnectionStatus> {
    return this.serialized(actorId, async () => {
      safeActorId(actorId);
      const record = await this.options.store.read(actorId);
      return record ? this.statusFrom(record) : { status: "disconnected" };
    });
  }

  disconnect(actorId: string): Promise<RobinhoodConnectionStatus> {
    return this.serialized(actorId, async () => {
      safeActorId(actorId);
      await this.options.store.delete(actorId);
      return { status: "disconnected" };
    });
  }

  async ensureFreshTokens(actorId: string): Promise<OAuthTokens> {
    return this.serialized(actorId, () => this.ensureFreshTokensUnlocked(actorId));
  }

  async openRunSession(actorId: string, signal?: AbortSignal): Promise<RobinhoodSessionOpenResult> {
    safeActorId(actorId);
    const existing = await this.options.store.read(actorId);
    if (!existing?.tokens) {
      return { status: "disconnected" };
    }
    try {
      await this.ensureFreshTokens(actorId);
    } catch (error) {
      if (error instanceof RobinhoodReauthRequiredError) {
        return { status: "reauth_required", reason: error.code };
      }
      throw error;
    }

    const provider = this.provider(actorId, false);
    const transportOptions: TransportOptions = {
      authProvider: provider,
      requestInit: { headers: { "User-Agent": "project-trishula/0.1" } },
      fetch: this.guardedFetch,
    };
    const transport = new StreamableHTTPClientTransport(this.serverUrl, transportOptions);
    const client = new Client(
      { name: "project-trishula", version: "0.1.0" },
      { capabilities: {} },
    );

    try {
      if (signal?.aborted) {
        throw new Error("Robinhood MCP run session setup was aborted.");
      }
      // SAFETY: StreamableHTTPClientTransport implements the MCP Transport interface; exactOptionalPropertyTypes requires narrowing here.
      await client.connect(transport as never);
      const listed = await client.listTools(undefined, signal ? { signal, timeout: 20_000 } : { timeout: 20_000 });
      const discoveredTools: McpDiscoveredTool[] = [];
      const allowedNames = new Set<string>();
      for (const tool of listed.tools) {
        const candidate: ToolReadOnlyCandidate = tool.annotations !== undefined
          ? { name: tool.name, annotations: tool.annotations }
          : { name: tool.name };
        if (!isReadOnlyRobinhoodTool(candidate)) continue;
        allowedNames.add(tool.name);
        const parsedSchema = jsonRecordSchema.safeParse(tool.inputSchema);
        discoveredTools.push({
          name: tool.name,
          description: tool.description?.trim() || `Read data using Robinhood MCP tool ${tool.name}.`,
          inputSchema: normalizedToolSchema(parsedSchema.success ? parsedSchema.data : undefined),
        });
      }

      let closed = false;
      const session: RobinhoodRunSession = {
        actorId,
        tools: discoveredTools,
        callTool: async (name, args, callSignal) => {
          if (closed) throw new Error("Robinhood MCP run session is closed.");
          if (!allowedNames.has(name)) {
            throw new Error(`Robinhood MCP tool ${name} is not in the read-only run allowlist.`);
          }
          try {
            const result = await client.callTool(
              { name, arguments: args },
              undefined,
              callSignal ? { signal: callSignal, timeout: 30_000 } : { timeout: 30_000 },
            );
            // SAFETY: The MCP SDK has validated the response envelope; this adapter accepts only structured JSON or text content.
            return normalizedToolData(result as McpToolResult);
          } catch (error) {
            if (error instanceof RobinhoodReauthRequiredError) {
              await this.handleReauthRequired(actorId, error.code);
            }
            throw error;
          }
        },
        close: async () => {
          if (closed) return;
          closed = true;
          await client.close().catch(() => undefined);
          await transport.close().catch(() => undefined);
        },
      };
      return { status: "connected", session };
    } catch (error) {
      await client.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
      if (error instanceof RobinhoodReauthRequiredError) {
        await this.handleReauthRequired(actorId, error.code);
        return { status: "reauth_required", reason: error.code };
      }
      throw error;
    }
  }

  callTool(
    actorId: string,
    name: ApplicationMcpTool,
    args: ApplicationToolArguments,
    signal?: AbortSignal,
  ): Promise<CanonicalJsonValue> {
    return this.serialized(actorId, async () => {
      safeActorId(actorId);
      if (!APPLICATION_MCP_TOOLS.includes(name)) {
        throw new Error("MCP tool is not in the application allowlist.");
      }
      await this.ensureFreshTokensUnlocked(actorId);
      return this.withClient(actorId, async (client) => {
        const listed = await client.listTools();
        if (!listed.tools.some((tool) => tool.name === name)) {
          throw new Error(`Robinhood MCP tool ${name} is unavailable.`);
        }
        const result = await client.callTool(
          { name, arguments: args },
          undefined,
          signal ? { signal, timeout: 30_000 } : { timeout: 30_000 },
        );
        // SAFETY: The MCP SDK has validated the response envelope; this adapter accepts only structured JSON or text content.
        return normalizedToolData(result as McpToolResult);
      });
    });
  }

  private async ensureFreshTokensUnlocked(actorId: string): Promise<OAuthTokens> {
    safeActorId(actorId);
    const record = await this.options.store.read(actorId);
    const tokens = record?.tokens;
    if (!tokens) {
      throw new RobinhoodReauthRequiredError(
        "not_connected",
        "Robinhood connection is not authorized.",
      );
    }
    const now = this.now();
    const expiresAt = record.tokenExpiresAt;
    if (expiresAt === undefined || expiresAt - TOKEN_REFRESH_SKEW_MS > now) {
      return tokens;
    }
    if (!tokens.refresh_token) {
      await this.handleReauthRequired(actorId, "token_expired");
      throw new RobinhoodReauthRequiredError(
        "token_expired",
        "Robinhood access token expired and no refresh token is stored.",
      );
    }
    const clientInformation = this.options.clientId
      ? { client_id: this.options.clientId }
      : record.clientInformation;
    if (!clientInformation) {
      await this.handleReauthRequired(actorId, "client_registration_missing");
      throw new RobinhoodReauthRequiredError(
        "client_registration_missing",
        "Robinhood OAuth client registration is missing.",
      );
    }
    try {
      const refreshed = await refreshAuthorization(this.serverUrl, {
        metadata: {
          issuer: ROBINHOOD_MCP_ISSUER,
          authorization_endpoint: ROBINHOOD_AUTHORIZATION_URL,
          token_endpoint: ROBINHOOD_OAUTH_TOKEN_URL,
          response_types_supported: ["code"],
          token_endpoint_auth_methods_supported: ["none"],
        },
        clientInformation,
        refreshToken: tokens.refresh_token,
        resource: this.serverUrl,
        fetchFn: this.guardedFetch,
      });
      const provider = this.provider(actorId, false);
      await provider.saveTokens(refreshed);
      return refreshed;
    } catch (error) {
      const failure = error instanceof Error ? error : new Error("Robinhood token refresh failed.");
      if (isTokenRefreshFailure(failure)) {
        await this.handleReauthRequired(actorId, "token_refresh_failed");
        throw new RobinhoodReauthRequiredError(
          "token_refresh_failed",
          "Robinhood session expired. Reconnect Robinhood in the app.",
        );
      }
      throw failure;
    }
  }

  private async handleReauthRequired(actorId: string, errorCode: string): Promise<void> {
    await this.clearTransaction(actorId, true).catch(() => undefined);
    if (this.options.onReauthRequired) {
      await this.options.onReauthRequired(actorId, errorCode).catch(() => undefined);
    }
  }

  private async startUnlocked(actorId: string): Promise<RobinhoodConnectionStatus> {
    safeActorId(actorId);
    const existing = await this.options.store.read(actorId);
    if (existing?.tokens) return this.statusFrom(existing);
    const createdAt = this.now();
    await this.options.store.update(actorId, (current) => ({
      ...(current ?? defaultConnection(actorId)),
      oauthTransaction: {
        state: randomBytes(24).toString("base64url"),
        expectedIssuer: ROBINHOOD_MCP_ISSUER,
        expectedResource: this.serverUrl.toString(),
        expectedRedirectUri: this.options.redirectUri,
        createdAt,
        expiresAt: createdAt + OAUTH_TRANSACTION_TTL_MS,
      },
      updatedAt: createdAt,
    }));
    const provider = this.provider(actorId, true);
    const authOptions: AuthStartOptions = {
      serverUrl: this.serverUrl,
      fetchFn: this.guardedFetch,
    };
    try {
      await this.authorize(provider, authOptions);
      const record = await this.options.store.read(actorId);
      if (record?.tokens) {
        const connected = await this.clearTransaction(actorId, false);
        return this.statusFrom(connected);
      }
      const authorizationUrl = record?.oauthTransaction?.authorizationUrl;
      if (!authorizationUrl) throw new Error("Robinhood OAuth did not return an authorization URL.");
      return { status: "authorization_required", authorizationUrl };
    } catch (error) {
      await this.clearTransaction(actorId, false).catch(() => undefined);
      throw error;
    }
  }

  private async completeUnlocked(
    actorId: string,
    code: string,
    state: string,
  ): Promise<RobinhoodConnectionStatus> {
    safeActorId(actorId);
    if (!code.trim() || !state.trim()) throw new Error("Robinhood OAuth code and state are required.");
    const now = this.now();
    let terminalTransactionError: Error | undefined;
    await this.options.store.update(actorId, (current) => {
      const connection = requiredConnection(current);
      const transaction = currentTransaction(connection);
      if (!stateMatches(transaction.state, state)) throw new Error("Robinhood OAuth state mismatch.");
      if (transaction.consumedAt !== undefined) {
        terminalTransactionError = new Error("Robinhood OAuth state was already consumed.");
        return { ...connection, oauthTransaction: undefined, updatedAt: now };
      }
      if (transaction.expiresAt <= now) {
        terminalTransactionError = new Error("Robinhood OAuth transaction expired.");
        return { ...connection, oauthTransaction: undefined, updatedAt: now };
      }
      if (
        transaction.expectedIssuer !== ROBINHOOD_MCP_ISSUER
        || transaction.expectedResource !== this.serverUrl.toString()
        || transaction.expectedRedirectUri !== this.options.redirectUri
      ) {
        terminalTransactionError = new Error("Robinhood OAuth transaction metadata mismatch.");
        return { ...connection, oauthTransaction: undefined, updatedAt: now };
      }
      return {
        ...connection,
        oauthTransaction: { ...transaction, consumedAt: now },
        updatedAt: now,
      };
    });
    if (terminalTransactionError) throw terminalTransactionError;

    const provider = this.provider(actorId, true);
    const authOptions: AuthCompleteOptions = {
      serverUrl: this.serverUrl,
      authorizationCode: code,
      fetchFn: this.guardedFetch,
    };
    try {
      await this.authorize(provider, authOptions);
      const connected = await this.options.store.update(actorId, (current) => {
        if (!current?.tokens) throw new Error("Robinhood OAuth did not return tokens.");
        return {
          ...current,
          oauthTransaction: undefined,
          label: current.label ?? "Robinhood",
          updatedAt: this.now(),
        };
      });
      try {
        if (this.options.verifyConnection) await this.options.verifyConnection(actorId);
        else await this.verifyTools(actorId);
      } catch (error) {
        await this.clearTransaction(actorId, true);
        throw error;
      }
      return this.statusFrom(connected);
    } catch (error) {
      await this.clearTransaction(actorId, true).catch(() => undefined);
      throw error;
    }
  }

  private provider(actorId: string, interactive: boolean): ActorOAuthProvider {
    return new ActorOAuthProvider(
      actorId,
      this.options.store,
      this.options.redirectUri,
      this.options.clientId,
      this.now,
      interactive,
    );
  }

  private clearTransaction(
    actorId: string,
    clearTokens: boolean,
  ): Promise<StoredRobinhoodConnection> {
    return this.options.store.update(actorId, (current) => {
      const next = current ?? defaultConnection(actorId);
      next.oauthTransaction = undefined;
      if (clearTokens) {
        next.tokens = undefined;
        next.tokenObtainedAt = undefined;
        next.tokenExpiresAt = undefined;
        next.grantedScopes = [];
      }
      next.updatedAt = this.now();
      return next;
    });
  }

  private serialized<T>(actorId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.actorLocks.get(actorId) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.actorLocks.set(actorId, tail);
    void tail.finally(() => {
      if (this.actorLocks.get(actorId) === tail) {
        this.actorLocks.delete(actorId);
      }
    });
    return result;
  }

  private async verifyTools(actorId: string): Promise<void> {
    await this.withClient(actorId, async (client) => {
      const listed = await client.listTools();
      if (listed.tools.length === 0) {
        throw new Error("Robinhood MCP did not expose any tools for this session.");
      }
    });
  }

  private async withClient<T>(
    actorId: string,
    operation: (client: Client) => Promise<T>,
  ): Promise<T> {
    const provider = this.provider(actorId, false);
    const transportOptions: TransportOptions = {
      authProvider: provider,
      requestInit: { headers: { "User-Agent": "project-trishula/0.1" } },
      fetch: this.guardedFetch,
    };
    const transport = new StreamableHTTPClientTransport(this.serverUrl, transportOptions);
    const client = new Client(
      { name: "project-trishula", version: "0.1.0" },
      { capabilities: {} },
    );
    try {
      // SAFETY: StreamableHTTPClientTransport implements the MCP Transport interface; exactOptionalPropertyTypes requires narrowing here.
      await client.connect(transport as never);
      return await operation(client);
    } catch (error) {
      if (error instanceof RobinhoodReauthRequiredError) {
        await this.handleReauthRequired(actorId, error.code);
      }
      throw error;
    } finally {
      await client.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
    }
  }

  private statusFrom(record: StoredRobinhoodConnection): RobinhoodConnectionStatus {
    if (!record.tokens) {
      const authorizationUrl = record.oauthTransaction?.authorizationUrl;
      return authorizationUrl
        ? { status: "authorization_required", authorizationUrl }
        : { status: "disconnected" };
    }
    const status: RobinhoodConnectionStatus = {
      status: "connected",
      grantedScopes: record.grantedScopes,
    };
    if (record.label) status.label = record.label;
    return status;
  }
}
