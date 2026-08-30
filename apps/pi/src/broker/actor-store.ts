import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { z } from "zod";
import { assertBoundActor } from "../identity/actor-binding.js";

const PROVIDER = "robinhood" as const;
const ENVELOPE_SCHEMA_VERSION = 1 as const;
const ALGORITHM = "A256GCM" as const;
const stableId = z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9:_-]+$/);
const base64Url = z.string().min(1).max(512 * 1024).regex(/^[A-Za-z0-9_-]+$/);
const initializationVector = z.string().length(16).regex(/^[A-Za-z0-9_-]+$/);
const authenticationTag = z.string().length(22).regex(/^[A-Za-z0-9_-]+$/);
const sha256 = z.string().length(64).regex(/^[a-f0-9]+$/);

const clientInformationSchema = z.object({
  client_id: z.string().min(1).max(8_192),
  client_secret: z.string().min(1).max(8_192).optional(),
  client_id_issued_at: z.number().finite().nonnegative().optional(),
  client_secret_expires_at: z.number().finite().nonnegative().optional(),
}).strict();

const tokensSchema = z.object({
  access_token: z.string().min(1).max(128 * 1024),
  id_token: z.string().min(1).max(128 * 1024).optional(),
  token_type: z.string().min(1).max(128),
  expires_in: z.number().finite().nonnegative().optional(),
  scope: z.string().max(8_192).optional(),
  refresh_token: z.string().min(1).max(128 * 1024).optional(),
}).strict();

const oauthTransactionSchema = z.object({
  state: z.string().min(32).max(512).regex(/^[A-Za-z0-9_-]+$/),
  codeVerifier: z.string().min(43).max(128).regex(/^[A-Za-z0-9._~-]+$/).optional(),
  authorizationUrl: z.url().max(16 * 1024).optional(),
  expectedIssuer: z.url(),
  expectedResource: z.url(),
  expectedRedirectUri: z.url(),
  createdAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
  consumedAt: z.number().int().nonnegative().optional(),
}).strict();

const clientRegistrationBindingSchema = z.object({
  profileVersion: z.literal(1),
  issuer: z.url(),
  resource: z.url(),
  redirectUri: z.url(),
  scope: z.literal("internal"),
  metadataHash: sha256,
}).strict();

const storedConnectionSchema = z.object({
  schemaVersion: z.literal(1),
  actorId: stableId,
  clientInformation: clientInformationSchema.optional(),
  clientRegistration: clientRegistrationBindingSchema.optional(),
  tokens: tokensSchema.optional(),
  oauthTransaction: oauthTransactionSchema.optional(),
  label: z.string().trim().min(1).max(256).optional(),
  grantedScopes: z.array(z.string().trim().min(1).max(256)).max(64),
  updatedAt: z.number().int().nonnegative(),
}).strict();

const encryptedEnvelopeSchema = z.object({
  schemaVersion: z.literal(ENVELOPE_SCHEMA_VERSION),
  actorId: stableId,
  provider: z.literal(PROVIDER),
  keyVersion: z.number().int().positive(),
  algorithm: z.literal(ALGORITHM),
  iv: initializationVector,
  ciphertext: base64Url,
  authTag: authenticationTag,
}).strict();

const getResponseSchema = z.object({
  schemaVersion: z.literal(ENVELOPE_SCHEMA_VERSION),
  credential: encryptedEnvelopeSchema.nullable(),
}).strict();

const putResponseSchema = z.object({
  schemaVersion: z.literal(ENVELOPE_SCHEMA_VERSION),
  stored: z.literal(true),
}).strict();

