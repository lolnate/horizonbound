import { describe, expect, it, vi } from "vitest";
import { LinearGraphqlSource } from "./linear-graphql-source";

function response(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

describe("LinearGraphqlSource", () => {
  it("maps scoped project and issue pages without preserving raw payloads", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          data: {
            projects: {
              nodes: [
                {
                  id: "project-1",
                  name: "Launch",
                  url: "https://linear.app/project/1",
                  startDate: "2026-10-01",
                  archivedAt: null,
                  status: { id: "status-1" },
                  teams: {
                    nodes: [{ id: "team-1" }],
                    pageInfo: { hasNextPage: false, endCursor: null }
                  },
                  labels: {
                    nodes: [{ id: "label-1" }],
                    pageInfo: { hasNextPage: false, endCursor: null }
                  }
                }
              ],
              pageInfo: { hasNextPage: true, endCursor: "project-cursor" }
            }
          }
        })
      )
      .mockResolvedValueOnce(
        response({
          data: {
            issues: {
              nodes: [
                {
                  id: "issue-1",
                  estimate: 5,
                  archivedAt: null,
                  updatedAt: "2026-09-11T00:00:00.000Z",
                  parent: null,
                  project: { id: "project-1" },
                  state: { type: "completed" }
                }
              ],
              pageInfo: { hasNextPage: false, endCursor: null }
            }
          }
        })
      );
    const source = new LinearGraphqlSource(
      "secret-access-token",
      { workspaceId: "workspace-1", teamId: "team-1", membershipLabelId: "label-1" },
      fetcher
    );

    await expect(source.getProjects(null)).resolves.toEqual({
      nodes: [
        {
          id: "project-1",
          workspaceId: "workspace-1",
          name: "Launch",
          url: "https://linear.app/project/1",
          startDate: "2026-10-01",
          statusId: "status-1",
          archived: false,
          teamIds: ["team-1"],
          labelIds: ["label-1"]
        }
      ],
      nextCursor: "project-cursor"
    });
    await expect(source.getIssues(null)).resolves.toEqual({
      nodes: [
        {
          id: "issue-1",
          projectId: "project-1",
          parentId: null,
          estimate: 5,
          state: "completed",
          archived: false,
          updatedAt: "2026-09-11T00:00:00.000Z"
        }
      ],
      nextCursor: null
    });

    const firstRequest = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(firstRequest.variables).toMatchObject({ teamId: "team-1", labelId: "label-1" });
    expect(String(fetcher.mock.calls[0]?.[1]?.headers)).not.toContain("secret-access-token");
  });

  it("backs off and retries a rate-limited request without accepting partial data", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          errors: [{ message: "private provider detail", extensions: { code: "RATELIMITED" } }]
        })
      )
      .mockResolvedValueOnce(
        response({
          data: { projects: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } }
        })
      );
    const sleep = vi.fn(async () => undefined);
    const source = new LinearGraphqlSource(
      "token",
      { workspaceId: "workspace-1", teamId: "team-1", membershipLabelId: "label-1" },
      fetcher,
      { sleep, maxAttempts: 2 }
    );

    await expect(source.getProjects(null)).resolves.toEqual({ nodes: [], nextCursor: null });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
    expect(source.diagnostics().requestCount).toBe(2);
  });

  it("rejects GraphQL errors even when the HTTP response is successful", async () => {
    const source = new LinearGraphqlSource(
      "token",
      { workspaceId: "workspace-1", teamId: "team-1", membershipLabelId: "label-1" },
      vi.fn<typeof fetch>().mockResolvedValue(response({ errors: [{ message: "rate limited" }] }))
    );

    await expect(source.getProjects(null)).rejects.toThrow(/required data/i);
  });
});
