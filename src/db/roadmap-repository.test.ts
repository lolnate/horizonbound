import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type HorizonboundDatabase } from "./database";
import { saveForecastRevision } from "./forecast-repository";
import { getRoadmap } from "./roadmap-repository";

const opened: HorizonboundDatabase[] = [];

afterEach(() => {
  for (const database of opened.splice(0)) database.close();
});

async function seed() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "horizonbound-roadmap-"));
  const database = openDatabase(path.join(directory, "state.sqlite"));
  opened.push(database);
  database.sqlite.exec(`
    INSERT INTO connections (id, linear_user_id, workspace_id, workspace_name, access_token_ciphertext, refresh_token_ciphertext, expires_at, granted_scope, created_at, updated_at)
    VALUES ('connection-1', 'user-1', 'workspace-1', 'Example', 'cipher', 'cipher', 99999999, 'read', 1, 1);
    INSERT INTO sync_generations (id, connection_id, status, created_at, promoted_at)
    VALUES ('generation-1', 'connection-1', 'published', 1, 50);
    INSERT INTO plans (id, connection_id, name, workspace_id, team_id, membership_label_id, commitment_status_id, horizon_weeks, weekly_capacity, capacity_effective_date, refinement_lead_time_days, current_generation_id, created_at, updated_at)
    VALUES ('plan-1', 'connection-1', 'Product roadmap', 'workspace-1', 'team-1', 'label-1', 'status-1', 20, 10, '2026-09-01', 14, 'generation-1', 1, 1);
    INSERT INTO capacity_lanes (id, plan_id, name, weekly_allocation, position)
    VALUES ('lane-1', 'plan-1', 'Product', 8, 0);
    INSERT INTO source_teams (generation_id, linear_id, workspace_id, name)
    VALUES ('generation-1', 'team-1', 'workspace-1', 'Platform');
    INSERT INTO source_labels (generation_id, linear_id, workspace_id, name)
    VALUES ('generation-1', 'label-1', 'workspace-1', 'Roadmap');
    INSERT INTO source_statuses (generation_id, linear_id, workspace_id, team_id, name)
    VALUES ('generation-1', 'status-1', 'workspace-1', 'team-1', 'Planned');
    INSERT INTO source_projects (generation_id, linear_id, workspace_id, name, url, status_id, start_date, archived)
    VALUES
      ('generation-1', 'project-1', 'workspace-1', 'Member project', 'https://linear.app/project-1', 'status-1', '2026-10-20', 0),
      ('generation-1', 'project-2', 'workspace-1', 'Unlabeled project', 'https://linear.app/project-2', 'status-1', NULL, 0),
      ('generation-1', 'project-3', 'workspace-1', 'Archived project', 'https://linear.app/project-3', 'status-1', NULL, 1);
    INSERT INTO source_project_teams (generation_id, project_linear_id, team_linear_id)
    VALUES ('generation-1', 'project-1', 'team-1'), ('generation-1', 'project-2', 'team-1'), ('generation-1', 'project-3', 'team-1');
    INSERT INTO source_project_labels (generation_id, project_linear_id, label_linear_id)
    VALUES ('generation-1', 'project-1', 'label-1'), ('generation-1', 'project-3', 'label-1');
    INSERT INTO project_aggregates (generation_id, project_linear_id, completed_actual, detailed_open, unestimated_open_count, possible_double_counting)
    VALUES ('generation-1', 'project-1', 10, 7, 1, 1), ('generation-1', 'project-2', 0, 0, 0, 0), ('generation-1', 'project-3', 2, 3, 0, 0);
    INSERT INTO sync_runs (id, connection_id, generation_id, trigger, mode, status, started_at, finished_at, page_count, record_count)
    VALUES ('run-1', 'connection-1', 'generation-1', 'manual', 'full', 'succeeded', 10, 50, 3, 20);
  `);
  saveForecastRevision(database, {
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
    capacityLaneId: "lane-1",
    horizonShare: 50,
    category: "initial",
    reason: "Initial range",
    actor: "local-user",
    createdAt: 100,
    completedActual: 10,
    detailedOpen: 7
  });
  return database;
}

