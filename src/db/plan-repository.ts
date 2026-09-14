import { randomUUID } from "node:crypto";
import { planInputSchema, type PlanInput } from "@/domain/plan";
import type { HorizonboundDatabase } from "./database";

export interface SavePlanInput {
  id: string;
  connectionId: string;
  configurationGenerationId: string;
  plan: PlanInput;
  now: number;
}

export interface StoredCapacityLane {
  id: string;
  name: string;
  weeklyAllocation: number;
  position: number;
}

export interface StoredPlan extends Omit<PlanInput, "lanes"> {
  id: string;
  connectionId: string;
  currentGenerationId: string;
  lanes: StoredCapacityLane[];
  createdAt: number;
  updatedAt: number;
}

interface PlanRow {
  id: string;
  connectionId: string;
  name: string;
  workspaceId: string;
  teamId: string;
  membershipLabelId: string;
  commitmentStatusId: string;
  commitmentStatusTeamId: string | null;
  horizonWeeks: number;
  weeklyCapacity: number;
  capacityEffectiveDate: string;
  refinementLeadTimeDays: number;
  currentGenerationId: string;
  createdAt: number;
  updatedAt: number;
}

export function savePlan(database: HorizonboundDatabase, input: SavePlanInput): StoredPlan {
  const plan = planInputSchema.parse(input.plan);
  if (new Set(plan.lanes.map((lane) => lane.name)).size !== plan.lanes.length) {
    throw new Error("Capacity lane names must be unique within a plan");
  }

  const save = database.sqlite.transaction(() => {
    const generation = database.sqlite
      .prepare(
        `SELECT id FROM sync_generations
         WHERE id = ? AND connection_id = ? AND status = 'published' AND promoted_at IS NOT NULL`
      )
      .get(input.configurationGenerationId, input.connectionId);
    if (!generation) {
      throw new Error("The specified published configuration generation is unavailable");
    }

    const connection = database.sqlite
      .prepare("SELECT workspace_id AS workspaceId FROM connections WHERE id = ?")
      .get(input.connectionId) as { workspaceId: string } | undefined;
    if (!connection || connection.workspaceId !== plan.workspaceId) {
      throw new Error("Selected workspace does not belong to the connection");
    }

    const team = database.sqlite
      .prepare(
        `SELECT linear_id FROM source_teams
         WHERE generation_id = ? AND linear_id = ? AND workspace_id = ?`
      )
      .get(input.configurationGenerationId, plan.teamId, plan.workspaceId);
    if (!team) {
      throw new Error("Selected team is not in the specified published configuration generation");
    }

    const label = database.sqlite
      .prepare(
        `SELECT linear_id FROM source_labels
         WHERE generation_id = ? AND linear_id = ? AND workspace_id = ?`
      )
      .get(input.configurationGenerationId, plan.membershipLabel.id, plan.workspaceId);
    if (!label) {
      throw new Error(
        "Selected membership label is not in the specified published configuration generation"
      );
    }

    const status = database.sqlite
      .prepare(
        `SELECT team_id AS teamId FROM source_statuses
         WHERE generation_id = ? AND linear_id = ? AND workspace_id = ?`
      )
      .get(input.configurationGenerationId, plan.commitmentStatus.id, plan.workspaceId) as
      { teamId: string | null } | undefined;
    if (!status) {
      throw new Error(
        "Selected commitment status is not in the specified published configuration generation"
      );
    }
    if (status.teamId !== null && status.teamId !== plan.teamId) {
      throw new Error("Selected commitment status is incompatible with the selected team");
    }

    const existingPlan = database.sqlite
      .prepare("SELECT connection_id AS connectionId FROM plans WHERE id = ?")
      .get(input.id) as { connectionId: string } | undefined;
    if (existingPlan && existingPlan.connectionId !== input.connectionId) {
      throw new Error("A plan cannot be moved to another connection");
    }

    const existingLanes = database.sqlite
      .prepare("SELECT id, name FROM capacity_lanes WHERE plan_id = ?")
      .all(input.id) as { id: string; name: string }[];
    const existingLaneIdsByName = new Map(existingLanes.map((lane) => [lane.name, lane.id]));

    database.sqlite
      .prepare(
        `INSERT INTO plans (
          id, connection_id, name, workspace_id, team_id, membership_label_id,
          commitment_status_id, horizon_weeks, weekly_capacity, capacity_effective_date,
          refinement_lead_time_days, current_generation_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          workspace_id = excluded.workspace_id,
          team_id = excluded.team_id,
          membership_label_id = excluded.membership_label_id,
          commitment_status_id = excluded.commitment_status_id,
          horizon_weeks = excluded.horizon_weeks,
          weekly_capacity = excluded.weekly_capacity,
          capacity_effective_date = excluded.capacity_effective_date,
          refinement_lead_time_days = excluded.refinement_lead_time_days,
          current_generation_id = excluded.current_generation_id,
          updated_at = excluded.updated_at`
      )
      .run(
        input.id,
        input.connectionId,
        plan.name,
        plan.workspaceId,
        plan.teamId,
        plan.membershipLabel.id,
        plan.commitmentStatus.id,
        plan.horizonWeeks,
        plan.weeklyCapacity,
        plan.capacityEffectiveDate,
        plan.refinementLeadTimeDays,
        input.configurationGenerationId,
        input.now,
        input.now
      );

    const upsertLane = database.sqlite.prepare(
      `INSERT INTO capacity_lanes (id, plan_id, name, weekly_allocation, position)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         weekly_allocation = excluded.weekly_allocation,
         position = excluded.position`
    );
    const retainedLaneIds = new Set<string>();
    plan.lanes.forEach((lane, position) => {
      const laneId = existingLaneIdsByName.get(lane.name) ?? randomUUID();
      retainedLaneIds.add(laneId);
      upsertLane.run(laneId, input.id, lane.name, lane.weeklyAllocation, position);
    });
    const deleteLane = database.sqlite.prepare(
      "DELETE FROM capacity_lanes WHERE id = ? AND plan_id = ?"
    );
    for (const lane of existingLanes) {
      if (!retainedLaneIds.has(lane.id)) deleteLane.run(lane.id, input.id);
    }
  });

  save();
  const stored = getPlan(database, input.id);
  if (!stored) throw new Error("Saved plan could not be read");
  return stored;
}

