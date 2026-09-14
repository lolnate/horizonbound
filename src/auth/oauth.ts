import { createHash, randomBytes } from "node:crypto";
import type { HorizonboundDatabase } from "@/db/database";
import { TokenCipher } from "./token-cipher";

export interface OAuthTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
  user: { id: string; name: string };
  workspace: { id: string; name: string };
}

export interface LinearOAuthProvider {
  exchangeCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    clientId: string;
  }): Promise<OAuthTokenResponse>;
  refreshToken(
    refreshToken: string
  ): Promise<Pick<OAuthTokenResponse, "accessToken" | "refreshToken" | "expiresAt" | "scope">>;
  revokeToken(accessToken: string): Promise<void>;
}

interface OAuthServiceOptions {
  database: HorizonboundDatabase;
  provider: LinearOAuthProvider;
  cipher: TokenCipher;
  clientId: string;
  authorizeUrl: string;
  redirectUri: string;
  now?: () => number;
  randomToken?: () => string;
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const challenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
const defaultRandomToken = () => randomBytes(32).toString("base64url");

export class LinearOAuthService {
  private readonly now: () => number;
  private readonly randomToken: () => string;
  private readonly refreshes = new Map<string, Promise<string>>();

  constructor(private readonly options: OAuthServiceOptions) {
    this.now = options.now ?? Date.now;
    this.randomToken = options.randomToken ?? defaultRandomToken;
  }

