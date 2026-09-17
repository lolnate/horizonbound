import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
  OAUTH_CORRELATION_COOKIE,
  SESSION_COOKIE,
  sessionCookieOptions
} from "@/auth/web-security";
import { loadRuntimeConfig } from "@/config/runtime";
import { refreshConnection } from "@/server/refresh";
import { getDatabase, getOAuthService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const config = loadRuntimeConfig(process.env);
  const safeFailure = () => NextResponse.redirect(new URL("/?auth=failed", config.appBaseUrl));
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const cookieStore = await cookies();
  const correlationCookie = cookieStore.get(OAUTH_CORRELATION_COOKIE)?.value;
  if (!code || !state || !correlationCookie || request.nextUrl.searchParams.has("error")) {
    return safeFailure();
  }

  try {
    const service = getOAuthService();
    const completed = await service.completeConnection({ code, state, correlationCookie });
    const session = service.verifySession(completed.sessionToken) as
      { connectionId: string } | undefined;
    if (!session) throw new Error("Connected session could not be established");
    const plan = getDatabase()
      .sqlite.prepare("SELECT id FROM plans WHERE connection_id = ? ORDER BY created_at LIMIT 1")
      .get(session.connectionId) as { id: string } | undefined;
    let syncFailed = false;
    try {
      await refreshConnection(session.connectionId, plan?.id ?? null, "launch");
    } catch {
      syncFailed = true;
    }
    const destination = new URL(config.appBaseUrl);
    if (syncFailed) destination.searchParams.set("sync", "failed");
    const response = NextResponse.redirect(destination);
    response.cookies.set(
      SESSION_COOKIE,
      completed.sessionToken,
      sessionCookieOptions(config.appBaseUrl)
    );
    response.cookies.delete(OAUTH_CORRELATION_COOKIE);
    return response;
  } catch {
    return safeFailure();
  }
}
