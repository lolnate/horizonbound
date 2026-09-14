import { describe, expect, it } from "vitest";
import { healthStatus } from "./health";

describe("healthStatus", () => {
  it("reports the service identity without environment details", () => {
    expect(healthStatus()).toEqual({ status: "ok", service: "horizonbound" });
  });
});
