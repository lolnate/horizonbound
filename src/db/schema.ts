import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex
} from "drizzle-orm/sqlite-core";

export const connections = sqliteTable(
  "connections",
  {
    id: text("id").primaryKey(),
    linearUserId: text("linear_user_id").notNull(),
    linearUserName: text("linear_user_name").notNull().default(""),
    workspaceId: text("workspace_id").notNull(),
    workspaceName: text("workspace_name").notNull(),
    accessTokenCiphertext: text("access_token_ciphertext").notNull(),
    refreshTokenCiphertext: text("refresh_token_ciphertext").notNull(),
    expiresAt: integer("expires_at").notNull(),
    grantedScope: text("granted_scope").notNull(),
    reconnectRequired: integer("reconnect_required", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [uniqueIndex("connections_workspace_unique").on(table.workspaceId)]
);

export const appSessions = sqliteTable("app_sessions", {
  idHash: text("id_hash").primaryKey(),
  connectionId: text("connection_id").references(() => connections.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull()
});

export const oauthStates = sqliteTable("oauth_states", {
  correlationHash: text("correlation_hash").primaryKey(),
  stateHash: text("state_hash").notNull().unique(),
  verifierCiphertext: text("verifier_ciphertext").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  expiresAt: integer("expires_at").notNull(),
  consumedAt: integer("consumed_at")
});

export const plans = sqliteTable(
  "plans",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    workspaceId: text("workspace_id").notNull(),
    teamId: text("team_id").notNull(),
    membershipLabelId: text("membership_label_id").notNull(),
    commitmentStatusId: text("commitment_status_id").notNull(),
    horizonWeeks: integer("horizon_weeks").notNull(),
    weeklyCapacity: integer("weekly_capacity").notNull(),
    capacityEffectiveDate: text("capacity_effective_date").notNull(),
    refinementLeadTimeDays: integer("refinement_lead_time_days").notNull(),
    currentGenerationId: text("current_generation_id"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    uniqueIndex("plans_connection_name_unique").on(table.connectionId, table.name),
    check("plans_horizon_positive", sql`${table.horizonWeeks} > 0`),
    check("plans_capacity_nonnegative", sql`${table.weeklyCapacity} >= 0`),
    check("plans_lead_time_nonnegative", sql`${table.refinementLeadTimeDays} >= 0`)
  ]
);

export const capacityLanes = sqliteTable(
  "capacity_lanes",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    weeklyAllocation: integer("weekly_allocation").notNull(),
    position: integer("position").notNull()
  },
  (table) => [
    uniqueIndex("capacity_lanes_plan_name_unique").on(table.planId, table.name),
    check("capacity_lanes_allocation_nonnegative", sql`${table.weeklyAllocation} >= 0`)
  ]
);

export const syncGenerations = sqliteTable(
  "sync_generations",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["staging", "published", "discarded"] }).notNull(),
    createdAt: integer("created_at").notNull(),
    promotedAt: integer("promoted_at")
  },
  (table) => [index("sync_generations_connection_status_idx").on(table.connectionId, table.status)]
);

export const syncRuns = sqliteTable("sync_runs", {
  id: text("id").primaryKey(),
  connectionId: text("connection_id")
    .notNull()
    .references(() => connections.id, { onDelete: "cascade" }),
  generationId: text("generation_id").references(() => syncGenerations.id, {
    onDelete: "set null"
  }),
  trigger: text("trigger", { enum: ["launch", "manual", "scope_change"] }).notNull(),
  mode: text("mode", { enum: ["full"] })
    .notNull()
    .default("full"),
  status: text("status", { enum: ["running", "succeeded", "failed", "interrupted"] }).notNull(),
  startedAt: integer("started_at").notNull(),
  finishedAt: integer("finished_at"),
  pageCount: integer("page_count").notNull().default(0),
  recordCount: integer("record_count").notNull().default(0),
  providerRequestCount: integer("provider_request_count").notNull().default(0),
  rateLimitRemaining: integer("rate_limit_remaining"),
  rateLimitResetAt: text("rate_limit_reset_at"),
  errorClass: text("error_class"),
  errorSummary: text("error_summary")
});

export const syncLeases = sqliteTable("sync_leases", {
  connectionId: text("connection_id")
    .primaryKey()
    .references(() => connections.id, { onDelete: "cascade" }),
  ownerToken: text("owner_token").notNull(),
  expiresAt: integer("expires_at").notNull(),
  renewedAt: integer("renewed_at").notNull()
});

export const sourceTeams = sqliteTable(
  "source_teams",
  {
    generationId: text("generation_id")
      .notNull()
      .references(() => syncGenerations.id, { onDelete: "cascade" }),
    linearId: text("linear_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull()
  },
  (table) => [primaryKey({ columns: [table.generationId, table.linearId] })]
);

export const sourceLabels = sqliteTable(
  "source_labels",
  {
    generationId: text("generation_id")
      .notNull()
      .references(() => syncGenerations.id, { onDelete: "cascade" }),
    linearId: text("linear_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull()
  },
  (table) => [primaryKey({ columns: [table.generationId, table.linearId] })]
);

export const sourceStatuses = sqliteTable(
  "source_statuses",
  {
    generationId: text("generation_id")
      .notNull()
      .references(() => syncGenerations.id, { onDelete: "cascade" }),
    linearId: text("linear_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    teamId: text("team_id"),
    name: text("name").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.generationId, table.linearId] }),
    foreignKey({
      columns: [table.generationId, table.teamId],
      foreignColumns: [sourceTeams.generationId, sourceTeams.linearId]
    }).onDelete("cascade")
  ]
);

