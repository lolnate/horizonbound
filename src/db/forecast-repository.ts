import { calculateForecast, forecastInputSchema } from "@/domain/forecast";
import type { HorizonboundDatabase } from "./database";

export interface SaveForecastRevisionInput {
  id: string;
  revisionId: string;
  connectionId: string;
  expectedGenerationId: string;
  planId: string;
  projectLinearId: string;
  unrefinedLow: number;
  unrefinedExpected: number;
  unrefinedHigh: number;
  confidence: string;
  estimateBasis: string;
  forecastAsOfDate: string;
  capacityLaneId: string | null;
  horizonShare: number;
  category: string;
  reason: string;
  actor: string;
  createdAt: number;
  completedActual: number;
  detailedOpen: number;
}

export function saveForecastRevision(
  database: HorizonboundDatabase,
  input: SaveForecastRevisionInput
) {
  const parsed = forecastInputSchema.parse(input);
  if (
    !input.confidence.trim() ||
    !input.estimateBasis.trim() ||
    !input.category.trim() ||
    !input.reason.trim()
  ) {
    throw new Error("Confidence, estimate basis, revision category, and reason are required");
  }

  const calculation = calculateForecast({
    ...parsed,
    completedActual: input.completedActual,
    detailedOpen: input.detailedOpen
  });
  if (!calculation) throw new Error("Forecast cannot be calculated from unknown source aggregates");

  const save = database.sqlite.transaction(() => {
    const plan = database.sqlite
      .prepare(
        `SELECT connection_id AS connectionId, current_generation_id AS generationId,
                team_id AS teamId, membership_label_id AS membershipLabelId
         FROM plans WHERE id = ?`
      )
      .get(input.planId) as
      | {
          connectionId: string;
          generationId: string | null;
          teamId: string;
          membershipLabelId: string;
        }
      | undefined;
    if (!plan || plan.connectionId !== input.connectionId) {
      throw new Error("Forecast plan does not belong to the active connection");
    }
    if (plan.generationId !== input.expectedGenerationId) {
      throw new Error(
        "Source generation changed before the forecast could be saved; review and retry"
      );
    }
    if (input.capacityLaneId) {
      const lane = database.sqlite
        .prepare("SELECT id FROM capacity_lanes WHERE id = ? AND plan_id = ?")
        .get(input.capacityLaneId, input.planId);
      if (!lane) throw new Error("Forecast capacity lane does not belong to the plan");
    }
    const aggregate = database.sqlite
      .prepare(
        `SELECT a.completed_actual AS completedActual, a.detailed_open AS detailedOpen
         FROM project_aggregates a
         JOIN source_projects p
           ON p.generation_id = a.generation_id AND p.linear_id = a.project_linear_id
         WHERE a.generation_id = ? AND a.project_linear_id = ? AND p.archived = 0
           AND EXISTS (
             SELECT 1 FROM source_project_teams pt
             WHERE pt.generation_id = p.generation_id AND pt.project_linear_id = p.linear_id
               AND pt.team_linear_id = ?
           )
           AND EXISTS (
             SELECT 1 FROM source_project_labels pl
             WHERE pl.generation_id = p.generation_id AND pl.project_linear_id = p.linear_id
               AND pl.label_linear_id = ?
           )`
      )
      .get(
        input.expectedGenerationId,
        input.projectLinearId,
        plan.teamId,
        plan.membershipLabelId
      ) as { completedActual: number; detailedOpen: number } | undefined;
    if (!aggregate)
      throw new Error("Forecast project is not in the current plan source generation");
    if (
      aggregate.completedActual !== input.completedActual ||
      aggregate.detailedOpen !== input.detailedOpen
    ) {
      throw new Error(
        "Source aggregates changed before the forecast could be saved; review and retry"
      );
    }
    const existingForecast = database.sqlite
      .prepare("SELECT id FROM forecasts WHERE plan_id = ? AND project_linear_id = ?")
      .get(input.planId, input.projectLinearId) as { id: string } | undefined;
    if (existingForecast && existingForecast.id !== input.id) {
      throw new Error("Forecast identity changed before the revision could be appended");
    }

    database.sqlite
      .prepare(
        `INSERT INTO forecasts (
          id, plan_id, project_linear_id, unrefined_low, unrefined_expected, unrefined_high,
          confidence, estimate_basis, forecast_as_of_date, capacity_lane_id, horizon_share,
          latest_revision_id, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(plan_id, project_linear_id) DO UPDATE SET
          unrefined_low = excluded.unrefined_low,
          unrefined_expected = excluded.unrefined_expected,
          unrefined_high = excluded.unrefined_high,
          confidence = excluded.confidence,
          estimate_basis = excluded.estimate_basis,
          forecast_as_of_date = excluded.forecast_as_of_date,
          capacity_lane_id = excluded.capacity_lane_id,
          horizon_share = excluded.horizon_share,
          latest_revision_id = excluded.latest_revision_id,
          updated_at = excluded.updated_at`
      )
      .run(
        input.id,
        input.planId,
        input.projectLinearId,
        input.unrefinedLow,
        input.unrefinedExpected,
        input.unrefinedHigh,
        input.confidence,
        input.estimateBasis,
        input.forecastAsOfDate,
        input.capacityLaneId,
        input.horizonShare,
        input.revisionId,
        input.createdAt
      );

    database.sqlite
      .prepare(
        `INSERT INTO forecast_revisions (
          id, forecast_id, actor, category, reason, created_at,
          unrefined_low, unrefined_expected, unrefined_high,
          completed_actual, detailed_open,
          baseline_lifetime_low, baseline_lifetime_expected, baseline_lifetime_high
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.revisionId,
        input.id,
        input.actor,
        input.category,
        input.reason.trim(),
        input.createdAt,
        input.unrefinedLow,
        input.unrefinedExpected,
        input.unrefinedHigh,
        input.completedActual,
        input.detailedOpen,
        calculation.lifetime.low,
        calculation.lifetime.expected,
        calculation.lifetime.high
      );

    return { baselineLifetimeHigh: calculation.lifetime.high };
  });

  return save();
}

export function getCurrentForecast(
  database: HorizonboundDatabase,
  planId: string,
  projectLinearId: string
) {
  return database.sqlite
    .prepare(
      `SELECT
        id,
        plan_id AS planId,
        project_linear_id AS projectLinearId,
        unrefined_low AS unrefinedLow,
        unrefined_expected AS unrefinedExpected,
        unrefined_high AS unrefinedHigh,
        confidence,
        estimate_basis AS estimateBasis,
        forecast_as_of_date AS forecastAsOfDate,
        capacity_lane_id AS capacityLaneId,
        horizon_share AS horizonShare,
        latest_revision_id AS latestRevisionId,
        updated_at AS updatedAt
       FROM forecasts WHERE plan_id = ? AND project_linear_id = ?`
    )
    .get(planId, projectLinearId);
}
