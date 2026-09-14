interface ForecastView {
  unrefinedLow: number;
  unrefinedExpected: number;
  unrefinedHigh: number;
  confidence: string;
  estimateBasis: string;
  forecastAsOfDate: string;
  capacityLaneId: string | null;
  horizonShare: number;
  lifetime: { low: number; expected: number; high: number };
  remaining: { low: number; expected: number; high: number };
  horizonDemand: { expected: number; high: number };
  integrityWarning: string | null;
  refinement: { target: string | null; state: string };
  revisions: Array<{ id: string; category: string; reason: string; createdAt: number }>;
}

interface ProjectView {
  id: string;
  name: string;
  url: string;
  statusName: string | null;
  startDate: string | null;
  completedActual: number;
  detailedOpen: number;
  unestimatedOpenCount: number;
  possibleDoubleCounting: boolean;
  forecast: ForecastView | null;
}

interface RoadmapViewModel {
  id: string;
  name: string;
  workspaceName: string;
  lastSuccessfulSyncAt: number | null;
  latestAttempt: {
    status: string;
    startedAt: number;
    finishedAt?: number | null;
    errorSummary?: string | null;
  } | null;
  projects: ProjectView[];
}

interface RoadmapViewProps {
  roadmap: RoadmapViewModel;
  operatorName: string;
  lanes: Array<{ id: string; name: string }>;
  refreshAction: (formData: FormData) => void | Promise<void>;
  saveForecastAction: (formData: FormData) => void | Promise<void>;
}

const formatTime = (value: number | null) =>
  value === null ? "No successful sync yet" : new Date(value).toLocaleString();

