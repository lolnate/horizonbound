import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { assertSameOrigin, SESSION_COOKIE } from "@/auth/web-security";
import { loadRuntimeConfig } from "@/config/runtime";
import { getOAuthService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const config = loadRuntimeConfig(process.env);
  const headerStore = await headers();
  try {
    assertSameOrigin(headerStore.get("origin"), config.appBaseUrl);
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(SESSION_COOKIE)?.value;
    if (!sessionToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const disconnect = await getOAuthService().disconnect(sessionToken);
    const destination = new URL(config.appBaseUrl);
    destination.searchParams.set("disconnected", "retained");
    if (disconnect.revocationFailed) destination.searchParams.set("revocation", "failed");
    const response = NextResponse.redirect(destination, 303);
    response.cookies.delete(SESSION_COOKIE);
    return response;
  } catch {
    return NextResponse.json({ error: "Disconnect failed" }, { status: 400 });
  }
}
