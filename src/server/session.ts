import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/auth/web-security";
import { getDatabase } from "./services";

export interface SessionContext {
  connectionId: string;
  workspaceId: string;
  workspaceName: string;
  linearUserId: string;
  linearUserName: string;
  credentialMode: "api_key" | "oauth";
  reconnectRequired: number;
}

export async function currentSession(): Promise<SessionContext | undefined> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return undefined;
  const idHash = createHash("sha256").update(token).digest("hex");
  return getDatabase()
    .sqlite.prepare(
      `SELECT c.id AS connectionId, c.workspace_id AS workspaceId,
              c.workspace_name AS workspaceName, c.linear_user_id AS linearUserId,
              c.linear_user_name AS linearUserName,
              c.credential_mode AS credentialMode,
              c.reconnect_required AS reconnectRequired
       FROM app_sessions s JOIN connections c ON c.id = s.connection_id
       WHERE s.id_hash = ? AND s.expires_at > ?`
    )
    .get(idHash, Date.now()) as SessionContext | undefined;
}

export async function requireSession(): Promise<SessionContext> {
  const session = await currentSession();
  if (!session) throw new Error("A valid Horizonbound session is required");
  return session;
}