export const sourceProjects = sqliteTable(
  "source_projects",
  {
    generationId: text("generation_id")
      .notNull()
      .references(() => syncGenerations.id, { onDelete: "cascade" }),
    linearId: text("linear_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    statusId: text("status_id"),
    startDate: text("start_date"),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false)
  },
  (table) => [
    primaryKey({ columns: [table.generationId, table.linearId] }),
    foreignKey({
      columns: [table.generationId, table.statusId],
      foreignColumns: [sourceStatuses.generationId, sourceStatuses.linearId]
    })
  ]
);

export const sourceProjectTeams = sqliteTable(
  "source_project_teams",
  {
    generationId: text("generation_id").notNull(),
    projectLinearId: text("project_linear_id").notNull(),
    teamLinearId: text("team_linear_id").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.generationId, table.projectLinearId, table.teamLinearId] }),
    foreignKey({
      columns: [table.generationId, table.projectLinearId],
      foreignColumns: [sourceProjects.generationId, sourceProjects.linearId]
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.generationId, table.teamLinearId],
      foreignColumns: [sourceTeams.generationId, sourceTeams.linearId]
    }).onDelete("cascade")
  ]
);

export const sourceProjectLabels = sqliteTable(
  "source_project_labels",
  {
    generationId: text("generation_id").notNull(),
    projectLinearId: text("project_linear_id").notNull(),
    labelLinearId: text("label_linear_id").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.generationId, table.projectLinearId, table.labelLinearId] }),
    foreignKey({
      columns: [table.generationId, table.projectLinearId],
      foreignColumns: [sourceProjects.generationId, sourceProjects.linearId]
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.generationId, table.labelLinearId],
      foreignColumns: [sourceLabels.generationId, sourceLabels.linearId]
    }).onDelete("cascade")
  ]
);

export const sourceIssues = sqliteTable(
  "source_issues",
  {
    generationId: text("generation_id")
      .notNull()
      .references(() => syncGenerations.id, { onDelete: "cascade" }),
    linearId: text("linear_id").notNull(),
    projectLinearId: text("project_linear_id").notNull(),
    parentLinearId: text("parent_linear_id"),
    estimate: integer("estimate"),
    state: text("state", { enum: ["open", "completed", "canceled"] }).notNull(),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.generationId, table.linearId] }),
    foreignKey({
      columns: [table.generationId, table.projectLinearId],
      foreignColumns: [sourceProjects.generationId, sourceProjects.linearId]
    }).onDelete("cascade"),
    index("source_issues_generation_project_idx").on(table.generationId, table.projectLinearId),
    check(
      "source_issues_estimate_nonnegative",
      sql`${table.estimate} IS NULL OR ${table.estimate} >= 0`
    )
  ]
);

export const projectAggregates = sqliteTable(
  "project_aggregates",
  {
    generationId: text("generation_id")
      .notNull()
      .references(() => syncGenerations.id, { onDelete: "cascade" }),
    projectLinearId: text("project_linear_id").notNull(),
    completedActual: integer("completed_actual").notNull(),
    detailedOpen: integer("detailed_open").notNull(),
    unestimatedOpenCount: integer("unestimated_open_count").notNull(),
    possibleDoubleCounting: integer("possible_double_counting", { mode: "boolean" }).notNull()
  },
  (table) => [
    primaryKey({ columns: [table.generationId, table.projectLinearId] }),
    foreignKey({
      columns: [table.generationId, table.projectLinearId],
      foreignColumns: [sourceProjects.generationId, sourceProjects.linearId]
    }).onDelete("cascade")
  ]
);

export const forecasts = sqliteTable(
  "forecasts",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    projectLinearId: text("project_linear_id").notNull(),
    unrefinedLow: integer("unrefined_low").notNull(),
    unrefinedExpected: integer("unrefined_expected").notNull(),
    unrefinedHigh: integer("unrefined_high").notNull(),
    confidence: text("confidence").notNull(),
    estimateBasis: text("estimate_basis").notNull(),
    forecastAsOfDate: text("forecast_as_of_date").notNull(),
    capacityLaneId: text("capacity_lane_id").references(() => capacityLanes.id, {
      onDelete: "set null"
    }),
    horizonShare: integer("horizon_share").notNull(),
    latestRevisionId: text("latest_revision_id").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    uniqueIndex("forecasts_plan_project_unique").on(table.planId, table.projectLinearId),
    check("forecasts_low_nonnegative", sql`${table.unrefinedLow} >= 0`),
    check(
      "forecasts_range_order",
      sql`${table.unrefinedLow} <= ${table.unrefinedExpected} AND ${table.unrefinedExpected} <= ${table.unrefinedHigh}`
    ),
    check("forecasts_horizon_share", sql`${table.horizonShare} BETWEEN 0 AND 100`)
  ]
);

export const forecastRevisions = sqliteTable("forecast_revisions", {
  id: text("id").primaryKey(),
  forecastId: text("forecast_id")
    .notNull()
    .references(() => forecasts.id, { onDelete: "cascade" }),
  actor: text("actor").notNull(),
  category: text("category").notNull(),
  reason: text("reason").notNull(),
  createdAt: integer("created_at").notNull(),
  unrefinedLow: integer("unrefined_low").notNull(),
  unrefinedExpected: integer("unrefined_expected").notNull(),
  unrefinedHigh: integer("unrefined_high").notNull(),
  completedActual: integer("completed_actual").notNull(),
  detailedOpen: integer("detailed_open").notNull(),
  baselineLifetimeLow: integer("baseline_lifetime_low").notNull(),
  baselineLifetimeExpected: integer("baseline_lifetime_expected").notNull(),
  baselineLifetimeHigh: integer("baseline_lifetime_high").notNull()
});
