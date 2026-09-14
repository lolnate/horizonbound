import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type HorizonboundDatabase } from "./database";
import { getPlan, savePlan } from "./plan-repository";

const opened: HorizonboundDatabase[] = [];

async function createTestDatabase() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "horizonbound-plan-"));
  const database = openDatabase(path.join(directory, "state.sqlite"));
  opened.push(database);
  return database;
}

function seedConfiguration(database: HorizonboundDatabase, generationId = "generation-1") {
  database.sqlite.exec(`
    INSERT INTO connections (
      id, linear_user_id, workspace_id, workspace_name, access_token_ciphertext,
      refresh_token_ciphertext, expires_at, granted_scope, created_at, updated_at
    ) VALUES (
      'connection-1', 'user-1', 'workspace-1', 'Synthetic Workspace',
      'ciphertext', 'ciphertext', 9999999999999, 'read', 1, 1
    );
    INSERT INTO sync_generations (id, connection_id, status, created_at, promoted_at)
    VALUES ('${generationId}', 'connection-1', 'published', 1, 2);
    INSERT INTO source_teams (generation_id, linear_id, workspace_id, name)
    VALUES ('${generationId}', 'team-1', 'workspace-1', 'Synthetic Team');
    INSERT INTO source_labels (generation_id, linear_id, workspace_id, name)
    VALUES ('${generationId}', 'label-1', 'workspace-1', 'Roadmap');
    INSERT INTO source_statuses (generation_id, linear_id, workspace_id, team_id, name)
    VALUES ('${generationId}', 'status-1', 'workspace-1', 'team-1', 'Committed');
  `);
}

const plan = {
  name: "Platform roadmap",
  workspaceId: "workspace-1",
  teamId: "team-1",
  membershipLabel: { id: "label-1", workspaceId: "workspace-1" },
  commitmentStatus: { id: "status-1", workspaceId: "workspace-1", teamId: "team-1" },
  horizonWeeks: 20,
  weeklyCapacity: 10,
  capacityEffectiveDate: "2026-09-01",
  refinementLeadTimeDays: 14,
  lanes: [
    { name: "Product", weeklyAllocation: 8 },
    { name: "Maintenance", weeklyAllocation: 2 }
  ]
};

afterEach(() => {
  for (const database of opened.splice(0)) database.close();
});

