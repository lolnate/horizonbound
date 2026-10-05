# 003: Support API-Key and OAuth Connections

- Status: Accepted
- Date recorded: 2026-10-01

## Context

The initial product needs a low-friction local connection for one operator while retaining an authentication path suitable for a network-accessible deployment. The application does not yet have independent front-door user authentication.

## Decision

Support two mutually selected Linear credential modes:

- Prefer a read-only personal API key when `LINEAR_API_KEY` is configured. Keep the key in server process configuration and do not copy it into SQLite. Restrict personal-key connection bootstrap to loopback use.
- Otherwise support Linear OAuth with authorization-code flow, PKCE S256, state correlation, and read scope. Encrypt OAuth access tokens, refresh tokens, and PKCE verifiers at rest.

Create opaque 30-day application sessions and persist only their hashes. Support one Linear workspace per Horizonbound installation.

## Rationale

The API-key path minimizes setup for local pilots. OAuth provides revocation and refresh behavior for deployments that register a Linear application. Both modes maintain the read-only integration boundary.

## Consequences

- If both modes are configured, API-key mode takes precedence.
- Ending an API-key-backed application session does not revoke or delete the operator-managed key or cached data.
- OAuth disconnect attempts provider revocation, removes local provider tokens and sessions, and retains cached roadmap data.
- Network-exposed deployments require an external access boundary until Horizonbound adds front-door authentication.
- Supporting multiple workspaces, users, or tenants requires revisiting session and connection assumptions.
