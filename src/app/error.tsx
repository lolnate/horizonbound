"use client";

export default function ErrorPage({
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="shell">
      <div role="alert" className="network-warning">
        Horizonbound could not complete that operation. Review the entered values and connection
        state, then try again. Cached data has not been replaced by a partial refresh.
      </div>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
