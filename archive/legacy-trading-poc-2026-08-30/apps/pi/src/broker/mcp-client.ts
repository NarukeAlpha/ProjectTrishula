import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CanonicalJsonValue } from "../results/canonical-json.js";
import {
  defaultConnection,
  type ActorCredentialStore,
  type StoredClientRegistrationBinding,
  type StoredOAuthTransaction,
  type StoredRobinhoodConnection,
} from "./actor-store.js";
import type { ApplicationToolArguments } from "./types.js";

export const ROBINHOOD_MCP_URL = "https://agent.robinhood.com/mcp/trading";
export const ROBINHOOD_MCP_ISSUER = "https://agent.robinhood.com/mcp/trading";
export const ROBINHOOD_OAUTH_SCOPE = "internal";
export const OAUTH_TRANSACTION_TTL_MS = 20 * 60 * 1_000;

const ROBINHOOD_AUTHORIZATION_URL = "https://robinhood.com/oauth";
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
  status: "authorization_required" | "connected" | "disconnected";
  authorizationUrl?: string;
  label?: string;
  grantedScopes?: string[];
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
  now?: () => number;
  authorize?: Authorize;
  verifyConnection?: (actorId: string) => Promise<void>;
}

function safeActorId(actorId: string): void {
  if (!/^[A-Za-z0-9:_-]{1,256}$/.test(actorId)) throw new Error("Invalid actor ID.");
}

function stateMatches(expected: string, supplied: string): boolean {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(supplied, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

interface RobinhoodClientMetadata extends OAuthClientMetadata {
  application_type: "web";
  scope: typeof ROBINHOOD_OAUTH_SCOPE;
}

function clientMetadata(redirectUri: string): RobinhoodClientMetadata {
  return {
    redirect_uris: [redirectUri],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    client_name: "Phone Trading POC",
    application_type: "web",
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
  authProvider: ActorOAuthProvider;
  requestInit: RequestInit;
  fetch?: FetchLike;
}

function normalizedToolData(result: McpToolResult): CanonicalJsonValue {
  if (result.isError === true) throw new Error("Robinhood MCP tool failed.");
  if (result.structuredContent !== undefined) return result.structuredContent;
  const content = result.content;
  if (!content) return {};
  const text = content.map((part) => part.text).join("\n");
  if (!text) return {};
  try {
    // SAFETY: MCP text content is parsed only as the bounded JSON result returned by the approved tool.
    return JSON.parse(text) as CanonicalJsonValue;
  } catch {
    return { text: text.slice(0, 64 * 1024) };
  }
}

class ActorOAuthProvider implements OAuthClientProvider {
  constructor(
    private readonly actorId: string,
    private readonly store: ActorCredentialStore,
    private readonly redirectUri: string,
    private readonly configuredClientId: string | undefined,
    private readonly now: () => number,
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
    await this.store.update(this.actorId, (current) => ({
      ...(current ?? defaultConnection(this.actorId)),
      tokens,
      grantedScopes: tokens.scope?.split(" ").filter(Boolean) ?? current?.grantedScopes ?? [],
      updatedAt: this.now(),
    }));
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
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
    return currentTransaction(requiredConnection(await this.store.read(this.actorId))).state;
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier"): Promise<void> {
    await this.store.update(this.actorId, (current) => {
      const next = current ?? defaultConnection(this.actorId);
      if (scope === "all" || scope === "client") {
        next.clientInformation = undefined;
        next.clientRegistration = undefined;
      }
      if (scope === "all" || scope === "tokens") next.tokens = undefined;
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
  private readonly authorize: Authorize;
  private operationTail: Promise<void> = Promise.resolve();

  constructor(private readonly options: RobinhoodMcpClientOptions) {
    this.serverUrl = new URL(options.serverUrl);
    if (this.serverUrl.toString() !== ROBINHOOD_MCP_URL) {
      throw new Error("Robinhood MCP URL must be the fixed official HTTPS endpoint.");
    }
    this.now = options.now ?? Date.now;
    this.authorize = options.authorize ?? (async (provider, authorizationOptions) => {
      if ("authorizationCode" in authorizationOptions) {
        await auth(provider, authorizationOptions);
      } else {
        await auth(provider, authorizationOptions);
      }
    });
  }

  start(actorId: string): Promise<RobinhoodConnectionStatus> {
    return this.serialized(() => this.startUnlocked(actorId));
  }

  complete(actorId: string, code: string, state: string): Promise<RobinhoodConnectionStatus> {
    return this.serialized(() => this.completeUnlocked(actorId, code, state));
  }

  status(actorId: string): Promise<RobinhoodConnectionStatus> {
    return this.serialized(async () => {
      safeActorId(actorId);
      const record = await this.options.store.read(actorId);
      return record ? this.statusFrom(record) : { status: "disconnected" };
    });
  }

  disconnect(actorId: string): Promise<RobinhoodConnectionStatus> {
    return this.serialized(async () => {
      safeActorId(actorId);
      await this.options.store.delete(actorId);
      return { status: "disconnected" };
    });
  }

  callTool(
    actorId: string,
    name: ApplicationMcpTool,
    args: ApplicationToolArguments,
    signal?: AbortSignal,
  ): Promise<CanonicalJsonValue> {
    return this.serialized(async () => {
      safeActorId(actorId);
      if (!APPLICATION_MCP_TOOLS.includes(name)) {
        throw new Error("MCP tool is not in the application allowlist.");
      }
      const record = await this.options.store.read(actorId);
      if (!record?.tokens) throw new Error("Robinhood connection is not authorized.");
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
    const provider = this.provider(actorId);
    const authOptions: AuthStartOptions = { serverUrl: this.serverUrl };
    if (this.options.fetchFn) authOptions.fetchFn = this.options.fetchFn;
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

    const provider = this.provider(actorId);
    const authOptions: AuthCompleteOptions = {
      serverUrl: this.serverUrl,
      authorizationCode: code,
    };
    if (this.options.fetchFn) authOptions.fetchFn = this.options.fetchFn;
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

  private provider(actorId: string): ActorOAuthProvider {
    return new ActorOAuthProvider(
      actorId,
      this.options.store,
      this.options.redirectUri,
      this.options.clientId,
      this.now,
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
        next.grantedScopes = [];
      }
      next.updatedAt = this.now();
      return next;
    });
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async verifyTools(actorId: string): Promise<void> {
    await this.withClient(actorId, async (client) => {
      const listed = await client.listTools();
      if (!listed.tools.some((tool) => isApplicationMcpTool(tool.name))) {
        throw new Error("Robinhood MCP did not expose an approved application tool.");
      }
    });
  }

  private async withClient<T>(
    actorId: string,
    operation: (client: Client) => Promise<T>,
  ): Promise<T> {
    const provider = this.provider(actorId);
    const transportOptions: TransportOptions = {
      authProvider: provider,
      requestInit: { headers: { "User-Agent": "phone-trading-poc/0.1" } },
    };
    if (this.options.fetchFn) transportOptions.fetch = this.options.fetchFn;
    const transport = new StreamableHTTPClientTransport(this.serverUrl, transportOptions);
    const client = new Client(
      { name: "phone-trading-poc", version: "0.1.0" },
      { capabilities: {} },
    );
    try {
      // SAFETY: StreamableHTTPClientTransport implements the MCP Transport interface; the SDK declaration has an exact-optional mismatch under this TypeScript version.
      await client.connect(transport as never);
      return await operation(client);
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

function isApplicationMcpTool(name: string): name is ApplicationMcpTool {
  return APPLICATION_MCP_TOOLS.some((candidate) => candidate === name);
}
