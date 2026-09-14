import { randomUUID } from "node:crypto";
import { getPlan } from "@/db/plan-repository";
import { fullReconciliation, type ReconciliationResult } from "@/sync/full-reconciliation";
import { LinearGraphqlSource } from "@/sync/linear-graphql-source";
import { SyntheticLinearSource } from "@/sync/synthetic-linear-source";
import { getDatabase, getOAuthService } from "./services";

export function isAuthorizationFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === "Linear authorization failed; reconnection may be required"
  );
}

export async function refreshConnection(
  connectionId: string,
  planId: string | null,
  trigger: "launch" | "manual" | "scope_change"
): Promise<ReconciliationResult> {
  const database = getDatabase();
  const connection = database.sqlite
    .prepare("SELECT workspace_id AS workspaceId FROM connections WHERE id = ?")
    .get(connectionId) as { workspaceId: string } | undefined;
  if (!connection) throw new Error("Linear connection is unavailable");

  const plan = planId ? getPlan(database, planId) : undefined;
  if (planId && (!plan || plan.connectionId !== connectionId)) {
    throw new Error("Plan does not belong to the active connection");
  }

  const configurationOnly = !plan;
  const synthetic = process.env.HORIZONBOUND_ENABLE_SYNTHETIC_SOURCE === "1";
  const scope = {
    workspaceId: connection.workspaceId,
    teamId: plan?.teamId ?? null,
    membershipLabelId: plan?.membershipLabel.id ?? null
  };
  const run = (source: SyntheticLinearSource | LinearGraphqlSource) =>
    fullReconciliation({
      database,
      source,
      connectionId,
      ownerToken: randomUUID(),
      generationId: randomUUID(),
      runId: randomUUID(),
      trigger,
      leaseTtlMs: 60_000
    });
  const oauth = synthetic ? null : getOAuthService();
  const source = synthetic
    ? new SyntheticLinearSource(configurationOnly)
    : new LinearGraphqlSource(await oauth!.getAccessToken(connectionId), scope);

  try {
    return await run(source);
  } catch (error) {
    if (isAuthorizationFailure(error) && oauth) {
      try {
        const refreshedAccessToken = await oauth.refreshAccessToken(connectionId);
        return await run(new LinearGraphqlSource(refreshedAccessToken, scope));
      } catch (retryError) {
        database.sqlite
          .prepare("UPDATE connections SET reconnect_required = 1, updated_at = ? WHERE id = ?")
          .run(Date.now(), connectionId);
        throw retryError;
      }
    }
    throw error;
  }
}
