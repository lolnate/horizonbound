"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function LaunchRefresh() {
  const router = useRouter();
  const [status, setStatus] = useState("Requesting source refresh…");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/sync/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal
    })
      .then((response) => {
        if (!response.ok) throw new Error("refresh failed");
        setStatus("Source refresh complete");
        router.refresh();
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatus("Source refresh failed; cached data remains available");
        router.refresh();
      });
    return () => controller.abort();
  }, [router]);

  return (
    <p className="muted" role="status" aria-live="polite">
      {status}
    </p>
  );
}