describe("getRoadmap", () => {
  it("returns only membership-matching projects with source facts, forecast, warnings, and freshness", async () => {
    const database = await seed();

    const roadmap = getRoadmap(database, "plan-1", new Date("2026-09-11T12:00:00Z"));

    expect(roadmap?.projects.map((project) => project.id)).toEqual(["project-1"]);
    expect(roadmap).toMatchObject({
      name: "Product roadmap",
      workspaceName: "Example",
      lastSuccessfulSyncAt: 50,
      projects: [
        {
          id: "project-1",
          name: "Member project",
          completedActual: 10,
          detailedOpen: 7,
          unestimatedOpenCount: 1,
          possibleDoubleCounting: true,
          forecast: {
            unrefinedExpected: 5,
            lifetime: { expected: 22, high: 25 },
            remaining: { expected: 12 },
            horizonDemand: { expected: 6, high: 8 },
            refinement: { state: "planned" },
            integrityWarning: null
          }
        }
      ]
    });
  });

  it("rejects a forecast write when synchronization promotes a different generation first", async () => {
    const database = await seed();
    database.sqlite.exec(`
      INSERT INTO sync_generations (id, connection_id, status, created_at, promoted_at)
      VALUES ('generation-2', 'connection-1', 'published', 300, 300);
      UPDATE plans SET current_generation_id = 'generation-2' WHERE id = 'plan-1';
    `);

    expect(() =>
      saveForecastRevision(database, {
        id: "forecast-1",
        revisionId: "revision-raced",
        connectionId: "connection-1",
        expectedGenerationId: "generation-1",
        planId: "plan-1",
        projectLinearId: "project-1",
        unrefinedLow: 1,
        unrefinedExpected: 2,
        unrefinedHigh: 3,
        confidence: "low",
        estimateBasis: "stale browser state",
        forecastAsOfDate: "2026-09-12",
        capacityLaneId: "lane-1",
        horizonShare: 50,
        category: "updated",
        reason: "Should be rejected",
        actor: "local-user",
        createdAt: 301,
        completedActual: 10,
        detailedOpen: 7
      })
    ).toThrow(/generation changed/i);
    expect(
      database.sqlite
        .prepare("SELECT COUNT(*) FROM forecast_revisions WHERE id = 'revision-raced'")
        .pluck()
        .get()
    ).toBe(0);
  });

  it("keeps the user revision immutable across source changes until a new revision resets the baseline", async () => {
    const database = await seed();
    database.sqlite
      .prepare(
        "UPDATE project_aggregates SET detailed_open = 20 WHERE generation_id = 'generation-1' AND project_linear_id = 'project-1'"
      )
      .run();

    expect(
      getRoadmap(database, "plan-1", new Date("2026-09-11T12:00:00Z"))?.projects[0]?.forecast
        ?.integrityWarning
    ).toMatch(/exceeds/i);
    expect(
      database.sqlite
        .prepare("SELECT baseline_lifetime_high FROM forecast_revisions WHERE id = 'revision-1'")
        .pluck()
        .get()
    ).toBe(25);

    saveForecastRevision(database, {
      id: "forecast-1",
      revisionId: "revision-2",
      connectionId: "connection-1",
      expectedGenerationId: "generation-1",
      planId: "plan-1",
      projectLinearId: "project-1",
      unrefinedLow: 3,
      unrefinedExpected: 5,
      unrefinedHigh: 8,
      confidence: "low",
      estimateBasis: "scope review",
      forecastAsOfDate: "2026-09-12",
      capacityLaneId: "lane-1",
      horizonShare: 50,
      category: "updated",
      reason: "Source work increased",
      actor: "local-user",
      createdAt: 200,
      completedActual: 10,
      detailedOpen: 20
    });

    const refreshed = getRoadmap(database, "plan-1", new Date("2026-09-12T12:00:00Z"));
    expect(refreshed?.projects[0]?.forecast?.integrityWarning).toBeNull();
    expect(refreshed?.projects[0]?.forecast?.revisions).toHaveLength(2);
    expect(
      database.sqlite
        .prepare("SELECT baseline_lifetime_high FROM forecast_revisions WHERE id = 'revision-1'")
        .pluck()
        .get()
    ).toBe(25);
  });
});
