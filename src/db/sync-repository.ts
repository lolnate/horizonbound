import type { HorizonboundDatabase } from "./database";

export function acquireLease(
  database: HorizonboundDatabase,
  connectionId: string,
  ownerToken: string,
  now: number,
  ttl: number
): boolean {
  const result = database.sqlite
    .prepare(
      `INSERT INTO sync_leases (connection_id, owner_token, expires_at, renewed_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(connection_id) DO UPDATE SET
         owner_token = excluded.owner_token,
         expires_at = excluded.expires_at,
         renewed_at = excluded.renewed_at
       WHERE sync_leases.owner_token = excluded.owner_token
          OR sync_leases.expires_at <= excluded.renewed_at`
    )
    .run(connectionId, ownerToken, now + ttl, now);
  return result.changes === 1;
}

export function renewLease(
  database: HorizonboundDatabase,
  connectionId: string,
  ownerToken: string,
  now: number,
  ttl: number
): boolean {
  const result = database.sqlite
    .prepare(
      `UPDATE sync_leases SET expires_at = ?, renewed_at = ?
       WHERE connection_id = ? AND owner_token = ? AND expires_at > ?`
    )
    .run(now + ttl, now, connectionId, ownerToken, now);
  return result.changes === 1;
}

export function releaseLease(
  database: HorizonboundDatabase,
  connectionId: string,
  ownerToken: string
): boolean {
  return (
    database.sqlite
      .prepare("DELETE FROM sync_leases WHERE connection_id = ? AND owner_token = ?")
      .run(connectionId, ownerToken).changes === 1
  );
}

export function promoteGeneration(
  database: HorizonboundDatabase,
  connectionId: string,
  ownerToken: string,
  generationId: string,
  now: number
): boolean {
  const promote = database.sqlite.transaction(() => {
    const lease = database.sqlite
      .prepare(
        "SELECT owner_token AS ownerToken, expires_at AS expiresAt FROM sync_leases WHERE connection_id = ?"
      )
      .get(connectionId) as { ownerToken: string; expiresAt: number } | undefined;

    if (!lease || lease.ownerToken !== ownerToken || lease.expiresAt <= now) {
      throw new Error("Synchronization lease is missing, expired, or owned by another process");
    }

    const generation = database.sqlite
      .prepare("SELECT status FROM sync_generations WHERE id = ? AND connection_id = ?")
      .get(generationId, connectionId) as { status: string } | undefined;
    if (!generation || generation.status !== "staging") {
      throw new Error("Synchronization generation is not publishable");
    }

    database.sqlite
      .prepare(
        "UPDATE sync_generations SET status = 'discarded' WHERE connection_id = ? AND status = 'published'"
      )
      .run(connectionId);
    database.sqlite
      .prepare(
        "UPDATE sync_generations SET status = 'published', promoted_at = ? WHERE id = ? AND connection_id = ?"
      )
      .run(now, generationId, connectionId);
    database.sqlite
      .prepare("UPDATE plans SET current_generation_id = ?, updated_at = ? WHERE connection_id = ?")
      .run(generationId, now, connectionId);
    return true;
  });

  return promote();
}
