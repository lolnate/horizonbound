import { describe, expect, it } from "vitest";
import { aggregateIssues, type SourceIssue } from "./issue-aggregation";

const issue = (overrides: Partial<SourceIssue>): SourceIssue => ({
  id: crypto.randomUUID(),
  estimate: 3,
  state: "open",
  parentId: null,
  ...overrides
});

describe("aggregateIssues", () => {
  it("separates completed actual from detailed open and excludes canceled work", () => {
    expect(
      aggregateIssues([
        issue({ id: "complete", estimate: 5, state: "completed" }),
        issue({ id: "open", estimate: 3, state: "open" }),
        issue({ id: "canceled", estimate: 8, state: "canceled" })
      ])
    ).toMatchObject({ completedActual: 5, detailedOpen: 3, unestimatedOpenCount: 0 });
  });

  it("keeps a missing estimate distinct from explicit zero", () => {
    expect(
      aggregateIssues([
        issue({ id: "missing", estimate: null }),
        issue({ id: "zero", estimate: 0 })
      ])
    ).toMatchObject({ detailedOpen: 0, unestimatedOpenCount: 1, hasUnknownOpenEstimate: true });
  });

  it("includes parent and child estimates while warning about possible double counting", () => {
    expect(
      aggregateIssues([
        issue({ id: "parent", estimate: 5 }),
        issue({ id: "child", parentId: "parent", estimate: 3 })
      ])
    ).toEqual({
      completedActual: 0,
      detailedOpen: 8,
      unestimatedOpenCount: 0,
      hasUnknownOpenEstimate: false,
      possibleDoubleCounting: true
    });
  });

  it("treats archived work according to its current state", () => {
    expect(
      aggregateIssues([
        issue({ estimate: 2, state: "completed", archived: true }),
        issue({ estimate: 4, state: "open", archived: true })
      ])
    ).toMatchObject({ completedActual: 2, detailedOpen: 4 });
  });
});