describe("plan repository", () => {
  it("transactionally saves and reads one complete plan with ordered named lanes", async () => {
    const database = await createTestDatabase();
    seedConfiguration(database);

    const saved = savePlan(database, {
      id: "plan-1",
      connectionId: "connection-1",
      configurationGenerationId: "generation-1",
      plan,
      now: 100
    });

    expect(saved).toEqual(getPlan(database, "plan-1"));
    expect(saved).toMatchObject({
      id: "plan-1",
      connectionId: "connection-1",
      currentGenerationId: "generation-1",
      ...plan,
      lanes: [
        { name: "Product", weeklyAllocation: 8, position: 0 },
        { name: "Maintenance", weeklyAllocation: 2, position: 1 }
      ],
      createdAt: 100,
      updatedAt: 100
    });
    expect(saved?.lanes[0]?.id).toEqual(expect.any(String));
  });

  it("rejects a configuration generation that has not been published", async () => {
    const database = await createTestDatabase();
    seedConfiguration(database);
    database.sqlite
      .prepare("UPDATE sync_generations SET status = 'staging', promoted_at = NULL WHERE id = ?")
      .run("generation-1");

    expect(() =>
      savePlan(database, {
        id: "plan-1",
        connectionId: "connection-1",
        configurationGenerationId: "generation-1",
        plan,
        now: 100
      })
    ).toThrow(/published configuration generation/i);
    expect(database.sqlite.prepare("SELECT COUNT(*) FROM plans").pluck().get()).toBe(0);
    expect(database.sqlite.prepare("SELECT COUNT(*) FROM capacity_lanes").pluck().get()).toBe(0);
  });

  it("requires evidence that publication completed successfully", async () => {
    const database = await createTestDatabase();
    seedConfiguration(database);
    database.sqlite
      .prepare("UPDATE sync_generations SET promoted_at = NULL WHERE id = ?")
      .run("generation-1");

    expect(() =>
      savePlan(database, {
        id: "plan-1",
        connectionId: "connection-1",
        configurationGenerationId: "generation-1",
        plan,
        now: 100
      })
    ).toThrow(/published configuration generation/i);
    expect(database.sqlite.prepare("SELECT COUNT(*) FROM plans").pluck().get()).toBe(0);
  });

  it("rejects a team that is absent from the specified configuration generation", async () => {
    const database = await createTestDatabase();
    seedConfiguration(database);

    expect(() =>
      savePlan(database, {
        id: "plan-1",
        connectionId: "connection-1",
        configurationGenerationId: "generation-1",
        plan: {
          ...plan,
          teamId: "team-missing",
          commitmentStatus: { ...plan.commitmentStatus, teamId: "team-missing" }
        },
        now: 100
      })
    ).toThrow(/team.*published configuration generation/i);
    expect(database.sqlite.prepare("SELECT COUNT(*) FROM plans").pluck().get()).toBe(0);
  });

  it("rejects a membership label whose published workspace does not match", async () => {
    const database = await createTestDatabase();
    seedConfiguration(database);
    database.sqlite
      .prepare(
        "UPDATE source_labels SET workspace_id = 'workspace-other' WHERE linear_id = 'label-1'"
      )
      .run();

    expect(() =>
      savePlan(database, {
        id: "plan-1",
        connectionId: "connection-1",
        configurationGenerationId: "generation-1",
        plan,
        now: 100
      })
    ).toThrow(/label.*published configuration generation/i);
    expect(database.sqlite.prepare("SELECT COUNT(*) FROM plans").pluck().get()).toBe(0);
  });

  it("rejects a commitment status whose published team scope is incompatible", async () => {
    const database = await createTestDatabase();
    seedConfiguration(database);
    database.sqlite
      .prepare(
        "INSERT INTO source_teams (generation_id, linear_id, workspace_id, name) VALUES ('generation-1', 'team-other', 'workspace-1', 'Other')"
      )
      .run();
    database.sqlite
      .prepare("UPDATE source_statuses SET team_id = 'team-other' WHERE linear_id = 'status-1'")
      .run();

    expect(() =>
      savePlan(database, {
        id: "plan-1",
        connectionId: "connection-1",
        configurationGenerationId: "generation-1",
        plan,
        now: 100
      })
    ).toThrow(/status.*selected team/i);
    expect(database.sqlite.prepare("SELECT COUNT(*) FROM plans").pluck().get()).toBe(0);
  });

  it("rejects a workspace that is not owned by the connection", async () => {
    const database = await createTestDatabase();
    seedConfiguration(database);
    database.sqlite
      .prepare("UPDATE connections SET workspace_id = 'workspace-other' WHERE id = 'connection-1'")
      .run();

    expect(() =>
      savePlan(database, {
        id: "plan-1",
        connectionId: "connection-1",
        configurationGenerationId: "generation-1",
        plan,
        now: 100
      })
    ).toThrow(/workspace.*connection/i);
    expect(database.sqlite.prepare("SELECT COUNT(*) FROM plans").pluck().get()).toBe(0);
  });

  it("revalidates the complete plan domain input on the server", async () => {
    const database = await createTestDatabase();
    seedConfiguration(database);

    expect(() =>
      savePlan(database, {
        id: "plan-1",
        connectionId: "connection-1",
        configurationGenerationId: "generation-1",
        plan: { ...plan, weeklyCapacity: 10.5, lanes: [] },
        now: 100
      })
    ).toThrow();
    expect(database.sqlite.prepare("SELECT COUNT(*) FROM plans").pluck().get()).toBe(0);
  });

  it("rolls back plan and lanes when any lane write fails", async () => {
    const database = await createTestDatabase();
    seedConfiguration(database);
    database.sqlite.exec(`
      CREATE TRIGGER fail_second_capacity_lane
      BEFORE INSERT ON capacity_lanes
      WHEN NEW.position = 1
      BEGIN
        SELECT RAISE(ABORT, 'synthetic lane failure');
      END;
    `);

    expect(() =>
      savePlan(database, {
        id: "plan-1",
        connectionId: "connection-1",
        configurationGenerationId: "generation-1",
        plan,
        now: 100
      })
    ).toThrow(/synthetic lane failure/i);
    expect(database.sqlite.prepare("SELECT COUNT(*) FROM plans").pluck().get()).toBe(0);
    expect(database.sqlite.prepare("SELECT COUNT(*) FROM capacity_lanes").pluck().get()).toBe(0);
  });

  it("rejects duplicate lane names without changing the existing plan", async () => {
    const database = await createTestDatabase();
    seedConfiguration(database);
    savePlan(database, {
      id: "plan-1",
      connectionId: "connection-1",
      configurationGenerationId: "generation-1",
      plan,
      now: 100
    });

    expect(() =>
      savePlan(database, {
        id: "plan-1",
        connectionId: "connection-1",
        configurationGenerationId: "generation-1",
        plan: {
          ...plan,
          name: "Changed name",
          weeklyCapacity: 99,
          lanes: [
            { name: "Duplicate", weeklyAllocation: 1 },
            { name: "Duplicate", weeklyAllocation: 2 }
          ]
        },
        now: 200
      })
    ).toThrow(/lane names.*unique/i);
    expect(getPlan(database, "plan-1")).toMatchObject({
      name: "Platform roadmap",
      weeklyCapacity: 10,
      lanes: [{ name: "Product" }, { name: "Maintenance" }],
      updatedAt: 100
    });
  });

  it("keeps the active configuration unchanged until a scope generation is published", async () => {
    const database = await createTestDatabase();
    seedConfiguration(database);
    savePlan(database, {
      id: "plan-1",
      connectionId: "connection-1",
      configurationGenerationId: "generation-1",
      plan,
      now: 100
    });
    database.sqlite.exec(`
      INSERT INTO sync_generations (id, connection_id, status, created_at)
      VALUES ('generation-2', 'connection-1', 'staging', 200);
      INSERT INTO source_teams (generation_id, linear_id, workspace_id, name)
      VALUES ('generation-2', 'team-2', 'workspace-1', 'Second Synthetic Team');
      INSERT INTO source_labels (generation_id, linear_id, workspace_id, name)
      VALUES ('generation-2', 'label-2', 'workspace-1', 'Second Roadmap');
      INSERT INTO source_statuses (generation_id, linear_id, workspace_id, team_id, name)
      VALUES ('generation-2', 'status-2', 'workspace-1', 'team-2', 'Second Committed');
    `);
    const changedPlan = {
      ...plan,
      teamId: "team-2",
      membershipLabel: { id: "label-2", workspaceId: "workspace-1" },
      commitmentStatus: { id: "status-2", workspaceId: "workspace-1", teamId: "team-2" },
      lanes: [{ name: "Second lane", weeklyAllocation: 10 }]
    };

    expect(() =>
      savePlan(database, {
        id: "plan-1",
        connectionId: "connection-1",
        configurationGenerationId: "generation-2",
        plan: changedPlan,
        now: 200
      })
    ).toThrow(/published configuration generation/i);
    expect(getPlan(database, "plan-1")).toMatchObject({
      teamId: "team-1",
      membershipLabel: { id: "label-1" },
      commitmentStatus: { id: "status-1" },
      currentGenerationId: "generation-1",
      lanes: [{ name: "Product" }, { name: "Maintenance" }]
    });

    database.sqlite.exec(`
      UPDATE sync_generations SET status = 'discarded' WHERE id = 'generation-1';
      UPDATE sync_generations SET status = 'published', promoted_at = 250 WHERE id = 'generation-2';
    `);
    const saved = savePlan(database, {
      id: "plan-1",
      connectionId: "connection-1",
      configurationGenerationId: "generation-2",
      plan: changedPlan,
      now: 300
    });

    expect(saved).toMatchObject({
      teamId: "team-2",
      membershipLabel: { id: "label-2" },
      commitmentStatus: { id: "status-2" },
      currentGenerationId: "generation-2",
      lanes: [{ name: "Second lane", weeklyAllocation: 10, position: 0 }],
      createdAt: 100,
      updatedAt: 300
    });
  });
});
