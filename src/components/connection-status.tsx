interface ConnectionStatusProps {
  credentialMode: "api_key" | "oauth";
  syncFailed: boolean;
}

export function ConnectionStatus({ credentialMode, syncFailed }: ConnectionStatusProps) {
  return (
    <>
      {syncFailed ? (
        <div className="network-warning" role="alert">
          Linear source sync failed. Cached data remains available, but the current credential may
          be missing required read access.
        </div>
      ) : null}
      <p className="muted">
        Connected with {credentialMode === "api_key" ? "a personal API key" : "OAuth"}.
        {credentialMode === "api_key"
          ? " Ending the local session does not revoke or remove the key from operator configuration."
          : ""}
      </p>
    </>
  );
}