export function getPlan(database: HorizonboundDatabase, planId: string): StoredPlan | undefined {
  const row = database.sqlite
    .prepare(
      `SELECT
        plans.id,
        plans.connection_id AS connectionId,
        plans.name,
        plans.workspace_id AS workspaceId,
        plans.team_id AS teamId,
        plans.membership_label_id AS membershipLabelId,
        plans.commitment_status_id AS commitmentStatusId,
        source_statuses.team_id AS commitmentStatusTeamId,
        plans.horizon_weeks AS horizonWeeks,
        plans.weekly_capacity AS weeklyCapacity,
        plans.capacity_effective_date AS capacityEffectiveDate,
        plans.refinement_lead_time_days AS refinementLeadTimeDays,
        plans.current_generation_id AS currentGenerationId,
        plans.created_at AS createdAt,
        plans.updated_at AS updatedAt
       FROM plans
       LEFT JOIN source_statuses
         ON source_statuses.generation_id = plans.current_generation_id
        AND source_statuses.linear_id = plans.commitment_status_id
       WHERE plans.id = ?`
    )
    .get(planId) as PlanRow | undefined;

  if (!row) return undefined;

  const lanes = database.sqlite
    .prepare(
      `SELECT id, name, weekly_allocation AS weeklyAllocation, position
       FROM capacity_lanes WHERE plan_id = ? ORDER BY position ASC`
    )
    .all(planId) as StoredCapacityLane[];

  return {
    id: row.id,
    connectionId: row.connectionId,
    name: row.name,
    workspaceId: row.workspaceId,
    teamId: row.teamId,
    membershipLabel: { id: row.membershipLabelId, workspaceId: row.workspaceId },
    commitmentStatus: {
      id: row.commitmentStatusId,
      workspaceId: row.workspaceId,
      teamId: row.commitmentStatusTeamId
    },
    horizonWeeks: row.horizonWeeks,
    weeklyCapacity: row.weeklyCapacity,
    capacityEffectiveDate: row.capacityEffectiveDate,
    refinementLeadTimeDays: row.refinementLeadTimeDays,
    currentGenerationId: row.currentGenerationId,
    lanes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}
