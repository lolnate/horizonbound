import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type HorizonboundDatabase } from "@/db/database";
import {
  LinearApiKeyService,
  LinearHttpApiKeyIdentityProvider,
  type LinearApiKeyIdentityProvider
} from "./api-key";

const opened: HorizonboundDatabase[] = [];

async function setup(provider?: LinearApiKeyIdentityProvider) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "horizonbound-api-key-"));
  const database = openDatabase(path.join(directory, "state.sqlite"));
  opened.push(database);
  const service = new LinearApiKeyService({
    database,
    provider:
      provider ??
      ({
        getIdentity: vi.fn(async () => ({
          user: { id: "user-1", name: "Ada" },
          workspace: { id: "workspace-1", name: "Example Workspace" }
        }))
      } satisfies LinearApiKeyIdentityProvider),
    apiKey: "lin_api_private-value",
    now: () => 1_000,
    randomToken: () => "session-value"
  });
  return { database, service };
}

afterEach(() => {
  for (const database of opened.splice(0)) database.close();
});

describe("LinearApiKeyService", () => {
  it("bootstraps identity and an opaque local session without persisting the key", async () => {
    const { database, service } = await setup();

    const connected = await service.connect();

    expect(connected).toEqual({
      sessionToken: "session-value",
      connectionId: "linear:workspace-1",
      workspaceName: "Example Workspace"
    });
    expect(service.verifySession("session-value")).toMatchObject({
      workspaceName: "Example Workspace",
      linearUserName: "Ada",
      credentialMode: "api_key"
    });
    expect(
      JSON.stringify(database.sqlite.prepare("SELECT * FROM connections").get())
    ).not.toContain("lin_api_private-value");
  });

  it("preserves dormant OAuth tokens when the same workspace switches to API-key mode", async () => {
    const { database, service } = await setup();
    database.sqlite
      .prepare(
        `INSERT INTO connections (
           id, linear_user_id, workspace_id, workspace_name, credential_mode,
           access_token_ciphertext, refresh_token_ciphertext, expires_at, granted_scope,
           created_at, updated_at
         ) VALUES ('linear:workspace-1', 'user-1', 'workspace-1', 'Example Workspace',
                   'oauth', 'encrypted-access', 'encrypted-refresh', 999999, 'read', 1, 1)`
      )
      .run();

    await service.connect();

    expect(
      database.sqlite
        .prepare(
          "SELECT credential_mode AS credentialMode, access_token_ciphertext AS accessToken, refresh_token_ciphertext AS refreshToken FROM connections"
        )
        .get()
    ).toEqual({
      credentialMode: "api_key",
      accessToken: "encrypted-access",
      refreshToken: "encrypted-refresh"
    });
  });

  it("ends local sessions without claiming to revoke the configured key", async () => {
    const { service } = await setup();
    const connected = await service.connect();

    await service.endSession(connected.sessionToken);

    expect(service.verifySession(connected.sessionToken)).toBeUndefined();
  });
});

describe("LinearHttpApiKeyIdentityProvider", () => {
  it("uses a bare authorization header and returns the viewer identity", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            viewer: {
              id: "user-1",
              name: "Ada",
              organization: { id: "workspace-1", name: "Example Workspace" }
            }
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const provider = new LinearHttpApiKeyIdentityProvider(fetcher);

    await expect(provider.getIdentity("lin_api_private-value")).resolves.toEqual({
      user: { id: "user-1", name: "Ada" },
      workspace: { id: "workspace-1", name: "Example Workspace" }
    });
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("authorization")).toBe(
      "lin_api_private-value"
    );
  });

  it("returns only a sanitized error when Linear rejects the key", async () => {
    const provider = new LinearHttpApiKeyIdentityProvider(
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ errors: [{ message: "private provider detail" }] }), {
          status: 401
        })
      )
    );

    await expect(provider.getIdentity("lin_api_private-value")).rejects.toThrow(
      "Linear API key is invalid, revoked, or insufficiently scoped"
    );
  });
});