const deleteResponseSchema = z.object({
  schemaVersion: z.literal(ENVELOPE_SCHEMA_VERSION),
  deleted: z.boolean(),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict();

const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const revisedGetResponseSchema = getResponseSchema.extend({
  revision,
}).strict();

const revisedPutResponseSchema = putResponseSchema.extend({
  revision,
}).strict();

export interface StoredOAuthTransaction {
  state: string;
  codeVerifier?: string | undefined;
  authorizationUrl?: string | undefined;
  expectedIssuer: string;
  expectedResource: string;
  expectedRedirectUri: string;
  createdAt: number;
  expiresAt: number;
  consumedAt?: number | undefined;
}

export interface StoredClientRegistrationBinding {
  profileVersion: 1;
  issuer: string;
  resource: string;
  redirectUri: string;
  scope: "internal";
  metadataHash: string;
}

export interface StoredRobinhoodConnection {
  schemaVersion: 1;
  actorId: string;
  clientInformation?: OAuthClientInformationMixed | undefined;
  clientRegistration?: StoredClientRegistrationBinding | undefined;
  tokens?: OAuthTokens | undefined;
  oauthTransaction?: StoredOAuthTransaction | undefined;
  label?: string | undefined;
  grantedScopes: string[];
  updatedAt: number;
}

export interface ActorCredentialStore {
  read(actorId: string): Promise<StoredRobinhoodConnection | undefined>;
  write(value: StoredRobinhoodConnection): Promise<void>;
  delete(actorId: string): Promise<void>;
  update(
    actorId: string,
    /** This callback can run twice when Convex reports a revision conflict. */
    update: (current: StoredRobinhoodConnection | undefined) => StoredRobinhoodConnection,
  ): Promise<StoredRobinhoodConnection>;
}

export interface ConvexActorStoreOptions {
  actorId: string;
  siteUrl: string;
  sharedSecret: string;
  encryptionKey: string;
  keyVersion: number;
  requestTimeoutMs: number;
  retryAttempts: number;
  fetch?: typeof fetch;
}

type EncryptedEnvelope = z.infer<typeof encryptedEnvelopeSchema>;
interface GetCredentialRequest {
  schemaVersion: 1;
  actorId: string;
  provider: typeof PROVIDER;
}

interface PutCredentialRequest extends GetCredentialRequest {
  expectedRevision: number;
  credential: EncryptedEnvelope;
}

interface DeleteCredentialRequest extends GetCredentialRequest {
  expectedRevision: number;
}

type CredentialStoreRequest = GetCredentialRequest | PutCredentialRequest | DeleteCredentialRequest;

interface RevisedConnection {
  value: StoredRobinhoodConnection | undefined;
  revision: number;
}

class CredentialStoreRequestError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "CredentialStoreRequestError";
  }
}

