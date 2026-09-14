import { aggregateIssues } from "../domain/issue-aggregation";
import type { HorizonboundDatabase } from "../db/database";
import { acquireLease, promoteGeneration, releaseLease, renewLease } from "../db/sync-repository";

export interface LinearTeam {
  id: string;
  workspaceId: string;
  name: string;
}

export interface LinearLabel {
  id: string;
  workspaceId: string;
  name: string;
}

export interface LinearStatus {
  id: string;
  workspaceId: string;
  teamId: string | null;
  name: string;
}

export interface LinearProject {
  id: string;
  workspaceId: string;
  name: string;
  url: string;
  statusId: string | null;
  startDate: string | null;
  archived: boolean;
  teamIds: readonly string[];
  labelIds: readonly string[];
}

export interface LinearIssue {
  id: string;
  projectId: string;
  parentId: string | null;
  estimate: number | null;
  state: "open" | "completed" | "canceled";
  archived: boolean;
  updatedAt: string;
}

export interface LinearConfiguration {
  teams: readonly LinearTeam[];
  labels: readonly LinearLabel[];
  statuses: readonly LinearStatus[];
}

export interface LinearPage<T> {
  nodes: readonly T[];
  nextCursor: string | null;
}

export interface LinearSource {
  getConfiguration(): Promise<LinearConfiguration>;
  getProjects(after: string | null): Promise<LinearPage<LinearProject>>;
  getIssues(after: string | null): Promise<LinearPage<LinearIssue>>;
  diagnostics?(): {
    requestCount: number;
    rateLimitRemaining: number | null;
    rateLimitResetAt: string | null;
  };
}

export interface ReconciliationOptions {
  database: HorizonboundDatabase;
  source: LinearSource;
  connectionId: string;
  ownerToken: string;
  generationId: string;
  runId: string;
  trigger: "launch" | "manual" | "scope_change";
  leaseTtlMs: number;
  now?: () => number;
}

export interface ReconciliationResult {
  generationId: string;
  pageCount: number;
  recordCount: number;
}

export class LeaseUnavailableError extends Error {
  constructor() {
    super("Synchronization lease is held by another process");
    this.name = "LeaseUnavailableError";
  }
}

function stageConfiguration(
  database: HorizonboundDatabase,
  generationId: string,
  configuration: LinearConfiguration
): void {
  const insertTeam = database.sqlite.prepare(
    "INSERT INTO source_teams (generation_id, linear_id, workspace_id, name) VALUES (?, ?, ?, ?)"
  );
  const insertLabel = database.sqlite.prepare(
    "INSERT INTO source_labels (generation_id, linear_id, workspace_id, name) VALUES (?, ?, ?, ?)"
  );
  const insertStatus = database.sqlite.prepare(
    "INSERT INTO source_statuses (generation_id, linear_id, workspace_id, team_id, name) VALUES (?, ?, ?, ?, ?)"
  );

  database.sqlite.transaction(() => {
    for (const team of configuration.teams) {
      insertTeam.run(generationId, team.id, team.workspaceId, team.name);
    }
    for (const label of configuration.labels) {
      insertLabel.run(generationId, label.id, label.workspaceId, label.name);
    }
    for (const status of configuration.statuses) {
      insertStatus.run(generationId, status.id, status.workspaceId, status.teamId, status.name);
    }
  })();
}

