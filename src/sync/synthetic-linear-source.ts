import type {
  LinearConfiguration,
  LinearIssue,
  LinearPage,
  LinearProject,
  LinearSource
} from "./full-reconciliation";

const configuration: LinearConfiguration = {
  teams: [
    { id: "synthetic-team", workspaceId: "synthetic-workspace", name: "Product Engineering" }
  ],
  labels: [{ id: "synthetic-roadmap", workspaceId: "synthetic-workspace", name: "Roadmap" }],
  statuses: [
    {
      id: "synthetic-committed",
      workspaceId: "synthetic-workspace",
      teamId: "synthetic-team",
      name: "Committed"
    }
  ]
};

const projects: LinearProject[] = [
  {
    id: "synthetic-project",
    workspaceId: "synthetic-workspace",
    name: "Example launch",
    url: "https://linear.app",
    statusId: "synthetic-committed",
    startDate: "2026-12-01",
    archived: false,
    teamIds: ["synthetic-team"],
    labelIds: ["synthetic-roadmap"]
  }
];

const issues: LinearIssue[] = [
  {
    id: "synthetic-complete",
    projectId: "synthetic-project",
    parentId: null,
    estimate: 5,
    state: "completed",
    archived: false,
    updatedAt: "2026-09-01T00:00:00.000Z"
  },
  {
    id: "synthetic-parent",
    projectId: "synthetic-project",
    parentId: null,
    estimate: 8,
    state: "open",
    archived: false,
    updatedAt: "2026-09-02T00:00:00.000Z"
  },
  {
    id: "synthetic-child",
    projectId: "synthetic-project",
    parentId: "synthetic-parent",
    estimate: 3,
    state: "open",
    archived: false,
    updatedAt: "2026-09-03T00:00:00.000Z"
  },
  {
    id: "synthetic-unestimated",
    projectId: "synthetic-project",
    parentId: null,
    estimate: null,
    state: "open",
    archived: false,
    updatedAt: "2026-09-04T00:00:00.000Z"
  }
];

export class SyntheticLinearSource implements LinearSource {
  constructor(private readonly configurationOnly = false) {}

  async getConfiguration() {
    return configuration;
  }

  async getProjects(after: string | null): Promise<LinearPage<LinearProject>> {
    return { nodes: this.configurationOnly || after ? [] : projects, nextCursor: null };
  }

  async getIssues(after: string | null): Promise<LinearPage<LinearIssue>> {
    return { nodes: this.configurationOnly || after ? [] : issues, nextCursor: null };
  }
}
