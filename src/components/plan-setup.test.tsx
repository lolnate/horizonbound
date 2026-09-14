// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlanSetup } from "./plan-setup";

const props = {
  workspaceName: "Example Workspace",
  userName: "Ada",
  teams: [{ id: "team-1", name: "Platform" }],
  labels: [{ id: "label-1", name: "Roadmap" }],
  statuses: [{ id: "status-1", name: "Committed", teamId: "team-1" }],
  saveAction: vi.fn()
};

describe("PlanSetup", () => {
  it("collects a complete configurable plan and supports multiple lanes", () => {
    render(<PlanSetup {...props} />);

    expect(screen.getByRole("heading", { name: /configure your roadmap/i })).toBeInTheDocument();
    expect(screen.getByText(/Ada.*Example Workspace/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Team")).toHaveTextContent("Platform");
    expect(screen.getByLabelText("Membership label")).toHaveTextContent("Roadmap");
    expect(screen.getByLabelText("Commitment status")).toHaveTextContent("Committed");
    expect(screen.getAllByLabelText("Lane name")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Add capacity lane" }));
    expect(screen.getAllByLabelText("Lane name")).toHaveLength(2);
  });
});
