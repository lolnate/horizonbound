import os from "node:os";
import path from "node:path";
import { z } from "zod";

const portSchema = z.coerce.number().int().min(1).max(65535);

export interface RuntimeConfig {
  host: string;
  port: number;
  appBaseUrl: URL;
  stateDirectory: string;
  nonLoopbackWarning: string | null;
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "::1" || normalized.startsWith("127.");
}

function parseBaseUrl(value: string | undefined): URL {
  if (!value) {
    throw new Error("APP_BASE_URL is required and must be the browser-visible application origin");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("APP_BASE_URL must be a valid absolute URL");
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "APP_BASE_URL must be an HTTP(S) origin without credentials, query, or fragment"
    );
  }

  const normalizedHost = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalizedHost === "0.0.0.0" || normalizedHost === "::") {
    throw new Error(
      "APP_BASE_URL must use a browser-visible host, not an unspecified listener address"
    );
  }

  if (url.pathname !== "/") {
    throw new Error("APP_BASE_URL must be an origin without an application path");
  }
  return url;
}

export function loadRuntimeConfig(env: Record<string, string | undefined>): RuntimeConfig {
  const host = env.HOST?.trim() || "127.0.0.1";
  const appBaseUrl = parseBaseUrl(env.APP_BASE_URL);
  const defaultPort = appBaseUrl.port || (appBaseUrl.protocol === "https:" ? "443" : "80");
  const parsedPort = portSchema.safeParse(env.PORT ?? defaultPort);

  if (!parsedPort.success) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  const stateDirectory = path.resolve(
    /* turbopackIgnore: true */
    env.HORIZONBOUND_STATE_DIR?.replace(/^~(?=$|\/)/, os.homedir()) ??
      path.join(env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "horizonbound")
  );

  return {
    host,
    port: parsedPort.data,
    appBaseUrl,
    stateDirectory,
    nonLoopbackWarning: isLoopbackHost(host)
      ? null
      : "Horizonbound has no dedicated front-door access authentication. This listener may expose roadmap data and connection operations to network peers."
  };
}
