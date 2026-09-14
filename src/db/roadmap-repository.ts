import { calculateForecast, forecastIntegrityWarning, refinementStatus } from "@/domain/forecast";
import type { HorizonboundDatabase } from "./database";

interface RoadmapRow {
  planName: string;
  workspaceName: string;
  generationId: string;
  promotedAt: number;
  refinementLeadTimeDays: number;
  projectId: string;
  projectName: string;
  url: string;
  statusName: string | null;
  startDate: string | null;
  completedActual: number;
  detailedOpen: number;
  unestimatedOpenCount: number;
  possibleDoubleCounting: number;
  forecastId: string | null;
  unrefinedLow: number | null;
  unrefinedExpected: number | null;
  unrefinedHigh: number | null;
  confidence: string | null;
  estimateBasis: string | null;
  forecastAsOfDate: string | null;
  capacityLaneId: string | null;
  horizonShare: number | null;
  latestRevisionId: string | null;
  baselineLifetimeHigh: number | null;
}

export function getRoadmap(database: HorizonboundDatabase, planId: string, now = new Date()) {
  const rows = database.sqlite
    .prepare(
      `SELECT
         p.name AS planName, c.workspace_name AS workspaceName,
         g.id AS generationId, g.promoted_at AS promotedAt,
         p.refinement_lead_time_days AS refinementLeadTimeDays,
         sp.linear_id AS projectId, sp.name AS projectName, sp.url, ss.name AS statusName,
         sp.start_date AS startDate,
         pa.completed_actual AS completedActual, pa.detailed_open AS detailedOpen,
         pa.unestimated_open_count AS unestimatedOpenCount,
         pa.possible_double_counting AS possibleDoubleCounting,
         f.id AS forecastId, f.unrefined_low AS unrefinedLow,
         f.unrefined_expected AS unrefinedExpected, f.unrefined_high AS unrefinedHigh,
         f.confidence, f.estimate_basis AS estimateBasis,
         f.forecast_as_of_date AS forecastAsOfDate, f.capacity_lane_id AS capacityLaneId,
         f.horizon_share AS horizonShare, f.latest_revision_id AS latestRevisionId,
         fr.baseline_lifetime_high AS baselineLifetimeHigh
       FROM plans p
       JOIN connections c ON c.id = p.connection_id
       JOIN sync_generations g ON g.id = p.current_generation_id AND g.status = 'published'
       JOIN source_projects sp ON sp.generation_id = g.id AND sp.workspace_id = p.workspace_id
       JOIN project_aggregates pa ON pa.generation_id = g.id AND pa.project_linear_id = sp.linear_id
       LEFT JOIN source_statuses ss ON ss.generation_id = g.id AND ss.linear_id = sp.status_id
       LEFT JOIN forecasts f ON f.plan_id = p.id AND f.project_linear_id = sp.linear_id
       LEFT JOIN forecast_revisions fr ON fr.id = f.latest_revision_id
       WHERE p.id = ?
         AND sp.archived = 0
         AND EXISTS (
           SELECT 1 FROM source_project_teams pt
           WHERE pt.generation_id = g.id AND pt.project_linear_id = sp.linear_id
             AND pt.team_linear_id = p.team_id
         )
         AND EXISTS (
           SELECT 1 FROM source_project_labels pl
           WHERE pl.generation_id = g.id AND pl.project_linear_id = sp.linear_id
             AND pl.label_linear_id = p.membership_label_id
         )
       ORDER BY sp.name COLLATE NOCASE, sp.linear_id`
    )
    .all(planId) as RoadmapRow[];

  if (rows.length === 0) {
    const plan = database.sqlite
      .prepare(
        `SELECT p.name AS planName, c.workspace_name AS workspaceName,
                g.id AS generationId, g.promoted_at AS promotedAt,
                p.refinement_lead_time_days AS refinementLeadTimeDays
         FROM plans p JOIN connections c ON c.id = p.connection_id
         LEFT JOIN sync_generations g ON g.id = p.current_generation_id
         WHERE p.id = ?`
      )
      .get(planId) as
      | {
          planName: string;
          workspaceName: string;
          generationId: string | null;
          promotedAt: number | null;
          refinementLeadTimeDays: number;
        }
      | undefined;
    if (!plan) return null;
    return {
      id: planId,
      name: plan.planName,
      workspaceName: plan.workspaceName,
      generationId: plan.generationId,
      lastSuccessfulSyncAt: plan.promotedAt,
      latestAttempt: getLatestAttempt(database, planId),
      projects: []
    };
  }

  const first = rows[0]!;
  return {
    id: planId,
    name: first.planName,
    workspaceName: first.workspaceName,
    generationId: first.generationId,
    lastSuccessfulSyncAt: first.promotedAt,
    latestAttempt: getLatestAttempt(database, planId),
    projects: rows.map((row) => {
      const range =
        row.unrefinedLow !== null &&
        row.unrefinedExpected !== null &&
        row.unrefinedHigh !== null &&
        row.horizonShare !== null
          ? {
              unrefinedLow: row.unrefinedLow,
              unrefinedExpected: row.unrefinedExpected,
              unrefinedHigh: row.unrefinedHigh,
              horizonShare: row.horizonShare
            }
          : null;
      const calculation = range
        ? calculateForecast({
            ...range,
            completedActual: row.completedActual,
            detailedOpen: row.detailedOpen
          })
        : null;

      return {
        id: row.projectId,
        name: row.projectName,
        url: row.url,
        statusName: row.statusName,
        startDate: row.startDate,
        completedActual: row.completedActual,
        detailedOpen: row.detailedOpen,
        unestimatedOpenCount: row.unestimatedOpenCount,
        possibleDoubleCounting: Boolean(row.possibleDoubleCounting),
        forecast:
          row.forecastId && range && calculation
            ? {
                id: row.forecastId,
                ...range,
                confidence: row.confidence!,
                estimateBasis: row.estimateBasis!,
                forecastAsOfDate: row.forecastAsOfDate!,
                capacityLaneId: row.capacityLaneId,
                latestRevisionId: row.latestRevisionId!,
                ...calculation,
                integrityWarning: forecastIntegrityWarning(
                  row.completedActual,
                  row.detailedOpen,
                  row.baselineLifetimeHigh
                ),
                refinement: refinementStatus(
                  row.startDate,
                  first.refinementLeadTimeDays,
                  range,
                  now
                ),
                revisions: getRevisions(database, row.forecastId)
              }
            : null
      };
    })
  };
}

