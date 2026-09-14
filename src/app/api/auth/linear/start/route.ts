import { headers } from "next/headers";
import { NextResponse } from "next/server";
import {
  assertSameOrigin,
  OAUTH_CORRELATION_COOKIE,
  SESSION_COOKIE,
  sessionCookieOptions
} from "@/auth/web-security";
import { apiKeyRuntimeAllowed, loadRuntimeConfig } from "@/config/runtime";
import { refreshConnection } from "@/server/refresh";
import { getApiKeyService, getOAuthService, linearCredentialMode } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const config = loadRuntimeConfig(process.env);
  try {
    if (linearCredentialMode() !== "oauth") {
      return NextResponse.json({ error: "OAuth is not configured" }, { status: 405 });
    }
    const started = getOAuthService().beginConnection();
    const response = NextResponse.redirect(started.authorizationUrl);
    response.cookies.set(OAUTH_CORRELATION_COOKIE, started.correlationCookie, {
      ...sessionCookieOptions(config.appBaseUrl),
      maxAge: 10 * 60
    });
    return response;
  } catch {
    const destination = new URL(config.appBaseUrl);
    destination.searchParams.set("auth", "failed");
    return NextResponse.redirect(destination);
  }
}

export async function POST() {
  const config = loadRuntimeConfig(process.env);
  try {
    const headerStore = await headers();
    assertSameOrigin(headerStore.get("origin"), config.appBaseUrl);
    if (!apiKeyRuntimeAllowed(config)) {
      throw new Error("Personal API-key mode requires a loopback-only runtime");
    }
    if (linearCredentialMode() !== "api_key") {
      return NextResponse.json({ error: "Personal API key is not configured" }, { status: 405 });
    }
    const connected = await getApiKeyService().connect();
    let syncFailed = false;
    try {
      await refreshConnection(connected.connectionId, null, "launch");
    } catch {
      syncFailed = true;
    }
    const destination = new URL(config.appBaseUrl);
    if (syncFailed) destination.searchParams.set("sync", "failed");
    const response = NextResponse.redirect(destination, 303);
    response.cookies.set(
      SESSION_COOKIE,
      connected.sessionToken,
      sessionCookieOptions(config.appBaseUrl)
    );
    return response;
  } catch {
    const destination = new URL(config.appBaseUrl);
    destination.searchParams.set("auth", "failed");
    return NextResponse.redirect(destination, 303);
  }
}
