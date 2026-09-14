import { NextResponse } from "next/server";
import { OAUTH_CORRELATION_COOKIE, sessionCookieOptions } from "@/auth/web-security";
import { loadRuntimeConfig } from "@/config/runtime";
import { getOAuthService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = loadRuntimeConfig(process.env);
    const started = getOAuthService().beginConnection();
    const response = NextResponse.redirect(started.authorizationUrl);
    response.cookies.set(OAUTH_CORRELATION_COOKIE, started.correlationCookie, {
      ...sessionCookieOptions(config.appBaseUrl),
      maxAge: 10 * 60
    });
    return response;
  } catch {
    return NextResponse.json({ error: "Linear OAuth is not configured" }, { status: 503 });
  }
}
