export function healthStatus() {
  return { status: "ok", service: "horizonbound" } as const;
}
