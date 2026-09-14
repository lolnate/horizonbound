import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { HorizonboundDatabase } from "@/db/database";

const identitySchema = z.object({
  data: z.object({
    viewer: z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      organization: z.object({ id: z.string().min(1), name: z.string().min(1) })
    })
  }),
  errors: z.never().optional()
});

export interface LinearIdentity {
  user: { id: string; name: string };
  workspace: { id: string; name: string };
}

export interface LinearApiKeyIdentityProvider {
  getIdentity(apiKey: string): Promise<LinearIdentity>;
}

export class LinearHttpApiKeyIdentityProvider implements LinearApiKeyIdentityProvider {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async getIdentity(apiKey: string): Promise<LinearIdentity> {
    try {
      const response = await this.fetcher("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
          Authorization: apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query: "query HorizonboundViewer { viewer { id name organization { id name } } }"
        }),
        signal: AbortSignal.timeout(30_000)
      });
      if (!response.ok) throw new Error("provider rejected credential");
      const parsed = identitySchema.parse(await response.json());
      return {
        user: { id: parsed.data.viewer.id, name: parsed.data.viewer.name },
        workspace: parsed.data.viewer.organization
      };
    } catch {
      throw new Error("Linear API key is invalid, revoked, or insufficiently scoped");
    }
  }
}

interface LinearApiKeyServiceOptions {
  database: HorizonboundDatabase;
  provider: LinearApiKeyIdentityProvider;
  apiKey: string;
  now?: () => number;
  randomToken?: () => string;
}

export class LinearApiKeyService {
  constructor(private readonly options: LinearApiKeyServiceOptions) {}

  private now() {
    return (this.options.now ?? Date.now)();
  }

  private randomToken() {
    return (this.options.randomToken ?? (() => randomBytes(32).toString("base64url")))();
  }

  async connect() {
    const identity = await this.options.provider.getIdentity(this.options.apiKey);
    const existingWorkspace = this.options.database.sqlite
      .prepare("SELECT workspace_id AS workspaceId FROM connections LIMIT 1")
      .get() as { workspaceId: string } | undefined;
    if (existingWorkspace && existingWorkspace.workspaceId !== identity.workspace.id) {
      throw new Error("One Linear workspace is supported per Horizonbound installation");
    }

    const now = this.now();
    const connectionId = `linear:${identity.workspace.id}`;
    const sessionToken = this.randomToken();
    this.options.database.sqlite.transaction(() => {
      this.options.database.sqlite
        .prepare(
          `INSERT INTO connections (
             id, linear_user_id, linear_user_name, workspace_id, workspace_name, credential_mode,
             access_token_ciphertext, refresh_token_ciphertext, expires_at, granted_scope,
             reconnect_required, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 'api_key', '', '', 0, 'read', 0, ?, ?)
           ON CONFLICT(workspace_id) DO UPDATE SET
             linear_user_id = excluded.linear_user_id,
             linear_user_name = excluded.linear_user_name,
             workspace_name = excluded.workspace_name,
             credential_mode = 'api_key',
             granted_scope = 'read',
             reconnect_required = 0,
             updated_at = excluded.updated_at`
        )
        .run(
          connectionId,
          identity.user.id,
          identity.user.name,
          identity.workspace.id,
          identity.workspace.name,
          now,
          now
        );
      this.options.database.sqlite
        .prepare(
          `INSERT INTO app_sessions (id_hash, connection_id, expires_at, created_at)
           VALUES (?, ?, ?, ?)`
        )
        .run(hash(sessionToken), connectionId, now + 30 * 24 * 60 * 60 * 1000, now);
    })();

    return { sessionToken, connectionId, workspaceName: identity.workspace.name };
  }

  async endSession(sessionToken: string): Promise<void> {
    endApiKeySession(this.options.database, sessionToken, this.now());
  }

  verifySession(sessionToken: string) {
    return verifyApiKeySession(this.options.database, sessionToken, this.now());
  }
}

export function endApiKeySession(
  database: HorizonboundDatabase,
  sessionToken: string,
  now = Date.now()
): void {
  const session = verifyApiKeySession(database, sessionToken, now) as
    { connectionId: string } | undefined;
  if (!session) throw new Error("Session is invalid or expired");
  database.sqlite
    .prepare("DELETE FROM app_sessions WHERE connection_id = ?")
    .run(session.connectionId);
}

function verifyApiKeySession(database: HorizonboundDatabase, sessionToken: string, now: number) {
  return database.sqlite
    .prepare(
      `SELECT c.id AS connectionId, c.workspace_id AS workspaceId,
              c.workspace_name AS workspaceName, c.linear_user_id AS linearUserId,
              c.linear_user_name AS linearUserName, c.credential_mode AS credentialMode,
              c.reconnect_required AS reconnectRequired
       FROM app_sessions s JOIN connections c ON c.id = s.connection_id
       WHERE s.id_hash = ? AND s.expires_at > ? AND c.credential_mode = 'api_key'`
    )
    .get(hash(sessionToken), now);
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