export function RoadmapView({
  roadmap,
  operatorName,
  lanes,
  refreshAction,
  saveForecastAction
}: RoadmapViewProps) {
  const latestFailed = roadmap.latestAttempt?.status === "failed";
  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">
            {operatorName} · {roadmap.workspaceName}
          </p>
          <h1>{roadmap.name}</h1>
          <p className="muted">
            Last successful full sync: {formatTime(roadmap.lastSuccessfulSyncAt)}
          </p>
          <p className="muted">
            Latest attempt: {roadmap.latestAttempt?.status ?? "none"} at{" "}
            {formatTime(roadmap.latestAttempt?.startedAt ?? null)}
          </p>
        </div>
        <form action={refreshAction}>
          <input type="hidden" name="planId" value={roadmap.id} />
          <button type="submit">Refresh Linear data</button>
        </form>
      </header>

      {latestFailed ? (
        <div role="alert" className="network-warning">
          Refresh failed. Showing cached data from the last successful sync at{" "}
          {formatTime(roadmap.lastSuccessfulSyncAt)}.
          {roadmap.latestAttempt?.errorSummary ? ` ${roadmap.latestAttempt.errorSummary}` : ""}
        </div>
      ) : null}

      {roadmap.projects.length === 0 ? (
        <section className="empty-state">
          <h2>No matching projects</h2>
          <p>No projects currently match the selected workspace, team, and membership label.</p>
        </section>
      ) : (
        <div className="project-list">
          {roadmap.projects.map((project) => (
            <article key={project.id} className="project-card">
              <header className="project-heading">
                <div>
                  <p className="kicker">{project.statusName ?? "Status not provided"}</p>
                  <h2>{project.name}</h2>
                </div>
                <a href={project.url} target="_blank" rel="noreferrer">
                  Open in Linear
                </a>
              </header>

              <section aria-labelledby={`${project.id}-source`}>
                <h3 id={`${project.id}-source`}>Linear observations</h3>
                <p className="muted">
                  Observed in full sync: {formatTime(roadmap.lastSuccessfulSyncAt)}
                </p>
                <dl className="metrics">
                  <div>
                    <dt>Completed actual</dt>
                    <dd>{project.completedActual} pts</dd>
                  </div>
                  <div>
                    <dt>Detailed open</dt>
                    <dd>{project.detailedOpen} pts</dd>
                  </div>
                  <div>
                    <dt>Project start</dt>
                    <dd>{project.startDate ?? "Not provided"}</dd>
                  </div>
                </dl>
                {project.unestimatedOpenCount > 0 ? (
                  <p className="warning-text">
                    {project.unestimatedOpenCount} open issue has no estimate. Detailed-open work
                    may be incomplete. You are responsible for ensuring the unrefined forecast
                    accounts for relevant unknown work.
                  </p>
                ) : null}
                {project.possibleDoubleCounting ? (
                  <p className="warning-text">
                    Possible double counting: both parent and child issues carry estimates.
                  </p>
                ) : null}
              </section>

              <fieldset className="forecast-panel">
                <legend>Horizonbound forecast</legend>
                <p className="muted">
                  Horizonbound judgments — these values are stored locally and never written to
                  Linear.
                </p>
                {project.forecast?.integrityWarning ? (
                  <p role="alert" className="warning-text">
                    {project.forecast.integrityWarning}
                  </p>
                ) : null}
                {project.forecast ? (
                  <dl className="metrics">
                    <div>
                      <dt>Lifetime expected</dt>
                      <dd>{project.forecast.lifetime.expected} pts</dd>
                    </div>
                    <div>
                      <dt>Lifetime range</dt>
                      <dd>
                        {project.forecast.lifetime.low} / {project.forecast.lifetime.expected} /{" "}
                        {project.forecast.lifetime.high} points
                      </dd>
                    </div>
                    <div>
                      <dt>Remaining expected</dt>
                      <dd>{project.forecast.remaining.expected} pts</dd>
                    </div>
                    <div>
                      <dt>Horizon expected</dt>
                      <dd>{project.forecast.horizonDemand.expected} pts</dd>
                    </div>
                    <div>
                      <dt>Refinement</dt>
                      <dd>{project.forecast.refinement.state}</dd>
                    </div>
                    <div>
                      <dt>Refinement target</dt>
                      <dd>{project.forecast.refinement.target ?? "Unknown"}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="muted">No planning forecast has been saved.</p>
                )}
                <form action={saveForecastAction} className="forecast-form">
                  <input type="hidden" name="planId" value={roadmap.id} />
                  <input type="hidden" name="projectId" value={project.id} />
                  <label>
                    Unrefined low
                    <input
                      name="unrefinedLow"
                      type="number"
                      min="0"
                      step="1"
                      defaultValue={project.forecast?.unrefinedLow ?? 0}
                      required
                    />
                  </label>
                  <label>
                    Unrefined expected
                    <input
                      name="unrefinedExpected"
                      type="number"
                      min="0"
                      step="1"
                      defaultValue={project.forecast?.unrefinedExpected ?? 0}
                      required
                    />
                  </label>
                  <label>
                    Unrefined high
                    <input
                      name="unrefinedHigh"
                      type="number"
                      min="0"
                      step="1"
                      defaultValue={project.forecast?.unrefinedHigh ?? 0}
                      required
                    />
                  </label>
                  <label>
                    Confidence
                    <select
                      name="confidence"
                      defaultValue={project.forecast?.confidence ?? "medium"}
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </label>
                  <label>
                    Estimate basis
                    <input
                      name="estimateBasis"
                      defaultValue={project.forecast?.estimateBasis ?? "analogy"}
                      required
                    />
                  </label>
                  <label>
                    Forecast as of
                    <input
                      name="forecastAsOfDate"
                      type="date"
                      defaultValue={
                        project.forecast?.forecastAsOfDate ?? new Date().toISOString().slice(0, 10)
                      }
                      required
                    />
                  </label>
                  <label>
                    Capacity lane
                    <select
                      name="capacityLaneId"
                      defaultValue={project.forecast?.capacityLaneId ?? ""}
                      required
                    >
                      <option value="" disabled>
                        Select a lane
                      </option>
                      {lanes.map((lane) => (
                        <option key={lane.id} value={lane.id}>
                          {lane.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Horizon share percent
                    <input
                      name="horizonSharePercent"
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      defaultValue={project.forecast?.horizonShare ?? 100}
                      required
                    />
                  </label>
                  <label>
                    Revision category
                    <select name="category" defaultValue="updated">
                      <option value="initial">Initial</option>
                      <option value="updated">Updated</option>
                      <option value="refined">Refined</option>
                    </select>
                  </label>
                  <label className="wide">
                    Reason
                    <textarea name="reason" required />
                  </label>
                  <button type="submit">Save forecast revision</button>
                </form>
                {project.forecast?.revisions.length ? (
                  <details>
                    <summary>Forecast history ({project.forecast.revisions.length})</summary>
                    <ul>
                      {project.forecast.revisions.map((revision) => (
                        <li key={revision.id}>
                          <strong>{revision.category}</strong> — {revision.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </fieldset>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