function stageProjects(
  database: HorizonboundDatabase,
  generationId: string,
  projects: readonly LinearProject[]
): void {
  const insertProject = database.sqlite.prepare(
    `INSERT INTO source_projects
      (generation_id, linear_id, workspace_id, name, url, status_id, start_date, archived)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertTeam = database.sqlite.prepare(
    "INSERT INTO source_project_teams (generation_id, project_linear_id, team_linear_id) VALUES (?, ?, ?)"
  );
  const insertLabel = database.sqlite.prepare(
    "INSERT INTO source_project_labels (generation_id, project_linear_id, label_linear_id) VALUES (?, ?, ?)"
  );

  database.sqlite.transaction(() => {
    for (const project of projects) {
      insertProject.run(
        generationId,
        project.id,
        project.workspaceId,
        project.name,
        project.url,
        project.statusId,
        project.startDate,
        Number(project.archived)
      );
      for (const teamId of project.teamIds) insertTeam.run(generationId, project.id, teamId);
      for (const labelId of project.labelIds) insertLabel.run(generationId, project.id, labelId);
    }
  })();
}

function stageIssues(
  database: HorizonboundDatabase,
  generationId: string,
  issues: readonly LinearIssue[]
): void {
  const insertIssue = database.sqlite.prepare(
    `INSERT INTO source_issues
      (generation_id, linear_id, project_linear_id, parent_linear_id, estimate, state, archived, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  database.sqlite.transaction(() => {
    for (const issue of issues) {
      insertIssue.run(
        generationId,
        issue.id,
        issue.projectId,
        issue.parentId,
        issue.estimate,
        issue.state,
        Number(issue.archived),
        issue.updatedAt
      );
    }
  })();
}

function stageAggregates(
  database: HorizonboundDatabase,
  generationId: string,
  projects: readonly LinearProject[],
  issues: readonly LinearIssue[]
): void {
  const insertAggregate = database.sqlite.prepare(
    `INSERT INTO project_aggregates
      (generation_id, project_linear_id, completed_actual, detailed_open, unestimated_open_count, possible_double_counting)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  database.sqlite.transaction(() => {
    for (const project of projects) {
      const aggregate = aggregateIssues(
        issues
          .filter((issue) => issue.projectId === project.id)
          .map((issue) => ({
            id: issue.id,
            estimate: issue.estimate,
            state: issue.state,
            parentId: issue.parentId,
            archived: issue.archived
          }))
      );
      insertAggregate.run(
        generationId,
        project.id,
        aggregate.completedActual,
        aggregate.detailedOpen,
        aggregate.unestimatedOpenCount,
        Number(aggregate.possibleDoubleCounting)
      );
    }
  })();
}

function sanitizeSyncError(error: unknown): string {
  if (!(error instanceof Error)) return "Required source data could not be synchronized";
  const safePrefixes = [
    "Synchronization lease",
    "Linear project pagination",
    "Linear issue pagination",
    "Linear GraphQL request failed",
    "Linear GraphQL returned",
    "Linear rate limit",
    "Linear authorization failed"
  ];
  return safePrefixes.some((prefix) => error.message.startsWith(prefix))
    ? error.message
    : "Required source data could not be synchronized";
}

export async function fullReconciliation(
  options: ReconciliationOptions
): Promise<ReconciliationResult> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  if (
    !acquireLease(
      options.database,
      options.connectionId,
      options.ownerToken,
      startedAt,
      options.leaseTtlMs
    )
  ) {
    throw new LeaseUnavailableError();
  }

  options.database.sqlite.transaction(() => {
    options.database.sqlite
      .prepare(
        "INSERT INTO sync_generations (id, connection_id, status, created_at) VALUES (?, ?, 'staging', ?)"
      )
      .run(options.generationId, options.connectionId, startedAt);
    options.database.sqlite
      .prepare(
        `INSERT INTO sync_runs
          (id, connection_id, generation_id, trigger, mode, status, started_at, page_count, record_count)
         VALUES (?, ?, ?, ?, 'full', 'running', ?, 0, 0)`
      )
      .run(options.runId, options.connectionId, options.generationId, options.trigger, startedAt);
  })();

  let recordCount = 0;
  let pageCount = 0;
  const renew = () => {
    if (
      !renewLease(
        options.database,
        options.connectionId,
        options.ownerToken,
        now(),
        options.leaseTtlMs
      )
    ) {
      throw new Error("Synchronization lease expired or changed owner during retrieval");
    }
  };

  try {
    const configuration = await options.source.getConfiguration();
    renew();
    stageConfiguration(options.database, options.generationId, configuration);
    recordCount =
      configuration.teams.length + configuration.labels.length + configuration.statuses.length;
    const projects: LinearProject[] = [];
    const issues: LinearIssue[] = [];

    let cursor: string | null = null;
    const projectCursors = new Set<string>();
    do {
      const page = await options.source.getProjects(cursor);
      renew();
      if (
        page.nextCursor !== null &&
        (page.nextCursor === cursor || projectCursors.has(page.nextCursor))
      ) {
        throw new Error("Linear project pagination returned a repeated cursor");
      }
      if (page.nextCursor !== null) projectCursors.add(page.nextCursor);
      stageProjects(options.database, options.generationId, page.nodes);
      projects.push(...page.nodes);
      recordCount += page.nodes.length;
      pageCount += 1;
      cursor = page.nextCursor;
    } while (cursor !== null);

    cursor = null;
    const issueCursors = new Set<string>();
    do {
      const page = await options.source.getIssues(cursor);
      renew();
      if (
        page.nextCursor !== null &&
        (page.nextCursor === cursor || issueCursors.has(page.nextCursor))
      ) {
        throw new Error("Linear issue pagination returned a repeated cursor");
      }
      if (page.nextCursor !== null) issueCursors.add(page.nextCursor);
      stageIssues(options.database, options.generationId, page.nodes);
      issues.push(...page.nodes);
      recordCount += page.nodes.length;
      pageCount += 1;
      cursor = page.nextCursor;
    } while (cursor !== null);

    stageAggregates(options.database, options.generationId, projects, issues);
    const finishedAt = now();
    const diagnostics = options.source.diagnostics?.() ?? {
      requestCount: pageCount,
      rateLimitRemaining: null,
      rateLimitResetAt: null
    };
    options.database.sqlite.transaction(() => {
      promoteGeneration(
        options.database,
        options.connectionId,
        options.ownerToken,
        options.generationId,
        finishedAt
      );
      options.database.sqlite
        .prepare(
          `UPDATE sync_runs
           SET status = 'succeeded', finished_at = ?, page_count = ?, record_count = ?,
               provider_request_count = ?, rate_limit_remaining = ?, rate_limit_reset_at = ?
           WHERE id = ?`
        )
        .run(
          finishedAt,
          pageCount,
          recordCount,
          diagnostics.requestCount,
          diagnostics.rateLimitRemaining,
          diagnostics.rateLimitResetAt,
          options.runId
        );
    })();
    releaseLease(options.database, options.connectionId, options.ownerToken);

    return { generationId: options.generationId, pageCount, recordCount };
  } catch (error) {
    const finishedAt = now();
    const errorClass = error instanceof Error ? error.name : "UnknownError";
    const errorSummary = sanitizeSyncError(error);
    const diagnostics = options.source.diagnostics?.() ?? {
      requestCount: pageCount,
      rateLimitRemaining: null,
      rateLimitResetAt: null
    };
    options.database.sqlite.transaction(() => {
      options.database.sqlite
        .prepare(
          "UPDATE sync_generations SET status = 'discarded' WHERE id = ? AND status = 'staging'"
        )
        .run(options.generationId);
      options.database.sqlite
        .prepare(
          `UPDATE sync_runs
           SET status = 'failed', finished_at = ?, page_count = ?, record_count = ?,
               provider_request_count = ?, rate_limit_remaining = ?, rate_limit_reset_at = ?,
               error_class = ?, error_summary = ?
           WHERE id = ?`
        )
        .run(
          finishedAt,
          pageCount,
          recordCount,
          diagnostics.requestCount,
          diagnostics.rateLimitRemaining,
          diagnostics.rateLimitResetAt,
          errorClass,
          errorSummary,
          options.runId
        );
    })();
    releaseLease(options.database, options.connectionId, options.ownerToken);
    throw error;
  }
}
