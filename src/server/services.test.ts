import { describe, expect, it } from "vitest";
import { linearCredentialMode } from "./services";

describe("linearCredentialMode", () => {
  it("prefers a configured personal API key for the local pilot", () => {
    expect(
      linearCredentialMode({
        LINEAR_API_KEY: "configured",
        LINEAR_CLIENT_ID: "oauth-client",
        TOKEN_ENCRYPTION_KEY: "oauth-key",
        APP_BASE_URL: "http://127.0.0.1:3000"
      })
    ).toBe("api_key");
  });

  it("falls back to OAuth only when all required OAuth settings are present", () => {
    expect(
      linearCredentialMode({
        LINEAR_CLIENT_ID: "oauth-client",
        TOKEN_ENCRYPTION_KEY: "oauth-key",
        APP_BASE_URL: "http://127.0.0.1:3000"
      })
    ).toBe("oauth");
    expect(linearCredentialMode({ APP_BASE_URL: "http://127.0.0.1:3000" })).toBeNull();
  });
});
