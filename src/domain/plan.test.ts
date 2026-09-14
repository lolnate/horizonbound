import { describe, expect, it } from "vitest";
import { evaluatePlan, isProjectMember } from "./plan";

const input = {
  name: "Platform roadmap",
  workspaceId: "workspace-1",
  teamId: "team-1",
  membershipLabel: { id: "label-1", workspaceId: "workspace-1" },
  commitmentStatus: { id: "status-1", workspaceId: "workspace-1", teamId: "team-1" },
  horizonWeeks: 20,
  weeklyCapacity: 10,
  capacityEffectiveDate: "2026-09-01",
  refinementLeadTimeDays: 14,
  lanes: [{ name: "Product", weeklyAllocation: 8 }]
};

describe("plan domain", () => {
  it("accepts a complete generic plan", () => {
    expect(evaluatePlan(input)).toEqual({ success: true, warnings: [] });
  });

  it("warns rather than silently hiding over-allocation", () => {
    expect(evaluatePlan({ ...input, lanes: [{ name: "Product", weeklyAllocation: 11 }] })).toEqual({
      success: true,
      warnings: [expect.stringMatching(/exceed/i)]
    });
  });

  it("rejects incompatible source ownership and invalid whole-point values", () => {
    expect(
      evaluatePlan({
        ...input,
        membershipLabel: { id: "label-1", workspaceId: "other" }
      }).success
    ).toBe(false);
    expect(
      evaluatePlan({
        ...input,
        commitmentStatus: { id: "status-1", workspaceId: "workspace-1", teamId: "other" }
      }).success
    ).toBe(false);
    expect(evaluatePlan({ ...input, weeklyCapacity: 10.5 }).success).toBe(false);
    expect(evaluatePlan({ ...input, lanes: [] }).success).toBe(false);
  });

  it("uses workspace, associated team, and membership label only for membership", () => {
    const project = {
      workspaceId: "workspace-1",
      teamIds: ["team-1", "team-2"],
      labelIds: ["label-1"],
      statusId: "unrelated"
    };

    expect(isProjectMember(project, input)).toBe(true);
    expect(isProjectMember({ ...project, labelIds: [] }, input)).toBe(false);
    expect(isProjectMember({ ...project, teamIds: ["team-2"] }, input)).toBe(false);
  });
});
