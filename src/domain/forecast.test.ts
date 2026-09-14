import { describe, expect, it } from "vitest";
import {
  calculateForecast,
  forecastIntegrityWarning,
  refinementStatus,
  validateForecastInput
} from "./forecast";

const validInput = {
  unrefinedLow: 3,
  unrefinedExpected: 5,
  unrefinedHigh: 8,
  horizonShare: 50
};

describe("forecast domain", () => {
  it("calculates lifetime, remaining, and rounded-up horizon demand", () => {
    expect(calculateForecast({ completedActual: 10, detailedOpen: 7, ...validInput })).toEqual({
      lifetime: { low: 20, expected: 22, high: 25 },
      remaining: { low: 10, expected: 12, high: 15 },
      horizonDemand: { expected: 6, high: 8 }
    });
  });

  it("preserves indeterminate results when a required source aggregate is unknown", () => {
    expect(
      calculateForecast({ completedActual: 10, detailedOpen: null, ...validInput })
    ).toBeNull();
  });

  it("rejects fractional, negative, unordered, or out-of-range forecast values", () => {
    expect(validateForecastInput(validInput).success).toBe(true);
    expect(validateForecastInput({ ...validInput, unrefinedLow: 5.5 }).success).toBe(false);
    expect(validateForecastInput({ ...validInput, unrefinedLow: -1 }).success).toBe(false);
    expect(validateForecastInput({ ...validInput, unrefinedExpected: 2 }).success).toBe(false);
    expect(validateForecastInput({ ...validInput, horizonShare: 101 }).success).toBe(false);
  });

  it("warns only when current detailed work exceeds the saved lifetime-high baseline", () => {
    expect(forecastIntegrityWarning(11, 10, 20)).toMatch(/exceeds/i);
    expect(forecastIntegrityWarning(10, 10, 20)).toBeNull();
    expect(forecastIntegrityWarning(null, 10, 20)).toBeNull();
  });

  it("derives refinement status without inventing a missing target", () => {
    const now = new Date("2026-09-11T12:00:00Z");
    expect(refinementStatus(null, 14, validInput, now)).toEqual({ target: null, state: "unknown" });
    expect(refinementStatus("2026-09-20", 14, validInput, now).state).toBe("overdue");
    expect(
      refinementStatus(
        "2026-10-20",
        14,
        { ...validInput, unrefinedLow: 0, unrefinedExpected: 0, unrefinedHigh: 0 },
        now
      ).state
    ).toBe("refined");
  });
});
