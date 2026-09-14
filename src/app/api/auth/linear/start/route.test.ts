import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(async () => ({
    sessionToken: "opaque-session",
    connectionId: "linear:workspace-1",
    workspaceName: "Example Workspace"
  })),
  beginConnection: vi.fn(),
  refreshConnection: vi.fn(async () => undefined),
  credentialMode: vi.fn<() => "api_key" | "oauth" | null>(() => "api_key"),
  apiKeyRuntimeAllowed: vi.fn(() => true),
  origin: { value: "http://127.0.0.1:3000" }
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ origin: mocks.origin.value })
}));
vi.mock("@/config/runtime", () => ({
  apiKeyRuntimeAllowed: mocks.apiKeyRuntimeAllowed,
  loadRuntimeConfig: () => ({ appBaseUrl: new URL("http://127.0.0.1:3000") })
}));
vi.mock("@/server/refresh", () => ({ refreshConnection: mocks.refreshConnection }));
vi.mock("@/server/services", () => ({
  getApiKeyService: () => ({ connect: mocks.connect }),
  getOAuthService: () => ({ beginConnection: mocks.beginConnection }),
  linearCredentialMode: mocks.credentialMode
}));

import { POST } from "./route";

describe("POST /api/auth/linear/start", () => {
  beforeEach(() => {
    mocks.connect.mockClear();
    mocks.refreshConnection.mockReset();
    mocks.refreshConnection.mockResolvedValue(undefined);
    mocks.credentialMode.mockReturnValue("api_key");
    mocks.apiKeyRuntimeAllowed.mockReturnValue(true);
    mocks.origin.value = "http://127.0.0.1:3000";
  });

  it("bootstraps an API-key connection and sets only the opaque local session cookie", async () => {
    const response = await POST();

    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.refreshConnection).toHaveBeenCalledWith("linear:workspace-1", null, "launch");
    expect(response.headers.get("location")).toBe("http://127.0.0.1:3000/");
    expect(response.headers.get("set-cookie")).toContain("horizonbound_session=opaque-session");
    expect(response.headers.get("set-cookie")).not.toContain("lin_api");
  });

  it("carries an initial source-sync failure into the connected page", async () => {
    mocks.refreshConnection.mockRejectedValue(new Error("private provider detail"));

    const response = await POST();

    expect(response.headers.get("location")).toBe("http://127.0.0.1:3000/?sync=failed");
    expect(response.headers.get("set-cookie")).toContain("horizonbound_session=opaque-session");
  });

  it("rejects API-key bootstrap outside a loopback-only runtime", async () => {
    mocks.apiKeyRuntimeAllowed.mockReturnValue(false);

    const response = await POST();

    expect(mocks.connect).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("http://127.0.0.1:3000/?auth=failed");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rejects cross-origin API-key bootstrap before reading the credential", async () => {
    mocks.origin.value = "https://attacker.example";

    const response = await POST();

    expect(mocks.connect).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("http://127.0.0.1:3000/?auth=failed");
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
