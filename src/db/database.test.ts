import { mkdtemp, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type HorizonboundDatabase } from "./database";
import { acquireLease, promoteGeneration, releaseLease } from "./sync-repository";
import { getCurrentForecast, saveForecastRevision } from "./forecast-repository";

const opened: HorizonboundDatabase[] = [];

async function createTestDatabase() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "horizonbound-db-"));
  const database = openDatabase(path.join(directory, "state.sqlite"));
  opened.push(database);
  return { database, directory };
}

afterEach(() => {
  for (const database of opened.splice(0)) database.close();
});

describe("SQLite persistence", () => {
  it("migrates an empty database with required pragmas and restrictive permissions", async () => {
    const { database, directory } = await createTestDatabase();

    expect(database.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(database.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(database.sqlite.pragma("busy_timeout", { simple: true })).toBe(5000);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(database.path)).mode & 0o777).toBe(0o600);
    expect(database.schemaVersion()).toBe(1);
  });

  it("rejects source relationships that cross or omit generation ownership", async () => {
    const { database } = await createTestDatabase();
    database.sqlite.exec(`
      INSERT INTO connections (id, linear_user_id, workspace_id, workspace_name, access_token_ciphertext, refresh_token_ciphertext, expires_at, granted_scope, created_at, updated_at)
      VALUES ('connection-1', 'user-1', 'workspace-1', 'Workspace', 'ciphertext', 'ciphertext', 9999999999999, 'read', 1, 1);
      INSERT INTO sync_generations (id, connection_id, status, created_at)
      VALUES ('generation-1', 'connection-1', 'staging', 1);
      INSERT INTO source_teams (generation_id, linear_id, workspace_id, name)
      VALUES ('generation-1', 'team-1', 'workspace-1', 'Team');
    `);

    expect(() =>
      database.sqlite
        .prepare(
          "INSERT INTO source_project_teams (generation_id, project_linear_id, team_linear_id) VALUES (?, ?, ?)"
        )
        .run("generation-1", "missing-project", "team-1")
    ).toThrow(/foreign key/i);
  });

  it("fences generation publication by the current unexpired lease owner", async () => {
    const { database } = await createTestDatabase();
    database.sqlite.exec(`
      INSERT INTO connections (id, linear_user_id, workspace_id, workspace_name, access_token_ciphertext, refresh_token_ciphertext, expires_at, granted_scope, created_at, updated_at)
      VALUES ('connection-1', 'user-1', 'workspace-1', 'Workspace', 'ciphertext', 'ciphertext', 9999999999999, 'read', 1, 1);
      INSERT INTO sync_generations (id, connection_id, status, created_at) VALUES ('generation-1', 'connection-1', 'staging', 1);
    `);

    expect(acquireLease(database, "connection-1", "owner-a", 100, 50)).toBe(true);
    expect(() =>
      promoteGeneration(database, "connection-1", "owner-b", "generation-1", 120)
    ).toThrow(/lease/i);
    expect(promoteGeneration(database, "connection-1", "owner-a", "generation-1", 120)).toBe(true);

    const status = database.sqlite
      .prepare("SELECT status FROM sync_generations WHERE id = ?")
      .pluck()
      .get("generation-1");
    expect(status).toBe("published");
  });

  it("allows an expired lease takeover and rejects the stale owner", async () => {
    const { database } = await createTestDatabase();
    database.sqlite.exec(`
      INSERT INTO connections (id, linear_user_id, workspace_id, workspace_name, access_token_ciphertext, refresh_token_ciphertext, expires_at, granted_scope, created_at, updated_at)
      VALUES ('connection-1', 'user-1', 'workspace-1', 'Workspace', 'ciphertext', 'ciphertext', 9999999999999, 'read', 1, 1);
      INSERT INTO sync_generations (id, connection_id, status, created_at) VALUES ('generation-1', 'connection-1', 'staging', 1);
    `);

    expect(acquireLease(database, "connection-1", "owner-a", 100, 10)).toBe(true);
    expect(acquireLease(database, "connection-1", "owner-b", 111, 10)).toBe(true);
    expect(() =>
      promoteGeneration(database, "connection-1", "owner-a", "generation-1", 112)
    ).toThrow(/lease/i);
    expect(releaseLease(database, "connection-1", "owner-a")).toBe(false);
    expect(
      database.sqlite
        .prepare("SELECT owner_token FROM sync_leases WHERE connection_id = 'connection-1'")
        .pluck()
        .get()
    ).toBe("owner-b");
  });

  it("marks staged work interrupted when the database is reopened", async () => {
    const { database, directory } = await createTestDatabase();
    database.sqlite.exec(`
      INSERT INTO connections (id, linear_user_id, workspace_id, workspace_name, access_token_ciphertext, refresh_token_ciphertext, expires_at, granted_scope, created_at, updated_at)
      VALUES ('connection-1', 'user-1', 'workspace-1', 'Workspace', 'ciphertext', 'ciphertext', 9999999999999, 'read', 1, 1);
      INSERT INTO sync_generations (id, connection_id, status, created_at, promoted_at)
      VALUES ('published', 'connection-1', 'published', 1, 2);
      INSERT INTO sync_generations (id, connection_id, status, created_at)
      VALUES ('staging', 'connection-1', 'staging', 3);
      INSERT INTO sync_runs (id, connection_id, generation_id, trigger, mode, status, started_at, page_count, record_count)
      VALUES ('run', 'connection-1', 'staging', 'manual', 'full', 'running', 3, 1, 1);
      INSERT INTO sync_leases (connection_id, owner_token, expires_at, renewed_at)
      VALUES ('connection-1', 'old-owner', 9999999999999, 3);
    `);
    database.close();
    opened.splice(opened.indexOf(database), 1);

    const reopened = openDatabase(path.join(directory, "state.sqlite"));
    opened.push(reopened);
    expect(
      reopened.sqlite
        .prepare("SELECT status FROM sync_generations WHERE id = 'published'")
        .pluck()
        .get()
    ).toBe("published");
    expect(
      reopened.sqlite
        .prepare("SELECT status FROM sync_generations WHERE id = 'staging'")
        .pluck()
        .get()
    ).toBe("discarded");
    expect(
      reopened.sqlite.prepare("SELECT status FROM sync_runs WHERE id = 'run'").pluck().get()
    ).toBe("interrupted");
    expect(reopened.sqlite.prepare("SELECT COUNT(*) FROM sync_leases").pluck().get()).toBe(0);
  });

  it("saves the current forecast and append-only user revision atomically", async () => {
    const { database } = await createTestDatabase();
    database.sqlite.exec(`
      INSERT INTO connections (id, linear_user_id, workspace_id, workspace_name, access_token_ciphertext, refresh_token_ciphertext, expires_at, granted_scope, created_at, updated_at)
      VALUES ('connection-1', 'user-1', 'workspace-1', 'Workspace', 'ciphertext', 'ciphertext', 9999999999999, 'read', 1, 1);
      INSERT INTO sync_generations (id, connection_id, status, created_at, promoted_at)
      VALUES ('generation-1', 'connection-1', 'published', 1, 2);
      INSERT INTO plans (id, connection_id, name, workspace_id, team_id, membership_label_id, commitment_status_id, horizon_weeks, weekly_capacity, capacity_effective_date, refinement_lead_time_days, current_generation_id, created_at, updated_at)
      VALUES ('plan-1', 'connection-1', 'Roadmap', 'workspace-1', 'team-1', 'label-1', 'status-1', 20, 10, '2026-09-01', 14, 'generation-1', 1, 1);
      INSERT INTO source_teams (generation_id, linear_id, workspace_id, name)
      VALUES ('generation-1', 'team-1', 'workspace-1', 'Team');
      INSERT INTO source_labels (generation_id, linear_id, workspace_id, name)
      VALUES ('generation-1', 'label-1', 'workspace-1', 'Roadmap');
      INSERT INTO source_statuses (generation_id, linear_id, workspace_id, team_id, name)
      VALUES ('generation-1', 'status-1', 'workspace-1', 'team-1', 'Planned');
      INSERT INTO source_projects (generation_id, linear_id, workspace_id, name, url, status_id, archived)
      VALUES ('generation-1', 'project-1', 'workspace-1', 'Project', 'https://linear.app/project-1', 'status-1', 0);
      INSERT INTO source_project_teams (generation_id, project_linear_id, team_linear_id)
      VALUES ('generation-1', 'project-1', 'team-1');
      INSERT INTO source_project_labels (generation_id, project_linear_id, label_linear_id)
      VALUES ('generation-1', 'project-1', 'label-1');
      INSERT INTO project_aggregates (generation_id, project_linear_id, completed_actual, detailed_open, unestimated_open_count, possible_double_counting)
      VALUES ('generation-1', 'project-1', 10, 7, 0, 0);
    `);

    const revision = saveForecastRevision(database, {
      id: "forecast-1",
      revisionId: "revision-1",
      connectionId: "connection-1",
      expectedGenerationId: "generation-1",
      planId: "plan-1",
      projectLinearId: "project-1",
      unrefinedLow: 3,
      unrefinedExpected: 5,
      unrefinedHigh: 8,
      confidence: "medium",
      estimateBasis: "analogy",
      forecastAsOfDate: "2026-09-11",
      capacityLaneId: null,
      horizonShare: 50,
      category: "initial",
      reason: "Initial planning range",
      actor: "local-user",
      createdAt: 100,
      completedActual: 10,
      detailedOpen: 7
    });

    expect(revision.baselineLifetimeHigh).toBe(25);
    expect(getCurrentForecast(database, "plan-1", "project-1")).toMatchObject({
      unrefinedExpected: 5,
      latestRevisionId: "revision-1"
    });
    expect(database.sqlite.prepare("SELECT COUNT(*) FROM forecast_revisions").pluck().get()).toBe(
      1
    );
  });
});
