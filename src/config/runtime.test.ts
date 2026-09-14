import { describe, expect, it } from "vitest";
import { apiKeyRuntimeAllowed, loadRuntimeConfig } from "./runtime";

describe("loadRuntimeConfig", () => {
  it("uses a loopback listener by default", () => {
    const config = loadRuntimeConfig({ APP_BASE_URL: "http://127.0.0.1:3000" });

    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(3000);
    expect(config.nonLoopbackWarning).toBeNull();
  });

  it("requires an explicit browser-visible base URL", () => {
    expect(() => loadRuntimeConfig({})).toThrow(/APP_BASE_URL/);
  });

  it("rejects an unspecified browser-visible host", () => {
    expect(() => loadRuntimeConfig({ APP_BASE_URL: "http://0.0.0.0:3000" })).toThrow(
      /browser-visible/
    );
  });

  it("rejects a base URL with a path because it cannot be an exact callback origin", () => {
    expect(() => loadRuntimeConfig({ APP_BASE_URL: "http://127.0.0.1:3000/horizonbound" })).toThrow(
      /origin/i
    );
  });

  it("allows an explicit LAN listener but emits a warning", () => {
    const config = loadRuntimeConfig({
      HOST: "0.0.0.0",
      PORT: "4100",
      APP_BASE_URL: "http://horizonbound.local:4100"
    });

    expect(config.host).toBe("0.0.0.0");
    expect(config.port).toBe(4100);
    expect(config.nonLoopbackWarning).toMatch(/no dedicated front-door access authentication/i);
  });

  it("allows API-key mode only when listener and browser origin are loopback", () => {
    expect(
      apiKeyRuntimeAllowed({ host: "127.0.0.1", appBaseUrl: new URL("http://localhost:3000") })
    ).toBe(true);
    expect(
      apiKeyRuntimeAllowed({
        host: "0.0.0.0",
        appBaseUrl: new URL("http://localhost:3000")
      })
    ).toBe(false);
    expect(
      apiKeyRuntimeAllowed({
        host: "127.0.0.1",
        appBaseUrl: new URL("https://horizonbound.example")
      })
    ).toBe(false);
  });

  it("rejects invalid ports", () => {
    expect(() =>
      loadRuntimeConfig({ APP_BASE_URL: "http://127.0.0.1:3000", PORT: "70000" })
    ).toThrow(/PORT/);
  });
});
