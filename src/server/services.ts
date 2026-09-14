import path from "node:path";
import { LinearApiKeyService, LinearHttpApiKeyIdentityProvider } from "@/auth/api-key";
import { LinearHttpOAuthProvider } from "@/auth/linear-http-oauth-provider";
import { LinearOAuthService } from "@/auth/oauth";
import { TokenCipher } from "@/auth/token-cipher";
import { loadRuntimeConfig } from "@/config/runtime";
import { openDatabase, type HorizonboundDatabase } from "@/db/database";

let database: HorizonboundDatabase | undefined;
let oauthService: LinearOAuthService | undefined;
let apiKeyService: LinearApiKeyService | undefined;

export type LinearCredentialMode = "api_key" | "oauth";

export function linearCredentialMode(
  env: Record<string, string | undefined> = process.env
): LinearCredentialMode | null {
  if (env.LINEAR_API_KEY?.trim()) return "api_key";
  return env.LINEAR_CLIENT_ID && env.TOKEN_ENCRYPTION_KEY && env.APP_BASE_URL ? "oauth" : null;
}

export function getDatabase() {
  if (!database) {
    const config = loadRuntimeConfig(process.env);
    database = openDatabase(path.join(config.stateDirectory, "horizonbound.sqlite"));
  }
  return database;
}

export function oauthIsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return linearCredentialMode({ ...env, LINEAR_API_KEY: undefined }) === "oauth";
}

export function getApiKeyService() {
  const apiKey = process.env.LINEAR_API_KEY?.trim();
  if (!apiKey) throw new Error("LINEAR_API_KEY is not configured");
  if (apiKeyService) return apiKeyService;
  apiKeyService = new LinearApiKeyService({
    database: getDatabase(),
    provider: new LinearHttpApiKeyIdentityProvider(),
    apiKey
  });
  return apiKeyService;
}

export function getOAuthService() {
  const config = loadRuntimeConfig(process.env);
  if (!process.env.LINEAR_CLIENT_ID) throw new Error("LINEAR_CLIENT_ID is not configured");
  if (!process.env.TOKEN_ENCRYPTION_KEY) throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY, "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must encode exactly 32 bytes");

  if (oauthService) return oauthService;
  oauthService = new LinearOAuthService({
    database: getDatabase(),
    provider: new LinearHttpOAuthProvider({
      clientId: process.env.LINEAR_CLIENT_ID,
      clientSecret: process.env.LINEAR_CLIENT_SECRET
    }),
    cipher: new TokenCipher(key),
    clientId: process.env.LINEAR_CLIENT_ID,
    authorizeUrl: "https://linear.app/oauth/authorize",
    redirectUri: new URL("/api/auth/linear/callback", config.appBaseUrl).toString()
  });
  return oauthService;
}
