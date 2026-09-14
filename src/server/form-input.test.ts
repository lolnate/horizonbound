import { describe, expect, it } from "vitest";
import { parseForecastForm, parsePlanForm } from "./form-input";

describe("parsePlanForm", () => {
  it("parses repeated lanes and whole-number planning inputs", () => {
    const form = new FormData();
    for (const [key, value] of Object.entries({
      name: "Roadmap",
      teamId: "team-1",
      membershipLabelId: "label-1",
      commitmentStatusId: "status-1",
      horizonWeeks: "12",
      weeklyCapacity: "20",
      capacityEffectiveDate: "2026-09-14",
      refinementLeadTimeDays: "30"
    }))
      form.set(key, value);
    form.append("laneName", "Core");
    form.append("laneName", "Maintenance");
    form.append("laneAllocation", "14");
    form.append("laneAllocation", "6");

    expect(parsePlanForm(form)).toMatchObject({
      name: "Roadmap",
      horizonWeeks: 12,
      weeklyCapacity: 20,
      lanes: [
        { name: "Core", weeklyAllocation: 14 },
        { name: "Maintenance", weeklyAllocation: 6 }
      ]
    });
  });
});

describe("parseForecastForm", () => {
  it("keeps explicit zero distinct from a missing value", () => {
    const form = new FormData();
    for (const [key, value] of Object.entries({
      projectId: "project-1",
      unrefinedLow: "0",
      unrefinedExpected: "3",
      unrefinedHigh: "5",
      confidence: "medium",
      estimateBasis: "Team review",
      forecastAsOfDate: "2026-09-11",
      capacityLaneId: "lane-1",
      horizonSharePercent: "75",
      reason: "Initial forecast",
      category: "scope"
    }))
      form.set(key, value);

    expect(parseForecastForm(form)).toMatchObject({
      projectId: "project-1",
      unrefinedLow: 0,
      horizonSharePercent: 75,
      reason: "Initial forecast"
    });
  });

  it("rejects a missing numeric forecast value instead of treating it as zero", () => {
    expect(() => parseForecastForm(new FormData())).toThrow(/project/i);
  });
});