function aad(actorId: string, keyVersion: number): Buffer {
  return Buffer.from(
    `broker-credential|schema=${ENVELOPE_SCHEMA_VERSION}|actor=${actorId}|provider=${PROVIDER}|key=${keyVersion}`,
    "utf8",
  );
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class ConvexActorStore implements ActorCredentialStore {
  private readonly key: Buffer;
  private readonly fetch: typeof fetch;
  private operationTail: Promise<void> = Promise.resolve();

  constructor(private readonly options: ConvexActorStoreOptions) {
    if (options.encryptionKey.trim().length < 32) {
      throw new Error("PI_CREDENTIAL_ENCRYPTION_KEY must contain at least 32 characters.");
    }
    if (!Number.isSafeInteger(options.keyVersion) || options.keyVersion < 1) {
      throw new Error("PI_CREDENTIAL_KEY_VERSION must be a positive integer.");
    }
    if (!stableId.safeParse(options.actorId).success) throw new Error("BOUND_ACTOR_ID is invalid.");
    this.key = createHash("sha256").update(options.encryptionKey, "utf8").digest();
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async read(actorId: string): Promise<StoredRobinhoodConnection | undefined> {
    this.assertBoundActor(actorId);
    return this.serialized(async () => (await this.readUnlocked()).value);
  }

  async write(value: StoredRobinhoodConnection): Promise<void> {
    this.assertBoundActor(value.actorId);
    return this.serialized(async () => {
      const current = await this.readUnlocked();
      try {
        await this.writeUnlocked(value, current.revision);
      } catch (error) {
        if (!(error instanceof CredentialStoreRequestError) || error.status !== 409) throw error;
        const refreshed = await this.readUnlocked();
        await this.writeUnlocked(value, refreshed.revision);
      }
    });
  }

  async delete(actorId: string): Promise<void> {
    this.assertBoundActor(actorId);
    return this.serialized(async () => {
      const current = await this.readUnlocked();
      try {
        await this.deleteUnlocked(current.revision);
      } catch (error) {
        if (!(error instanceof CredentialStoreRequestError) || error.status !== 409) throw error;
        const refreshed = await this.readUnlocked();
        await this.deleteUnlocked(refreshed.revision);
      }
    });
  }

  async update(
    actorId: string,
    update: (current: StoredRobinhoodConnection | undefined) => StoredRobinhoodConnection,
  ): Promise<StoredRobinhoodConnection> {
    this.assertBoundActor(actorId);
    return this.serialized(async () => {
      let current = await this.readUnlocked();
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const next = storedConnectionSchema.parse(update(current.value));
        this.assertBoundActor(next.actorId);
        try {
          await this.writeUnlocked(next, current.revision);
          return next;
        } catch (error) {
          if (
            !(error instanceof CredentialStoreRequestError)
            || error.status !== 409
            || attempt === 2
          ) {
            throw error;
          }
          current = await this.readUnlocked();
        }
      }
      throw new Error("Broker credential update did not complete.");
    });
  }

  private assertBoundActor(actorId: string): void {
    assertBoundActor(this.options.actorId, actorId);
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async readUnlocked(): Promise<RevisedConnection> {
    const response = await this.post("/service/broker-credentials/get", {
      schemaVersion: ENVELOPE_SCHEMA_VERSION,
      actorId: this.options.actorId,
      provider: PROVIDER,
    }, revisedGetResponseSchema, "Convex returned an invalid broker credential response.");
    return {
      value: response.credential === null ? undefined : this.decrypt(response.credential),
      revision: response.revision,
    };
  }

  private async writeUnlocked(value: StoredRobinhoodConnection, expectedRevision: number): Promise<void> {
    const validated = storedConnectionSchema.parse(value);
    await this.post("/service/broker-credentials/put", {
      schemaVersion: ENVELOPE_SCHEMA_VERSION,
      actorId: this.options.actorId,
      provider: PROVIDER,
      expectedRevision,
      credential: this.encrypt(validated),
    }, revisedPutResponseSchema, "Convex returned an invalid broker credential acknowledgement.");
  }

  private async deleteUnlocked(expectedRevision: number): Promise<void> {
    await this.post("/service/broker-credentials/delete", {
      schemaVersion: ENVELOPE_SCHEMA_VERSION,
      actorId: this.options.actorId,
      provider: PROVIDER,
      expectedRevision,
    }, deleteResponseSchema, "Convex returned an invalid broker credential deletion response.");
  }

  private encrypt(value: StoredRobinhoodConnection): EncryptedEnvelope {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(aad(this.options.actorId, this.options.keyVersion));
    const plaintext = Buffer.from(JSON.stringify(value), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      schemaVersion: ENVELOPE_SCHEMA_VERSION,
      actorId: this.options.actorId,
      provider: PROVIDER,
      keyVersion: this.options.keyVersion,
      algorithm: ALGORITHM,
      iv: iv.toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
      authTag: cipher.getAuthTag().toString("base64url"),
    };
  }

  private decrypt(envelope: EncryptedEnvelope): StoredRobinhoodConnection {
    this.assertBoundActor(envelope.actorId);
    if (envelope.keyVersion !== this.options.keyVersion) {
      throw new Error("Broker credential key version is unavailable.");
    }
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(envelope.iv, "base64url"));
    decipher.setAAD(aad(this.options.actorId, envelope.keyVersion));
    decipher.setAuthTag(Buffer.from(envelope.authTag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    // SAFETY: The authenticated GCM envelope is parsed through a strict schema before use.
    const parsed: unknown = JSON.parse(plaintext);
    const value = storedConnectionSchema.parse(parsed);
    this.assertBoundActor(value.actorId);
    return value;
  }

  private async post<T>(
    path: string,
    body: CredentialStoreRequest,
    responseSchema: z.ZodType<T>,
    invalidResponseMessage: string,
  ): Promise<T> {
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= this.options.retryAttempts; attempt += 1) {
      try {
        const response = await this.fetch(`${this.options.siteUrl}${path}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.options.sharedSecret}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.options.requestTimeoutMs),
        });
        if (!response.ok) {
          const error = new CredentialStoreRequestError(
            `Convex broker credential request failed with HTTP ${response.status}.`,
            isRetryableStatus(response.status),
            response.status,
          );
          if (!error.retryable) throw error;
          lastError = error;
        } else {
          const payload: unknown = await response.json();
          const parsed = responseSchema.safeParse(payload);
          if (!parsed.success) {
            throw new CredentialStoreRequestError(invalidResponseMessage, false);
          }
          return parsed.data;
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Convex broker credential request failed.");
        if (error instanceof CredentialStoreRequestError && !error.retryable) {
          throw error;
        }
      }
      if (attempt < this.options.retryAttempts) await delay(250 * 2 ** (attempt - 1));
    }
    throw lastError ?? new Error("Convex broker credential request failed.");
  }
}

export function defaultConnection(actorId: string): StoredRobinhoodConnection {
  return { schemaVersion: 1, actorId, grantedScopes: [], updatedAt: Date.now() };
}
