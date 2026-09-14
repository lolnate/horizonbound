"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { assertSameOrigin } from "@/auth/web-security";
import { saveForecastRevision } from "@/db/forecast-repository";
import { getPlan, savePlan } from "@/db/plan-repository";
import { loadRuntimeConfig } from "@/config/runtime";
import { parseForecastForm, parsePlanForm } from "@/server/form-input";
import { refreshConnection } from "@/server/refresh";
import { requireSession } from "@/server/session";
import { getDatabase } from "@/server/services";

async function requireSameOrigin() {
  const requestHeaders = await headers();
  const origin = requestHeaders.get("origin");
  if (!origin) throw new Error("Request origin is required");
  assertSameOrigin(origin, loadRuntimeConfig(process.env).appBaseUrl);
}

export async function savePlanAction(formData: FormData) {
  await requireSameOrigin();
  const session = await requireSession();
  const values = parsePlanForm(formData);
  const database = getDatabase();
  const generation = database.sqlite
    .prepare(
      `SELECT id FROM sync_generations
       WHERE connection_id = ? AND status = 'published'
       ORDER BY promoted_at DESC LIMIT 1`
    )
    .get(session.connectionId) as { id: string } | undefined;
  if (!generation) throw new Error("Source configuration has not been synchronized");
  const status = database.sqlite
    .prepare(
      `SELECT team_id AS teamId FROM source_statuses
       WHERE generation_id = ? AND linear_id = ? AND workspace_id = ?`
    )
    .get(generation.id, values.commitmentStatusId, session.workspaceId) as
    { teamId: string | null } | undefined;
  if (!status) throw new Error("Selected commitment status is unavailable");

  const existing = database.sqlite
    .prepare("SELECT id FROM plans WHERE connection_id = ? ORDER BY created_at LIMIT 1")
    .get(session.connectionId) as { id: string } | undefined;
  const planId = existing?.id ?? randomUUID();
  savePlan(database, {
    id: planId,
    connectionId: session.connectionId,
    configurationGenerationId: generation.id,
    now: Date.now(),
    plan: {
      name: values.name,
      workspaceId: session.workspaceId,
      teamId: values.teamId,
      membershipLabel: { id: values.membershipLabelId, workspaceId: session.workspaceId },
      commitmentStatus: {
        id: values.commitmentStatusId,
        workspaceId: session.workspaceId,
        teamId: status.teamId
      },
      horizonWeeks: values.horizonWeeks,
      weeklyCapacity: values.weeklyCapacity,
      capacityEffectiveDate: values.capacityEffectiveDate,
      refinementLeadTimeDays: values.refinementLeadTimeDays,
      lanes: values.lanes
    }
  });
  await refreshConnection(session.connectionId, planId, "scope_change");
  revalidatePath("/");
}

export async function refreshPlanAction(formData: FormData) {
  await requireSameOrigin();
  const session = await requireSession();
  const planId = String(formData.get("planId") ?? "");
  const plan = getPlan(getDatabase(), planId);
  if (!plan || plan.connectionId !== session.connectionId) throw new Error("Plan is unavailable");
  await refreshConnection(session.connectionId, planId, "manual");
  revalidatePath("/");
}

export async function saveForecastAction(formData: FormData) {
  await requireSameOrigin();
  const session = await requireSession();
  const values = parseForecastForm(formData);
  const database = getDatabase();
  const plan = database.sqlite
    .prepare(
      "SELECT id, current_generation_id AS generationId FROM plans WHERE connection_id = ? LIMIT 1"
    )
    .get(session.connectionId) as { id: string; generationId: string | null } | undefined;
  if (!plan?.generationId) throw new Error("Plan source data is unavailable");

  const aggregate = database.sqlite
    .prepare(
      `SELECT a.completed_actual AS completedActual, a.detailed_open AS detailedOpen
       FROM project_aggregates a
       JOIN source_projects p ON p.generation_id = a.generation_id AND p.linear_id = a.project_linear_id
       WHERE a.generation_id = ? AND a.project_linear_id = ?
         AND EXISTS (
           SELECT 1 FROM source_project_teams pt
           WHERE pt.generation_id = p.generation_id AND pt.project_linear_id = p.linear_id
             AND pt.team_linear_id = (SELECT team_id FROM plans WHERE id = ?)
         )
         AND EXISTS (
           SELECT 1 FROM source_project_labels pl
           WHERE pl.generation_id = p.generation_id AND pl.project_linear_id = p.linear_id
             AND pl.label_linear_id = (SELECT membership_label_id FROM plans WHERE id = ?)
         )`
    )
    .get(plan.generationId, values.projectId, plan.id, plan.id) as
    { completedActual: number; detailedOpen: number } | undefined;
  if (!aggregate) throw new Error("Project is not part of the current plan");

  const lane = database.sqlite
    .prepare("SELECT id FROM capacity_lanes WHERE id = ? AND plan_id = ?")
    .get(values.capacityLaneId, plan.id);
  if (!lane) throw new Error("Capacity lane is unavailable");

  const existing = database.sqlite
    .prepare("SELECT id FROM forecasts WHERE plan_id = ? AND project_linear_id = ?")
    .get(plan.id, values.projectId) as { id: string } | undefined;
  saveForecastRevision(database, {
    id: existing?.id ?? randomUUID(),
    revisionId: randomUUID(),
    connectionId: session.connectionId,
    expectedGenerationId: plan.generationId,
    planId: plan.id,
    projectLinearId: values.projectId,
    unrefinedLow: values.unrefinedLow,
    unrefinedExpected: values.unrefinedExpected,
    unrefinedHigh: values.unrefinedHigh,
    confidence: values.confidence,
    estimateBasis: values.estimateBasis,
    forecastAsOfDate: values.forecastAsOfDate,
    capacityLaneId: values.capacityLaneId,
    horizonShare: values.horizonSharePercent,
    category: values.category,
    reason: values.reason,
    actor: session.linearUserId,
    createdAt: Date.now(),
    completedActual: aggregate.completedActual,
    detailedOpen: aggregate.detailedOpen
  });
  revalidatePath("/");
}
