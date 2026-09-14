import { AppShell } from "@/components/app-shell";
import { LaunchRefresh } from "@/components/launch-refresh";
import { PlanSetup } from "@/components/plan-setup";
import { RoadmapView } from "@/components/roadmap-view";
import { isLoopbackHost } from "@/config/runtime";
import { getPlan } from "@/db/plan-repository";
import { getRoadmap } from "@/db/roadmap-repository";
import { currentSession } from "@/server/session";
import { getDatabase, oauthIsConfigured } from "@/server/services";
import { refreshPlanAction, saveForecastAction, savePlanAction } from "./actions";

export const dynamic = "force-dynamic";

const networkWarning =
  process.env.HOST && !isLoopbackHost(process.env.HOST)
    ? "Horizonbound has no front-door authentication yet. Network peers may be able to reach this application and its cached roadmap data."
    : null;

export default async function Home({
  searchParams
}: {
  searchParams: Promise<{ disconnected?: string; revocation?: string }>;
}) {
  const query = await searchParams;
  const session = await currentSession();
  if (!session) {
    return (
      <AppShell
        nonLoopbackWarning={networkWarning}
        oauthConfigured={oauthIsConfigured()}
        notice={
          query.disconnected === "retained"
            ? `Linear disconnected. Cached local data remains in the configured state directory; stop Horizonbound and delete that directory to remove it.${query.revocation === "failed" ? " Provider revocation could not be confirmed, but local credentials were removed." : ""}`
            : undefined
        }
      />
    );
  }

  const database = getDatabase();
  const planRow = database.sqlite
    .prepare("SELECT id FROM plans WHERE connection_id = ? ORDER BY created_at LIMIT 1")
    .get(session.connectionId) as { id: string } | undefined;

  if (!planRow) {
    const generation = database.sqlite
      .prepare(
        `SELECT id FROM sync_generations
         WHERE connection_id = ? AND status = 'published'
         ORDER BY promoted_at DESC LIMIT 1`
      )
      .get(session.connectionId) as { id: string } | undefined;
    if (!generation) {
      return (
        <main className="shell">
          {networkWarning ? (
            <div className="network-warning" role="alert">
              {networkWarning}
            </div>
          ) : null}
          <h1>Preparing Linear source choices</h1>
          <p>
            The connection is saved, but its source configuration has not completed a successful
            refresh.
          </p>
          <LaunchRefresh />
        </main>
      );
    }
    const teams = database.sqlite
      .prepare(
        "SELECT linear_id AS id, name FROM source_teams WHERE generation_id = ? ORDER BY name"
      )
      .all(generation.id) as Array<{ id: string; name: string }>;
    const labels = database.sqlite
      .prepare(
        "SELECT linear_id AS id, name FROM source_labels WHERE generation_id = ? ORDER BY name"
      )
      .all(generation.id) as Array<{ id: string; name: string }>;
    const statuses = database.sqlite
      .prepare(
        "SELECT linear_id AS id, name, team_id AS teamId FROM source_statuses WHERE generation_id = ? ORDER BY name"
      )
      .all(generation.id) as Array<{ id: string; name: string; teamId: string | null }>;
    return (
      <>
        {networkWarning ? (
          <div className="network-warning" role="alert">
            {networkWarning}
          </div>
        ) : null}
        <LaunchRefresh />
        <PlanSetup
          workspaceName={session.workspaceName}
          userName={session.linearUserName || session.linearUserId}
          teams={teams}
          labels={labels}
          statuses={statuses}
          saveAction={savePlanAction}
        />
      </>
    );
  }

  const plan = getPlan(database, planRow.id);
  const roadmap = getRoadmap(database, planRow.id);
  if (!plan || !roadmap) {
    return (
      <main className="shell">
        <h1>Cached roadmap unavailable</h1>
        <p>
          The last complete source generation is unavailable. Run a refresh after checking the
          connection.
        </p>
      </main>
    );
  }

  return (
    <>
      {networkWarning ? (
        <div className="network-warning" role="alert">
          {networkWarning}
        </div>
      ) : null}
      {session.reconnectRequired ? (
        <div className="network-warning" role="alert">
          Linear must be reconnected. Cached roadmap data remains visible.
        </div>
      ) : (
        <LaunchRefresh />
      )}
      <RoadmapView
        roadmap={roadmap}
        operatorName={session.linearUserName || session.linearUserId}
        lanes={plan.lanes}
        refreshAction={refreshPlanAction}
        saveForecastAction={saveForecastAction}
      />
      <form action="/api/auth/linear/disconnect" method="post" className="toolbar">
        <button type="submit" className="secondary">
          Disconnect Linear
        </button>
      </form>
    </>
  );
}
