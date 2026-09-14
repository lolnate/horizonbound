import { healthStatus } from "./health";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(healthStatus(), {
    headers: { "Cache-Control": "no-store" }
  });
}
