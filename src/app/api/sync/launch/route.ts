import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin } from "@/auth/web-security";
import { loadRuntimeConfig } from "@/config/runtime";
import { LaunchRefreshCoordinator } from "@/server/launch-refresh";
import { refreshConnection } from "@/server/refresh";
import { requireSession } from "@/server/session";
import { getDatabase } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const coordinator = new LaunchRefreshCoordinator((connectionId, planId) =>
  refreshConnection(connectionId, planId, "launch")
);

export async function POST(request: NextRequest) {
  const config = loadRuntimeConfig(process.env);
  try {
    assertSameOrigin(request.headers.get("origin"), config.appBaseUrl);
    const session = await requireSession();
    const plan = getDatabase()
      .sqlite.prepare("SELECT id FROM plans WHERE connection_id = ? ORDER BY created_at LIMIT 1")
      .get(session.connectionId) as { id: string } | undefined;
    const requested = await coordinator.request(session.connectionId, plan?.id ?? null);
    return NextResponse.json({ requested });
  } catch {
    return NextResponse.json(
      { error: "Source refresh failed; cached data remains available" },
      { status: 503 }
    );
  }
}
