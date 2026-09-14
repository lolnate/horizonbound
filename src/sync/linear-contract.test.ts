import { describe, expect, it } from "vitest";
import { LinearGraphqlSource } from "./linear-graphql-source";

const contract = {
  accessToken: process.env.LINEAR_CONTRACT_ACCESS_TOKEN,
  workspaceId: process.env.LINEAR_CONTRACT_WORKSPACE_ID,
  teamId: process.env.LINEAR_CONTRACT_TEAM_ID,
  labelId: process.env.LINEAR_CONTRACT_PROJECT_LABEL_ID,
  projectId: process.env.LINEAR_CONTRACT_PROJECT_ID
};
const contractDescribe = Object.values(contract).every(Boolean) ? describe : describe.skip;

contractDescribe("authorized Linear adapter contract", () => {
  it("completely paginates configured source collections and preserves estimate semantics", async () => {
    const source = new LinearGraphqlSource(contract.accessToken!, {
      workspaceId: contract.workspaceId!,
      teamId: contract.teamId!,
      membershipLabelId: contract.labelId!
    });
    const configuration = await source.getConfiguration();
    expect(configuration.teams.some((team) => team.id === contract.teamId)).toBe(true);
    expect(configuration.labels.some((label) => label.id === contract.labelId)).toBe(true);

    const projects = [];
    let projectCursor: string | null = null;
    do {
      const page = await source.getProjects(projectCursor);
      projects.push(...page.nodes);
      projectCursor = page.nextCursor;
    } while (projectCursor);
    expect(projects.some((project) => project.id === contract.projectId)).toBe(true);

    const issues = [];
    let issueCursor: string | null = null;
    do {
      const page = await source.getIssues(issueCursor);
      issues.push(...page.nodes);
      issueCursor = page.nextCursor;
    } while (issueCursor);
    expect(
      issues.every((issue) => issue.estimate === null || Number.isInteger(issue.estimate))
    ).toBe(true);
    expect(source.diagnostics().requestCount).toBeGreaterThan(0);
  });
});
