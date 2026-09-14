import { describe, expect, it, vi } from "vitest";
import { LinearHttpOAuthProvider } from "./linear-http-oauth-provider";

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

describe("LinearHttpOAuthProvider", () => {
  it("exchanges a PKCE code and fetches viewer identity without logging or returning raw responses", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "access",
          refresh_token: "refresh",
          expires_in: 3600,
          scope: "read"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            viewer: {
              id: "user-1",
              name: "Ada",
              organization: { id: "workspace-1", name: "Example" }
            }
          }
        })
      );
    const provider = new LinearHttpOAuthProvider({ fetcher, now: () => 1000 });

    const result = await provider.exchangeCode({
      code: "code",
      codeVerifier: "verifier",
      redirectUri: "http://127.0.0.1:3000/api/auth/linear/callback",
      clientId: "client"
    });

    expect(result).toEqual({
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: 3_601_000,
      scope: "read",
      user: { id: "user-1", name: "Ada" },
      workspace: { id: "workspace-1", name: "Example" }
    });
    const tokenBody = fetcher.mock.calls[0]?.[1]?.body;
    expect(String(tokenBody)).toContain("code_verifier=verifier");
    expect(String(tokenBody)).not.toContain("client_secret");
    expect(fetcher.mock.calls[1]?.[1]?.headers).toMatchObject({ Authorization: "Bearer access" });
  });

  it("includes the PKCE client ID when rotating a refresh token", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 3600,
        scope: "read"
      })
    );
    const provider = new LinearHttpOAuthProvider({
      fetcher,
      clientId: "client-id",
      now: () => 1000
    });

    await provider.refreshToken("old-refresh");

    const body = String(fetcher.mock.calls[0]?.[1]?.body);
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("client_id=client-id");
  });

  it("rejects GraphQL partial errors", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "access",
          refresh_token: "refresh",
          expires_in: 3600,
          scope: "read"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: { viewer: null }, errors: [{ message: "denied" }] })
      );
    const provider = new LinearHttpOAuthProvider({ fetcher });

    await expect(
      provider.exchangeCode({
        code: "code",
        codeVerifier: "verifier",
        redirectUri: "http://local",
        clientId: "client"
      })
    ).rejects.toThrow(/GraphQL/i);
  });
});
