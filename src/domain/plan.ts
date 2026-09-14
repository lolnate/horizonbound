import { z } from "zod";

const sourceChoiceSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  teamId: z.string().min(1).nullable().optional()
});

const wholeNonnegative = z.number().int().nonnegative();

export const planInputSchema = z
  .object({
    name: z.string().trim().min(1),
    workspaceId: z.string().min(1),
    teamId: z.string().min(1),
    membershipLabel: sourceChoiceSchema,
    commitmentStatus: sourceChoiceSchema,
    horizonWeeks: z.number().int().positive(),
    weeklyCapacity: wholeNonnegative,
    capacityEffectiveDate: z.iso.date(),
    refinementLeadTimeDays: wholeNonnegative,
    lanes: z
      .array(z.object({ name: z.string().trim().min(1), weeklyAllocation: wholeNonnegative }))
      .min(1)
  })
  .superRefine((value, context) => {
    if (value.membershipLabel.workspaceId !== value.workspaceId) {
      context.addIssue({
        code: "custom",
        path: ["membershipLabel"],
        message: "Label belongs to another workspace"
      });
    }
    if (value.commitmentStatus.workspaceId !== value.workspaceId) {
      context.addIssue({
        code: "custom",
        path: ["commitmentStatus"],
        message: "Status belongs to another workspace"
      });
    }
    if (value.commitmentStatus.teamId && value.commitmentStatus.teamId !== value.teamId) {
      context.addIssue({
        code: "custom",
        path: ["commitmentStatus"],
        message: "Status is incompatible with the selected team"
      });
    }
  });

export type PlanInput = z.infer<typeof planInputSchema>;

export function evaluatePlan(
  value: unknown
):
  { success: true; warnings: string[] } | { success: false; warnings: string[]; errors: string[] } {
  const parsed = planInputSchema.safeParse(value);
  if (!parsed.success) {
    return {
      success: false,
      warnings: [],
      errors: parsed.error.issues.map((issue) => issue.message)
    };
  }

  const allocated = parsed.data.lanes.reduce((total, lane) => total + lane.weeklyAllocation, 0);
  return {
    success: true,
    warnings:
      allocated > parsed.data.weeklyCapacity
        ? ["Capacity lane allocations exceed the plan's weekly capacity."]
        : []
  };
}

interface ProjectMembershipFacts {
  workspaceId: string;
  teamIds: readonly string[];
  labelIds: readonly string[];
  statusId: string | null;
}

export function isProjectMember(project: ProjectMembershipFacts, plan: PlanInput): boolean {
  return (
    project.workspaceId === plan.workspaceId &&
    project.teamIds.includes(plan.teamId) &&
    project.labelIds.includes(plan.membershipLabel.id)
  );
}
