interface AppShellProps {
  nonLoopbackWarning: string | null;
  oauthConfigured: boolean;
  notice?: string;
}

export function AppShell({ nonLoopbackWarning, oauthConfigured, notice }: AppShellProps) {
  return (
    <main className="shell">
      {nonLoopbackWarning ? (
        <div role="alert" className="network-warning">
          {nonLoopbackWarning}
        </div>
      ) : null}
      {notice ? (
        <p role="status" className="notice">
          {notice}
        </p>
      ) : null}
      <header className="masthead">
        <div>
          <p className="eyebrow">Capacity-aware planning for Linear</p>
          <h1>Horizonbound</h1>
        </div>
        <span className="connection-state">Not connected to Linear</span>
      </header>
      <section className="empty-state" aria-labelledby="getting-started">
        <p className="kicker">Your roadmap, grounded in source data</p>
        <h2 id="getting-started">Connect a workspace to get started</h2>
        <p>
          Horizonbound keeps Linear authoritative for delivery while adding explicit forecasts,
          capacity lanes, and portfolio decisions.
        </p>
        {oauthConfigured ? (
          <a className="button" href="/api/auth/linear/start">
            Connect Linear
          </a>
        ) : (
          <button type="button" disabled aria-describedby="oauth-note">
            Connect Linear
          </button>
        )}
        <p id="oauth-note" className="muted">
          {oauthConfigured
            ? "Linear will request read-only access."
            : "OAuth configuration is required before connection can be enabled."}
        </p>
      </section>
    </main>
  );
}
