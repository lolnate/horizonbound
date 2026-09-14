export const SESSION_COOKIE = "horizonbound_session";
export const OAUTH_CORRELATION_COOKIE = "horizonbound_oauth";

export function sessionCookieOptions(baseUrl: URL) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: baseUrl.protocol === "https:",
    path: "/",
    maxAge: 30 * 24 * 60 * 60
  };
}

export function assertSameOrigin(origin: string | null, baseUrl: URL): void {
  if (!origin) throw new Error("Origin header is required for this request");
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error("Request origin is invalid");
  }
  if (parsed.origin !== baseUrl.origin)
    throw new Error("Request origin does not match APP_BASE_URL");
}
