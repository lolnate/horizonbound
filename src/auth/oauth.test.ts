import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type HorizonboundDatabase } from "@/db/database";
import { TokenCipher } from "./token-cipher";
import { LinearOAuthService, type LinearOAuthProvider } from "./oauth";

const opened: HorizonboundDatabase[] = [];

async function setup(providerOverrides: Partial<LinearOAuthProvider> = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "horizonbound-auth-"));
  const database = openDatabase(path.join(directory, "state.sqlite"));
  opened.push(database);
  const provider: LinearOAuthProvider = {
    exchangeCode: vi.fn(async () => ({
      accessToken: "plain-access-token",
      refreshToken: "plain-refresh-token",
      expiresAt: 999_999,
      scope: "read",
      user: { id: "user-1", name: "Ada" },
      workspace: { id: "workspace-1", name: "Example Workspace" }
    })),
    refreshToken: vi.fn(),
    revokeToken: vi.fn(),
    ...providerOverrides
  };
  const values = ["state-value", "verifier-value", "correlation-value", "session-value"];
  const service = new LinearOAuthService({
    database,
    provider,
    cipher: new TokenCipher(Buffer.alloc(32, 7)),
    clientId: "client-1",
    authorizeUrl: "https://linear.app/oauth/authorize",
    redirectUri: "http://127.0.0.1:3000/api/auth/linear/callback",
    now: () => 1000,
    randomToken: () => values.shift() ?? "extra-value"
  });
  return { database, provider, service };
}

afterEach(() => {
  for (const database of opened.splice(0)) database.close();
});

