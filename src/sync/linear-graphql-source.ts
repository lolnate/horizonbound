import { z } from "zod";
import type {
  LinearConfiguration,
  LinearIssue,
  LinearPage,
  LinearProject,
  LinearSource
} from "./full-reconciliation";

const pageInfoSchema = z.object({
  hasNextPage: z.boolean(),
  endCursor: z.string().nullable()
});

const projectNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  startDate: z.string().nullable(),
  archivedAt: z.string().nullable(),
  status: z.object({ id: z.string() }).nullable(),
  teams: z.object({ nodes: z.array(z.object({ id: z.string() })), pageInfo: pageInfoSchema }),
  labels: z.object({ nodes: z.array(z.object({ id: z.string() })), pageInfo: pageInfoSchema })
});
const projectPageSchema = z.object({
  projects: z.object({ nodes: z.array(projectNodeSchema), pageInfo: pageInfoSchema })
});

const issueNodeSchema = z.object({
  id: z.string(),
  estimate: z.number().nullable(),
  archivedAt: z.string().nullable(),
  updatedAt: z.string(),
  parent: z.object({ id: z.string() }).nullable(),
  project: z.object({ id: z.string() }).nullable(),
  state: z.object({ type: z.string() })
});
const issuePageSchema = z.object({
  issues: z.object({ nodes: z.array(issueNodeSchema), pageInfo: pageInfoSchema })
});

const teamsPageSchema = z.object({
  teams: z.object({
    nodes: z.array(z.object({ id: z.string(), name: z.string() })),
    pageInfo: pageInfoSchema
  })
});
const labelsPageSchema = z.object({
  projectLabels: z.object({
    nodes: z.array(z.object({ id: z.string(), name: z.string() })),
    pageInfo: pageInfoSchema
  })
});
const statusesPageSchema = z.object({
  projectStatuses: z.object({
    nodes: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        team: z.object({ id: z.string() }).nullable().optional()
      })
    ),
    pageInfo: pageInfoSchema
  })
});

interface SourceScope {
  workspaceId: string;
  teamId: string | null;
  membershipLabelId: string | null;
}

const PROJECTS_QUERY = `query HorizonboundProjects($first: Int!, $after: String, $teamId: ID!, $labelId: ID!) {
  projects(first: $first, after: $after, includeArchived: true, filter: { accessibleTeams: { id: { eq: $teamId } }, labels: { id: { eq: $labelId } } }) {
    nodes { id name url startDate archivedAt status { id } teams(first: 250) { nodes { id } pageInfo { hasNextPage endCursor } } labels(first: 250) { nodes { id } pageInfo { hasNextPage endCursor } } }
    pageInfo { hasNextPage endCursor }
  }
}`;

const ISSUES_QUERY = `query HorizonboundIssues($first: Int!, $after: String, $projectIds: [ID!]!) {
  issues(first: $first, after: $after, includeArchived: true, filter: { project: { id: { in: $projectIds } } }) {
    nodes { id estimate archivedAt updatedAt parent { id } project { id } state { type } }
    pageInfo { hasNextPage endCursor }
  }
}`;

interface LinearGraphqlSourceOptions {
  sleep?: (milliseconds: number) => Promise<void>;
  maxAttempts?: number;
}

export class LinearGraphqlSource implements LinearSource {
  private readonly projectIds = new Set<string>();
  private requestCount = 0;
  private rateLimitRemaining: number | null = null;
  private rateLimitResetAt: string | null = null;

  constructor(
    private readonly accessToken: string,
    private readonly scope: SourceScope,
    private readonly fetcher: typeof fetch = fetch,
    private readonly options: LinearGraphqlSourceOptions = {}
  ) {}

  diagnostics() {
    return {
      requestCount: this.requestCount,
      rateLimitRemaining: this.rateLimitRemaining,
      rateLimitResetAt: this.rateLimitResetAt
    };
  }

  async getConfiguration(): Promise<LinearConfiguration> {
    const [teams, labels, statuses] = await Promise.all([
      this.collectConfiguration<{ id: string; name: string }>(
        "teams",
        `query HorizonboundTeams($first: Int!, $after: String) { teams(first: $first, after: $after, includeArchived: true) { nodes { id name } pageInfo { hasNextPage endCursor } } }`,
        teamsPageSchema
      ),
      this.collectConfiguration<{ id: string; name: string }>(
        "projectLabels",
        `query HorizonboundProjectLabels($first: Int!, $after: String) { projectLabels(first: $first, after: $after, includeArchived: true) { nodes { id name } pageInfo { hasNextPage endCursor } } }`,
        labelsPageSchema
      ),
      this.collectConfiguration<{ id: string; name: string; team?: { id: string } | null }>(
        "projectStatuses",
        `query HorizonboundProjectStatuses($first: Int!, $after: String) { projectStatuses(first: $first, after: $after, includeArchived: true) { nodes { id name team { id } } pageInfo { hasNextPage endCursor } } }`,
        statusesPageSchema
      )
    ]);

    return {
      teams: teams.map((node) => ({ ...node, workspaceId: this.scope.workspaceId })),
      labels: labels.map((node) => ({ ...node, workspaceId: this.scope.workspaceId })),
      statuses: statuses.map((node) => ({
        id: node.id,
        name: node.name,
        workspaceId: this.scope.workspaceId,
        teamId: node.team?.id ?? null
      }))
    };
  }

