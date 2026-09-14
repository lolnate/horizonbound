// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RoadmapView } from "./roadmap-view";

const roadmap = {
  id: "plan-1",
  name: "Product roadmap",
  workspaceName: "Example Workspace",
  lastSuccessfulSyncAt: 50,
  latestAttempt: {
    status: "failed",
    startedAt: 75,
    finishedAt: 80,
    errorSummary: "Provider unavailable"
  },
  projects: [
    {
      id: "project-1",
      name: "Member project",
      url: "https://linear.app/example",
      statusName: "Planned",
      startDate: "2026-10-20",
      completedActual: 10,
      detailedOpen: 7,
      unestimatedOpenCount: 1,
      possibleDoubleCounting: true,
      forecast: null
    }
  ]
};

describe("RoadmapView", () => {
  it("separates source facts from planning judgments and exposes quality/freshness warnings", () => {
    render(
      <RoadmapView
        roadmap={roadmap}
        operatorName="Ada"
        lanes={[{ id: "lane-1", name: "Product" }]}
        refreshAction={vi.fn()}
        saveForecastAction={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "Product roadmap" })).toBeInTheDocument();
    expect(screen.getByText(/Ada.*Example Workspace/i)).toBeInTheDocument();
    expect(screen.getByText("Linear observations")).toBeInTheDocument();
    expect(screen.getByText(/1 open issue has no estimate/i)).toBeInTheDocument();
    expect(screen.getByText(/possible double counting/i)).toBeInTheDocument();
    expect(screen.getByText(/cached data from the last successful sync/i)).toBeInTheDocument();
    expect(screen.getByText(/Latest attempt: failed/i)).toBeInTheDocument();
    expect(screen.getByText(/Observed in full sync:/i)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Horizonbound forecast" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open in linear/i })).toHaveAttribute(
      "href",
      "https://linear.app/example"
    );
  });
});
