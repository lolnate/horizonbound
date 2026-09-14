export interface SourceIssue {
  id: string;
  estimate: number | null;
  state: "open" | "completed" | "canceled";
  parentId: string | null;
  archived?: boolean;
}

export interface IssueAggregates {
  completedActual: number;
  detailedOpen: number;
  unestimatedOpenCount: number;
  hasUnknownOpenEstimate: boolean;
  possibleDoubleCounting: boolean;
}

export function aggregateIssues(issues: readonly SourceIssue[]): IssueAggregates {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  let completedActual = 0;
  let detailedOpen = 0;
  let unestimatedOpenCount = 0;
  let possibleDoubleCounting = false;

  for (const issue of issues) {
    if (issue.state === "canceled") continue;

    if (issue.estimate === null) {
      if (issue.state === "open") unestimatedOpenCount += 1;
    } else if (issue.state === "completed") {
      completedActual += issue.estimate;
    } else {
      detailedOpen += issue.estimate;
    }

    if (issue.parentId && issue.estimate !== null) {
      const parent = byId.get(issue.parentId);
      if (parent?.estimate !== null && parent?.state !== "canceled") possibleDoubleCounting = true;
    }
  }

  return {
    completedActual,
    detailedOpen,
    unestimatedOpenCount,
    hasUnknownOpenEstimate: unestimatedOpenCount > 0,
    possibleDoubleCounting
  };
}