interface LatestAttempt {
  status: string;
  startedAt: number;
  finishedAt: number | null;
  pageCount: number;
  recordCount: number;
  errorClass: string | null;
  errorSummary: string | null;
}

interface RevisionView {
  id: string;
  actor: string;
  category: string;
  reason: string;
  createdAt: number;
  completedActual: number;
  detailedOpen: number;
  baselineLifetimeLow: number;
  baselineLifetimeExpected: number;
  baselineLifetimeHigh: number;
}

function getLatestAttempt(database: HorizonboundDatabase, planId: string): LatestAttempt | null {
  const attempt = database.sqlite
    .prepare(
      `SELECT sr.status, sr.started_at AS startedAt, sr.finished_at AS finishedAt,
              sr.page_count AS pageCount, sr.record_count AS recordCount,
              sr.error_class AS errorClass, sr.error_summary AS errorSummary
       FROM sync_runs sr JOIN plans p ON p.connection_id = sr.connection_id
       WHERE p.id = ? ORDER BY sr.started_at DESC LIMIT 1`
    )
    .get(planId) as LatestAttempt | undefined;
  return attempt ?? null;
}

function getRevisions(database: HorizonboundDatabase, forecastId: string): RevisionView[] {
  return database.sqlite
    .prepare(
      `SELECT id, actor, category, reason, created_at AS createdAt,
              completed_actual AS completedActual, detailed_open AS detailedOpen,
              baseline_lifetime_low AS baselineLifetimeLow,
              baseline_lifetime_expected AS baselineLifetimeExpected,
              baseline_lifetime_high AS baselineLifetimeHigh
       FROM forecast_revisions WHERE forecast_id = ? ORDER BY created_at DESC, id DESC`
    )
    .all(forecastId) as RevisionView[];
}
