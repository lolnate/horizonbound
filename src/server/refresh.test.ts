import { describe, expect, it } from "vitest";
import { isAuthorizationFailure } from "./refresh";

describe("isAuthorizationFailure", () => {
  it("recognizes only the sanitized adapter authorization failure", () => {
    expect(
      isAuthorizationFailure(new Error("Linear authorization failed; reconnection may be required"))
    ).toBe(true);
    expect(
      isAuthorizationFailure(new Error("Required source data could not be synchronized"))
    ).toBe(false);
    expect(isAuthorizationFailure("Linear authorization failed")).toBe(false);
  });
});
