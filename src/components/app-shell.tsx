interface AppShellProps {
  nonLoopbackWarning: string | null;
  credentialMode: "api_key" | "oauth" | null;
  notice?: string;
}

export function AppShell({ nonLoopbackWarning, credentialMode, notice }: AppShellProps) {
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
        {credentialMode === "api_key" ? (
          <form action="/api/auth/linear/start" method="post">
            <button type="submit">Connect Linear</button>
          </form>
        ) : credentialMode === "oauth" ? (
          <a className="button" href="/api/auth/linear/start">
            Connect Linear
          </a>
        ) : (
          <button type="button" disabled aria-describedby="credential-note">
            Connect Linear
          </button>
        )}
        <p id="credential-note" className="muted">
          {credentialMode === "api_key"
            ? "Horizonbound will use the configured personal API key. The key stays server-side."
            : credentialMode === "oauth"
              ? "Linear will request read-only access."
              : "A personal API key or OAuth configuration is required before connection can be enabled."}
        </p>
      </section>
    </main>
  );
}
