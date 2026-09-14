import { describe, expect, it } from "vitest";
import { assertSameOrigin, sessionCookieOptions } from "./web-security";

describe("web session boundary", () => {
  it("uses an HttpOnly SameSite=Lax cookie and enables Secure for HTTPS", () => {
    expect(sessionCookieOptions(new URL("https://roadmap.example.test"))).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/"
    });
    expect(sessionCookieOptions(new URL("http://127.0.0.1:3000")).secure).toBe(false);
  });

  it("accepts same-origin unsafe requests and rejects other or missing origins", () => {
    expect(() =>
      assertSameOrigin("http://127.0.0.1:3000", new URL("http://127.0.0.1:3000"))
    ).not.toThrow();
    expect(() => assertSameOrigin("http://peer.test", new URL("http://127.0.0.1:3000"))).toThrow(
      /origin/i
    );
    expect(() => assertSameOrigin(null, new URL("http://127.0.0.1:3000"))).toThrow(/origin/i);
  });
});
