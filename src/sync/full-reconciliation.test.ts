import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type HorizonboundDatabase } from "../db/database";
import {
  fullReconciliation,
  LeaseUnavailableError,
  type LinearSource,
  type ReconciliationOptions
} from "./full-reconciliation";

const opened: HorizonboundDatabase[] = [];

async function createTestDatabase() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "horizonbound-sync-"));
  const database = openDatabase(path.join(directory, "state.sqlite"));
  opened.push(database);
  database.sqlite.exec(`
    INSERT INTO connections (id, linear_user_id, workspace_id, workspace_name, access_token_ciphertext, refresh_token_ciphertext, expires_at, granted_scope, created_at, updated_at)
    VALUES ('connection-1', 'user-1', 'workspace-1', 'Workspace', 'ciphertext', 'ciphertext', 9999999999999, 'read', 1, 1);
    INSERT INTO sync_generations (id, connection_id, status, created_at, promoted_at)
    VALUES ('published-generation', 'connection-1', 'published', 1, 1);
    INSERT INTO plans (id, connection_id, name, workspace_id, team_id, membership_label_id, commitment_status_id, horizon_weeks, weekly_capacity, capacity_effective_date, refinement_lead_time_days, current_generation_id, created_at, updated_at)
    VALUES ('plan-1', 'connection-1', 'Roadmap', 'workspace-1', 'team-1', 'label-1', 'status-1', 20, 10, '2026-09-01', 14, 'published-generation', 1, 1);
  `);
  return database;
}

function source(): LinearSource {
  return {
    async getConfiguration() {
      return {
        teams: [{ id: "team-1", workspaceId: "workspace-1", name: "Engineering" }],
        labels: [{ id: "label-1", workspaceId: "workspace-1", name: "Roadmap" }],
        statuses: [
          {
            id: "status-1",
            workspaceId: "workspace-1",
            teamId: "team-1",
            name: "Committed"
          }
        ]
      };
    },
    async getProjects(after) {
      if (after === null) {
        return {
          nodes: [
            {
              id: "project-1",
              workspaceId: "workspace-1",
              name: "Alpha",
              url: "https://linear.example/project/alpha",
              statusId: "status-1",
              startDate: null,
              archived: false,
              teamIds: ["team-1"],
              labelIds: ["label-1"]
            }
          ],
          nextCursor: "projects-page-2"
        };
      }
      return {
        nodes: [
          {
            id: "project-2",
            workspaceId: "workspace-1",
            name: "Beta",
            url: "https://linear.example/project/beta",
            statusId: null,
            startDate: "2026-10-01",
            archived: false,
            teamIds: ["team-1"],
            labelIds: []
          }
        ],
        nextCursor: null
      };
    },
    async getIssues(after) {
      if (after === null) {
        return {
          nodes: [
            {
              id: "issue-parent",
              projectId: "project-1",
              parentId: null,
              estimate: 5,
              state: "open",
              archived: false,
              updatedAt: "2026-09-10T00:00:00.000Z"
            },
            {
              id: "issue-child",
              projectId: "project-1",
              parentId: "issue-parent",
              estimate: 3,
              state: "open",
              archived: false,
              updatedAt: "2026-09-11T00:00:00.000Z"
            }
          ],
          nextCursor: "issues-page-2"
        };
      }
      return {
        nodes: [
          {
            id: "issue-unknown",
            projectId: "project-2",
            parentId: null,
            estimate: null,
            state: "open",
            archived: false,
            updatedAt: "2026-09-11T00:00:00.000Z"
          }
        ],
        nextCursor: null
      };
    },
    diagnostics() {
      return { requestCount: 7, rateLimitRemaining: 42, rateLimitResetAt: "2026-09-11T14:00:00Z" };
    }
  };
}

function options(
  database: HorizonboundDatabase,
  linearSource: LinearSource
): ReconciliationOptions {
  return {
    database,
    source: linearSource,
    connectionId: "connection-1",
    ownerToken: "owner-1",
    generationId: "generation-1",
    runId: "run-1",
    trigger: "manual",
    leaseTtlMs: 1_000,
    now: () => 100
  };
}

afterEach(() => {
  for (const database of opened.splice(0)) database.close();
});

