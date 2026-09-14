import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export interface HorizonboundDatabase {
  path: string;
  sqlite: Database.Database;
  db: BetterSQLite3Database<typeof schema>;
  close(): void;
  schemaVersion(): number;
}

export function openDatabase(databasePath: string): HorizonboundDatabase {
  const resolvedPath = path.resolve(databasePath);
  const directory = path.dirname(resolvedPath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);

  const sqlite = new Database(resolvedPath);
  fs.chmodSync(resolvedPath, 0o600);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  const recoveredAt = Date.now();
  sqlite.transaction(() => {
    sqlite
      .prepare(
        `UPDATE sync_runs
         SET status = 'interrupted', finished_at = ?, error_class = 'ProcessInterrupted',
             error_summary = 'Synchronization was interrupted before publication'
         WHERE status = 'running'`
      )
      .run(recoveredAt);
    sqlite
      .prepare("UPDATE sync_generations SET status = 'discarded' WHERE status = 'staging'")
      .run();
    sqlite.prepare("DELETE FROM sync_leases").run();
  })();

  return {
    path: resolvedPath,
    sqlite,
    db,
    close: () => sqlite.close(),
    schemaVersion: () =>
      Number(sqlite.prepare("SELECT COUNT(*) FROM __drizzle_migrations").pluck().get() ?? 0)
  };
}