  beginConnection() {
    const state = this.randomToken();
    const verifier = this.randomToken();
    const correlationCookie = this.randomToken();
    const createdAt = this.now();

    this.options.database.sqlite
      .prepare(
        `INSERT INTO oauth_states
          (correlation_hash, state_hash, verifier_ciphertext, redirect_uri, expires_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        hash(correlationCookie),
        hash(state),
        this.options.cipher.encrypt(verifier),
        this.options.redirectUri,
        createdAt + 10 * 60 * 1000
      );

    const url = new URL(this.options.authorizeUrl);
    url.searchParams.set("client_id", this.options.clientId);
    url.searchParams.set("redirect_uri", this.options.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "read");
    url.searchParams.set("actor", "user");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge(verifier));
    url.searchParams.set("code_challenge_method", "S256");

    return { authorizationUrl: url.toString(), correlationCookie };
  }

  async completeConnection(input: { correlationCookie: string; state: string; code: string }) {
    const now = this.now();
    const stateRecord = this.options.database.sqlite
      .prepare(
        `SELECT verifier_ciphertext AS verifierCiphertext, redirect_uri AS redirectUri
         FROM oauth_states
         WHERE correlation_hash = ? AND state_hash = ? AND consumed_at IS NULL AND expires_at > ?`
      )
      .get(hash(input.correlationCookie), hash(input.state), now) as
      { verifierCiphertext: string; redirectUri: string } | undefined;
    if (!stateRecord) throw new Error("OAuth state is invalid, expired, or already used");

    const claimed = this.options.database.sqlite
      .prepare(
        `UPDATE oauth_states SET consumed_at = ?
         WHERE correlation_hash = ? AND state_hash = ? AND consumed_at IS NULL AND expires_at > ?`
      )
      .run(now, hash(input.correlationCookie), hash(input.state), now);
    if (claimed.changes !== 1) throw new Error("OAuth state is invalid, expired, or already used");

    const token = await this.options.provider.exchangeCode({
      code: input.code,
      codeVerifier: this.options.cipher.decrypt(stateRecord.verifierCiphertext),
      redirectUri: stateRecord.redirectUri,
      clientId: this.options.clientId
    });
    const scopes = new Set(token.scope.split(/[\s,]+/).filter(Boolean));
    if (!scopes.has("read")) throw new Error("Linear did not grant the required read scope");
    const existingWorkspace = this.options.database.sqlite
      .prepare("SELECT workspace_id AS workspaceId FROM connections LIMIT 1")
      .get() as { workspaceId: string } | undefined;
    if (existingWorkspace && existingWorkspace.workspaceId !== token.workspace.id) {
      throw new Error("One Linear workspace is supported per Horizonbound installation");
    }

    const connectionId = `linear:${token.workspace.id}`;
    const sessionToken = this.randomToken();
    const save = this.options.database.sqlite.transaction(() => {
      this.options.database.sqlite
        .prepare(
          `INSERT INTO connections (
             id, linear_user_id, linear_user_name, workspace_id, workspace_name, access_token_ciphertext,
             refresh_token_ciphertext, expires_at, granted_scope, reconnect_required, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
           ON CONFLICT(workspace_id) DO UPDATE SET
             linear_user_id = excluded.linear_user_id,
             linear_user_name = excluded.linear_user_name,
             workspace_name = excluded.workspace_name,
             access_token_ciphertext = excluded.access_token_ciphertext,
             refresh_token_ciphertext = excluded.refresh_token_ciphertext,
             expires_at = excluded.expires_at,
             granted_scope = excluded.granted_scope,
             reconnect_required = 0,
             updated_at = excluded.updated_at`
        )
        .run(
          connectionId,
          token.user.id,
          token.user.name,
          token.workspace.id,
          token.workspace.name,
          this.options.cipher.encrypt(token.accessToken),
          this.options.cipher.encrypt(token.refreshToken),
          token.expiresAt,
          token.scope,
          now,
          now
        );
      this.options.database.sqlite
        .prepare(
          `INSERT INTO app_sessions (id_hash, connection_id, expires_at, created_at)
           VALUES (?, ?, ?, ?)`
        )
        .run(hash(sessionToken), connectionId, now + 30 * 24 * 60 * 60 * 1000, now);
    });
    save();

    return { sessionToken, workspaceName: token.workspace.name, userName: token.user.name };
  }

  async getAccessToken(connectionId: string): Promise<string> {
    const connection = this.options.database.sqlite
      .prepare(
        `SELECT access_token_ciphertext AS accessTokenCiphertext,
                refresh_token_ciphertext AS refreshTokenCiphertext,
                expires_at AS expiresAt, reconnect_required AS reconnectRequired
         FROM connections WHERE id = ?`
      )
      .get(connectionId) as
      | {
          accessTokenCiphertext: string;
          refreshTokenCiphertext: string;
          expiresAt: number;
          reconnectRequired: number;
        }
      | undefined;
    if (!connection || connection.reconnectRequired || !connection.accessTokenCiphertext) {
      throw new Error("Linear reconnection is required");
    }
    if (connection.expiresAt > this.now() + 60_000) {
      return this.options.cipher.decrypt(connection.accessTokenCiphertext);
    }

    return this.refreshAccessToken(connectionId);
  }

  async refreshAccessToken(connectionId: string): Promise<string> {
    const active = this.refreshes.get(connectionId);
    if (active) return active;
    const connection = this.options.database.sqlite
      .prepare(
        `SELECT refresh_token_ciphertext AS refreshTokenCiphertext,
                reconnect_required AS reconnectRequired
         FROM connections WHERE id = ?`
      )
      .get(connectionId) as
      { refreshTokenCiphertext: string; reconnectRequired: number } | undefined;
    if (!connection || connection.reconnectRequired || !connection.refreshTokenCiphertext) {
      throw new Error("Linear reconnection is required");
    }

    const refresh = this.refreshConnection(connectionId, connection.refreshTokenCiphertext).finally(
      () => this.refreshes.delete(connectionId)
    );
    this.refreshes.set(connectionId, refresh);
    return refresh;
  }

  private async refreshConnection(connectionId: string, refreshTokenCiphertext: string) {
    try {
      const token = await this.options.provider.refreshToken(
        this.options.cipher.decrypt(refreshTokenCiphertext)
      );
      if (!new Set(token.scope.split(/[\s,]+/).filter(Boolean)).has("read")) {
        throw new Error("Refreshed Linear token lacks read scope");
      }
      this.options.database.sqlite
        .prepare(
          `UPDATE connections SET access_token_ciphertext = ?, refresh_token_ciphertext = ?,
             expires_at = ?, granted_scope = ?, reconnect_required = 0, updated_at = ?
           WHERE id = ?`
        )
        .run(
          this.options.cipher.encrypt(token.accessToken),
          this.options.cipher.encrypt(token.refreshToken),
          token.expiresAt,
          token.scope,
          this.now(),
          connectionId
        );
      return token.accessToken;
    } catch (error) {
      this.options.database.sqlite
        .prepare("UPDATE connections SET reconnect_required = 1, updated_at = ? WHERE id = ?")
        .run(this.now(), connectionId);
      throw error;
    }
  }

  async disconnect(sessionToken: string): Promise<{ revocationFailed: boolean }> {
    const session = this.options.database.sqlite
      .prepare(
        `SELECT c.id AS connectionId, c.access_token_ciphertext AS accessTokenCiphertext
         FROM app_sessions s JOIN connections c ON c.id = s.connection_id
         WHERE s.id_hash = ? AND s.expires_at > ?`
      )
      .get(hash(sessionToken), this.now()) as
      { connectionId: string; accessTokenCiphertext: string } | undefined;
    if (!session) throw new Error("Session is invalid or expired");

    let revocationError: unknown;
    try {
      if (session.accessTokenCiphertext) {
        await this.options.provider.revokeToken(
          this.options.cipher.decrypt(session.accessTokenCiphertext)
        );
      }
    } catch (error) {
      revocationError = error;
    } finally {
      const clear = this.options.database.sqlite.transaction(() => {
        this.options.database.sqlite
          .prepare("DELETE FROM app_sessions WHERE connection_id = ?")
          .run(session.connectionId);
        this.options.database.sqlite
          .prepare(
            `UPDATE connections
             SET access_token_ciphertext = '', refresh_token_ciphertext = '',
                 reconnect_required = 1, updated_at = ?
             WHERE id = ?`
          )
          .run(this.now(), session.connectionId);
      });
      clear();
    }

    return { revocationFailed: Boolean(revocationError) };
  }

  verifySession(sessionToken: string) {
    return this.options.database.sqlite
      .prepare(
        `SELECT c.id AS connectionId, c.workspace_id AS workspaceId, c.workspace_name AS workspaceName,
                c.linear_user_id AS linearUserId, c.linear_user_name AS linearUserName,
                c.reconnect_required AS reconnectRequired
         FROM app_sessions s JOIN connections c ON c.id = s.connection_id
         WHERE s.id_hash = ? AND s.expires_at > ?`
      )
      .get(hash(sessionToken), this.now());
  }
}