describe("LinearOAuthService", () => {
  it("creates a read-only PKCE S256 authorization request and stores no verifier in plaintext", async () => {
    const { database, service } = await setup();

    const started = service.beginConnection();
    const url = new URL(started.authorizationUrl);

    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("read");
    expect(url.searchParams.get("actor")).toBe("user");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("state-value");
    expect(started.correlationCookie).toBe("correlation-value");

    const stored = database.sqlite.prepare("SELECT * FROM oauth_states").get() as Record<
      string,
      unknown
    >;
    expect(JSON.stringify(stored)).not.toContain("verifier-value");
    expect(JSON.stringify(stored)).not.toContain("state-value");
    expect(JSON.stringify(stored)).not.toContain("correlation-value");
  });

  it("exchanges one valid callback, encrypts tokens, and issues an opaque local session", async () => {
    const { database, provider, service } = await setup();
    const started = service.beginConnection();

    const completed = await service.completeConnection({
      correlationCookie: started.correlationCookie,
      state: "state-value",
      code: "authorization-code"
    });

    expect(provider.exchangeCode).toHaveBeenCalledWith({
      code: "authorization-code",
      codeVerifier: "verifier-value",
      redirectUri: "http://127.0.0.1:3000/api/auth/linear/callback",
      clientId: "client-1"
    });
    expect(completed).toMatchObject({
      sessionToken: "session-value",
      workspaceName: "Example Workspace"
    });
    const stored = JSON.stringify(database.sqlite.prepare("SELECT * FROM connections").get());
    expect(stored).not.toContain("plain-access-token");
    expect(stored).not.toContain("plain-refresh-token");
    expect(service.verifySession("session-value")).toMatchObject({
      workspaceName: "Example Workspace",
      linearUserName: "Ada"
    });

    await expect(
      service.completeConnection({
        correlationCookie: started.correlationCookie,
        state: "state-value",
        code: "authorization-code"
      })
    ).rejects.toThrow(/expired|used|invalid/i);
  });

  it("rejects a provider response without read scope", async () => {
    const { service } = await setup({
      exchangeCode: vi.fn(async () => ({
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: 999_999,
        scope: "write",
        user: { id: "user-1", name: "Ada" },
        workspace: { id: "workspace-1", name: "Example Workspace" }
      }))
    });
    const started = service.beginConnection();

    await expect(
      service.completeConnection({
        correlationCookie: started.correlationCookie,
        state: "state-value",
        code: "authorization-code"
      })
    ).rejects.toThrow(/read scope/i);
  });

  it("serializes near-expiry refreshes and atomically keeps the rotated refresh token", async () => {
    const refreshToken = vi.fn(async () => ({
      accessToken: "rotated-access",
      refreshToken: "rotated-refresh",
      expiresAt: 999_999,
      scope: "read"
    }));
    const { database, service } = await setup({
      exchangeCode: vi.fn(async () => ({
        accessToken: "expiring-access",
        refreshToken: "original-refresh",
        expiresAt: 1001,
        scope: "read",
        user: { id: "user-1", name: "Ada" },
        workspace: { id: "workspace-1", name: "Example Workspace" }
      })),
      refreshToken
    });
    const started = service.beginConnection();
    await service.completeConnection({
      correlationCookie: started.correlationCookie,
      state: "state-value",
      code: "authorization-code"
    });

    await expect(
      Promise.all([
        service.getAccessToken("linear:workspace-1"),
        service.getAccessToken("linear:workspace-1")
      ])
    ).resolves.toEqual(["rotated-access", "rotated-access"]);
    expect(refreshToken).toHaveBeenCalledTimes(1);
    const stored = database.sqlite
      .prepare("SELECT refresh_token_ciphertext AS token FROM connections")
      .get() as { token: string };
    expect(stored.token).not.toContain("rotated-refresh");
  });

  it("can force one serialized refresh after a provider authorization failure", async () => {
    const refreshToken = vi.fn(async () => ({
      accessToken: "retry-access",
      refreshToken: "retry-refresh",
      expiresAt: 999_999,
      scope: "read"
    }));
    const { service } = await setup({ refreshToken });
    const started = service.beginConnection();
    await service.completeConnection({
      correlationCookie: started.correlationCookie,
      state: "state-value",
      code: "authorization-code"
    });

    await expect(
      Promise.all([
        service.refreshAccessToken("linear:workspace-1"),
        service.refreshAccessToken("linear:workspace-1")
      ])
    ).resolves.toEqual(["retry-access", "retry-access"]);
    expect(refreshToken).toHaveBeenCalledTimes(1);
  });

  it("rejects connecting a second workspace to the same installation", async () => {
    const { database, service } = await setup();
    database.sqlite
      .prepare(
        `INSERT INTO connections (
          id, linear_user_id, workspace_id, workspace_name,
          access_token_ciphertext, refresh_token_ciphertext, expires_at,
          granted_scope, created_at, updated_at
        ) VALUES ('existing', 'user', 'other-workspace', 'Other', 'cipher', 'cipher', 999999, 'read', 1, 1)`
      )
      .run();
    const started = service.beginConnection();

    await expect(
      service.completeConnection({
        correlationCookie: started.correlationCookie,
        state: "state-value",
        code: "authorization-code"
      })
    ).rejects.toThrow(/one Linear workspace/i);
    expect(database.sqlite.prepare("SELECT COUNT(*) FROM connections").pluck().get()).toBe(1);
  });

  it("still completes local disconnect when provider revocation fails", async () => {
    const { database, service } = await setup({
      revokeToken: vi.fn(async () => {
        throw new Error("provider secret detail");
      })
    });
    const started = service.beginConnection();
    const completed = await service.completeConnection({
      correlationCookie: started.correlationCookie,
      state: "state-value",
      code: "authorization-code"
    });

    await expect(service.disconnect(completed.sessionToken)).resolves.toEqual({
      revocationFailed: true
    });
    expect(service.verifySession(completed.sessionToken)).toBeUndefined();
    expect(
      database.sqlite.prepare("SELECT reconnect_required FROM connections").pluck().get()
    ).toBe(1);
  });

  it("revokes the provider token and removes local tokens and sessions on disconnect", async () => {
    const { database, provider, service } = await setup();
    const started = service.beginConnection();
    const completed = await service.completeConnection({
      correlationCookie: started.correlationCookie,
      state: "state-value",
      code: "authorization-code"
    });

    await service.disconnect(completed.sessionToken);

    expect(provider.revokeToken).toHaveBeenCalledWith("plain-access-token");
    expect(service.verifySession(completed.sessionToken)).toBeUndefined();
    expect(
      database.sqlite
        .prepare(
          "SELECT access_token_ciphertext AS accessToken, refresh_token_ciphertext AS refreshToken, reconnect_required AS reconnectRequired FROM connections"
        )
        .get()
    ).toEqual({
      accessToken: "",
      refreshToken: "",
      reconnectRequired: 1
    });
  });
});
