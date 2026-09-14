import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { openDatabase } from "../src/db/database";
import { fullReconciliation } from "../src/sync/full-reconciliation";
import { SyntheticLinearSource } from "../src/sync/synthetic-linear-source";
import { e2eSessionToken, e2eStateDirectory } from "./support";

export default async function globalSetup() {
  await rm(e2eStateDirectory, { recursive: true, force: true });
  const database = openDatabase(`${e2eStateDirectory}/horizonbound.sqlite`);
  const now = Date.now();
  database.sqlite
    .prepare(
      `INSERT INTO connections (
        id, linear_user_id, linear_user_name, workspace_id, workspace_name,
        access_token_ciphertext, refresh_token_ciphertext, expires_at,
        granted_scope, reconnect_required, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, '', '', ?, 'read', 0, ?, ?)`
    )
    .run(
      "e2e-connection",
      "e2e-actor",
      "E2E operator",
      "synthetic-workspace",
      "Synthetic workspace",
      now + 86_400_000,
      now,
      now
    );
  database.sqlite
    .prepare(
      "INSERT INTO app_sessions (id_hash, connection_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
    )
    .run(
      createHash("sha256").update(e2eSessionToken).digest("hex"),
      "e2e-connection",
      now,
      now + 86_400_000
    );
  await fullReconciliation({
    database,
    source: new SyntheticLinearSource(true),
    connectionId: "e2e-connection",
    generationId: "e2e-configuration",
    runId: "e2e-bootstrap",
    ownerToken: "e2e-bootstrap-owner",
    leaseTtlMs: 60_000,
    trigger: "startup",
    now: () => now
  });
  database.close();
}