  async getProjects(after: string | null): Promise<LinearPage<LinearProject>> {
    if (!this.scope.teamId || !this.scope.membershipLabelId) return { nodes: [], nextCursor: null };
    const data = await this.request(
      PROJECTS_QUERY,
      {
        first: 50,
        after,
        teamId: this.scope.teamId,
        labelId: this.scope.membershipLabelId
      },
      projectPageSchema
    );
    const nodes = data.projects.nodes.map((node) => {
      if (node.teams.pageInfo.hasNextPage || node.labels.pageInfo.hasNextPage) {
        throw new Error("Linear project relationships exceeded the validated completeness bound");
      }
      this.projectIds.add(node.id);
      return {
        id: node.id,
        workspaceId: this.scope.workspaceId,
        name: node.name,
        url: node.url,
        statusId: node.status?.id ?? null,
        startDate: node.startDate,
        archived: node.archivedAt !== null,
        teamIds: node.teams.nodes.map(({ id }) => id),
        labelIds: node.labels.nodes.map(({ id }) => id)
      };
    });
    return { nodes, nextCursor: nextCursor(data.projects.pageInfo) };
  }

  async getIssues(after: string | null): Promise<LinearPage<LinearIssue>> {
    if (this.projectIds.size === 0) return { nodes: [], nextCursor: null };
    const data = await this.request(
      ISSUES_QUERY,
      {
        first: 100,
        after,
        projectIds: [...this.projectIds]
      },
      issuePageSchema
    );
    const nodes = data.issues.nodes.flatMap((node) => {
      if (!node.project) return [];
      const state =
        node.state.type === "completed"
          ? "completed"
          : node.state.type === "canceled"
            ? "canceled"
            : "open";
      return [
        {
          id: node.id,
          projectId: node.project.id,
          parentId: node.parent?.id ?? null,
          estimate: node.estimate,
          state,
          archived: node.archivedAt !== null,
          updatedAt: node.updatedAt
        } satisfies LinearIssue
      ];
    });
    return { nodes, nextCursor: nextCursor(data.issues.pageInfo) };
  }

  private async collectConfiguration<T>(
    key: string,
    query: string,
    schema: z.ZodTypeAny
  ): Promise<T[]> {
    const nodes: T[] = [];
    const seen = new Set<string>();
    let after: string | null = null;
    do {
      const data = (await this.request(query, { first: 100, after }, schema)) as Record<
        string,
        { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }
      >;
      const collection = data[key];
      if (!collection) throw new Error(`Linear response omitted ${key}`);
      nodes.push(...collection.nodes);
      const cursor = nextCursor(collection.pageInfo);
      if (cursor && seen.has(cursor))
        throw new Error(`Linear ${key} pagination returned a repeated cursor`);
      if (cursor) seen.add(cursor);
      after = cursor;
    } while (after);
    return nodes;
  }

  private async request<S extends z.ZodTypeAny>(
    query: string,
    variables: Record<string, unknown>,
    schema: S
  ): Promise<z.infer<S>> {
    const maxAttempts = this.options.maxAttempts ?? 3;
    const sleep =
      this.options.sleep ??
      ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const response = await this.fetcher("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(30_000)
      });
      this.requestCount += 1;
      this.rateLimitRemaining = numericHeader(
        response.headers.get("x-ratelimit-requests-remaining")
      );
      this.rateLimitResetAt = response.headers.get("x-ratelimit-requests-reset");

      const payload = (await response.json().catch(() => null)) as {
        data?: unknown;
        errors?: Array<{ extensions?: { code?: string } }>;
      } | null;
      const rateLimited =
        response.status === 429 ||
        payload?.errors?.some((error) => error.extensions?.code === "RATELIMITED") === true;
      if (rateLimited && attempt < maxAttempts) {
        const retryAfterSeconds = numericHeader(response.headers.get("retry-after"));
        const delay =
          retryAfterSeconds === null ? 500 * 2 ** (attempt - 1) : retryAfterSeconds * 1000;
        await sleep(Math.min(delay, 60_000));
        continue;
      }
      if (rateLimited) throw new Error("Linear rate limit prevented a complete refresh");
      if (response.status === 401 || response.status === 403) {
        throw new Error("Linear authorization failed; reconnection may be required");
      }
      if (!response.ok) throw new Error(`Linear GraphQL request failed (${response.status})`);
      if (payload?.errors?.length) {
        throw new Error("Linear GraphQL returned an error for required data");
      }
      try {
        return schema.parse(payload?.data);
      } catch {
        throw new Error("Linear GraphQL returned an invalid required-data shape");
      }
    }
    throw new Error("Linear GraphQL request exhausted retries");
  }
}

function numericHeader(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nextCursor(pageInfo: { hasNextPage: boolean; endCursor: string | null }): string | null {
  if (!pageInfo.hasNextPage) return null;
  if (!pageInfo.endCursor)
    throw new Error("Linear pagination indicated another page without a cursor");
  return pageInfo.endCursor;
}
