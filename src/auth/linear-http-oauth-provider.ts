import { z } from "zod";
import type { LinearOAuthProvider, OAuthTokenResponse } from "./oauth";

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive(),
  scope: z.string().min(1)
});

const viewerResponseSchema = z.object({
  data: z.object({
    viewer: z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      organization: z.object({ id: z.string().min(1), name: z.string().min(1) })
    })
  }),
  errors: z.never().optional()
});

interface ProviderOptions {
  fetcher?: typeof fetch;
  now?: () => number;
  clientId?: string;
  clientSecret?: string;
  tokenUrl?: string;
  revokeUrl?: string;
  graphqlUrl?: string;
}

export class LinearHttpOAuthProvider implements LinearOAuthProvider {
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly tokenUrl: string;
  private readonly revokeUrl: string;
  private readonly graphqlUrl: string;

  constructor(private readonly options: ProviderOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
    this.tokenUrl = options.tokenUrl ?? "https://api.linear.app/oauth/token";
    this.revokeUrl = options.revokeUrl ?? "https://api.linear.app/oauth/revoke";
    this.graphqlUrl = options.graphqlUrl ?? "https://api.linear.app/graphql";
  }

  async exchangeCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    clientId: string;
  }): Promise<OAuthTokenResponse> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: input.clientId,
      code_verifier: input.codeVerifier
    });
    if (this.options.clientSecret) body.set("client_secret", this.options.clientSecret);

    const token = await this.requestToken(body);
    const identityResponse = await this.fetcher(this.graphqlUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query: "query HorizonboundViewer { viewer { id name organization { id name } } }"
      }),
      signal: AbortSignal.timeout(30_000)
    });
    if (!identityResponse.ok)
      throw new Error(`Linear identity request failed (${identityResponse.status})`);
    const identityJson: unknown = await identityResponse.json();
    if (
      typeof identityJson === "object" &&
      identityJson !== null &&
      "errors" in identityJson &&
      Array.isArray((identityJson as { errors?: unknown }).errors) &&
      (identityJson as { errors: unknown[] }).errors.length > 0
    ) {
      throw new Error("Linear GraphQL identity response contained errors");
    }
    const identity = viewerResponseSchema.parse(identityJson).data.viewer;

    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: this.now() + token.expires_in * 1000,
      scope: token.scope,
      user: { id: identity.id, name: identity.name },
      workspace: { id: identity.organization.id, name: identity.organization.name }
    };
  }

  async refreshToken(refreshToken: string) {
    const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken });
    if (this.options.clientId) body.set("client_id", this.options.clientId);
    if (this.options.clientSecret) body.set("client_secret", this.options.clientSecret);
    const token = await this.requestToken(body);
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: this.now() + token.expires_in * 1000,
      scope: token.scope
    };
  }

  async revokeToken(accessToken: string): Promise<void> {
    const response = await this.fetcher(this.revokeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: accessToken }),
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) throw new Error(`Linear token revocation failed (${response.status})`);
  }

  private async requestToken(body: URLSearchParams) {
    const response = await this.fetcher(this.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) throw new Error(`Linear OAuth token request failed (${response.status})`);
    return tokenResponseSchema.parse(await response.json());
  }
}