describe("fullReconciliation", () => {
  it("stages every page and aggregate before atomically publishing the generation", async () => {
    const database = await createTestDatabase();

    const result = await fullReconciliation(options(database, source()));

    expect(result).toEqual({ generationId: "generation-1", pageCount: 4, recordCount: 8 });
    expect(
      database.sqlite
        .prepare("SELECT status FROM sync_generations WHERE id = ?")
        .pluck()
        .get("generation-1")
    ).toBe("published");
    expect(
      database.sqlite
        .prepare("SELECT status FROM sync_generations WHERE id = ?")
        .pluck()
        .get("published-generation")
    ).toBe("discarded");
    expect(
      database.sqlite
        .prepare("SELECT current_generation_id FROM plans WHERE id = 'plan-1'")
        .pluck()
        .get()
    ).toBe("generation-1");
    expect(
      database.sqlite
        .prepare(
          "SELECT completed_actual AS completedActual, detailed_open AS detailedOpen, unestimated_open_count AS unestimatedOpenCount, possible_double_counting AS possibleDoubleCounting FROM project_aggregates WHERE generation_id = ? ORDER BY project_linear_id"
        )
        .all("generation-1")
    ).toEqual([
      {
        completedActual: 0,
        detailedOpen: 8,
        unestimatedOpenCount: 0,
        possibleDoubleCounting: 1
      },
      {
        completedActual: 0,
        detailedOpen: 0,
        unestimatedOpenCount: 1,
        possibleDoubleCounting: 0
      }
    ]);
    expect(
      database.sqlite
        .prepare(
          `SELECT status, page_count AS pageCount, record_count AS recordCount,
                  provider_request_count AS providerRequestCount,
                  rate_limit_remaining AS rateLimitRemaining,
                  rate_limit_reset_at AS rateLimitResetAt
           FROM sync_runs WHERE id = ?`
        )
        .get("run-1")
    ).toEqual({
      status: "succeeded",
      pageCount: 4,
      recordCount: 8,
      providerRequestCount: 7,
      rateLimitRemaining: 42,
      rateLimitResetAt: "2026-09-11T14:00:00Z"
    });
    expect(database.sqlite.prepare("SELECT COUNT(*) FROM sync_leases").pluck().get()).toBe(0);
  });

  it("marks a late-page failure and keeps the last published generation visible", async () => {
    const database = await createTestDatabase();
    const failingSource = source();
    const getIssues = failingSource.getIssues;
    failingSource.getIssues = async (after) => {
      if (after === "issues-page-2") throw new Error("Linear page unavailable");
      return getIssues(after);
    };

    await expect(fullReconciliation(options(database, failingSource))).rejects.toThrow(
      "Linear page unavailable"
    );

    expect(
      database.sqlite
        .prepare("SELECT status FROM sync_generations WHERE id = ?")
        .pluck()
        .get("generation-1")
    ).toBe("discarded");
    expect(
      database.sqlite
        .prepare("SELECT status FROM sync_generations WHERE id = ?")
        .pluck()
        .get("published-generation")
    ).toBe("published");
    expect(
      database.sqlite
        .prepare("SELECT current_generation_id FROM plans WHERE id = 'plan-1'")
        .pluck()
        .get()
    ).toBe("published-generation");
    expect(
      database.sqlite
        .prepare(
          "SELECT status, page_count AS pageCount, record_count AS recordCount, error_class AS errorClass, error_summary AS errorSummary FROM sync_runs WHERE id = ?"
        )
        .get("run-1")
    ).toEqual({
      status: "failed",
      pageCount: 3,
      recordCount: 7,
      errorClass: "Error",
      errorSummary: "Required source data could not be synchronized"
    });
  });

  it("rejects a concurrent run before reading from Linear or creating staging state", async () => {
    const database = await createTestDatabase();
    database.sqlite
      .prepare(
        "INSERT INTO sync_leases (connection_id, owner_token, expires_at, renewed_at) VALUES (?, ?, ?, ?)"
      )
      .run("connection-1", "other-owner", 200, 100);
    const linearSource = source();
    let configurationReads = 0;
    const getConfiguration = linearSource.getConfiguration;
    linearSource.getConfiguration = async () => {
      configurationReads += 1;
      return getConfiguration();
    };

    await expect(fullReconciliation(options(database, linearSource))).rejects.toBeInstanceOf(
      LeaseUnavailableError
    );

    expect(configurationReads).toBe(0);
    expect(database.sqlite.prepare("SELECT COUNT(*) FROM sync_runs").pluck().get()).toBe(0);
    expect(
      database.sqlite
        .prepare("SELECT COUNT(*) FROM sync_generations WHERE id = 'generation-1'")
        .pluck()
        .get()
    ).toBe(0);
  });

  it("rejects a repeated pagination cursor before a plausible partial result can publish", async () => {
    const database = await createTestDatabase();
    const repeatingSource = source();
    let calls = 0;
    repeatingSource.getProjects = async () => {
      calls += 1;
      if (calls > 2) throw new Error("would loop forever");
      return { nodes: [], nextCursor: "same-cursor" };
    };

    await expect(fullReconciliation(options(database, repeatingSource))).rejects.toThrow(/cursor/i);
    expect(calls).toBe(2);
    expect(
      database.sqlite
        .prepare("SELECT status FROM sync_generations WHERE id = 'generation-1'")
        .pluck()
        .get()
    ).toBe("discarded");
  });

  it("fences publication when the lease expires during page retrieval", async () => {
    const database = await createTestDatabase();
    const linearSource = source();
    let currentTime = 100;
    const getIssues = linearSource.getIssues;
    linearSource.getIssues = async (after) => {
      const page = await getIssues(after);
      if (after === "issues-page-2") currentTime = 111;
      return page;
    };
    const reconciliationOptions = options(database, linearSource);
    reconciliationOptions.leaseTtlMs = 10;
    reconciliationOptions.now = () => currentTime;

    await expect(fullReconciliation(reconciliationOptions)).rejects.toThrow(/lease/i);

    expect(
      database.sqlite
        .prepare("SELECT status FROM sync_generations WHERE id = ?")
        .pluck()
        .get("generation-1")
    ).toBe("discarded");
    expect(
      database.sqlite
        .prepare("SELECT status FROM sync_generations WHERE id = ?")
        .pluck()
        .get("published-generation")
    ).toBe("published");
    expect(
      database.sqlite
        .prepare("SELECT current_generation_id FROM plans WHERE id = 'plan-1'")
        .pluck()
        .get()
    ).toBe("published-generation");
    expect(
      database.sqlite
        .prepare("SELECT status, error_summary AS errorSummary FROM sync_runs WHERE id = ?")
        .get("run-1")
    ).toEqual({
      status: "failed",
      errorSummary: "Synchronization lease expired or changed owner during retrieval"
    });
  });
});
