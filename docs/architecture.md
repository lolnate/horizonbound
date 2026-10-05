# Architecture

## Purpose

Horizonbound augments Linear with capacity-aware roadmap forecasting for small product and engineering teams. Linear remains the delivery system of record. Horizonbound synchronizes selected Linear data and adds local forecasts, capacity assumptions, and planning history without writing back to Linear.

The application is under active development and currently supports one Linear workspace and effectively one plan per installation through the UI.

## Technology

- Node.js 22 or newer
- Next.js App Router with React and TypeScript
- SQLite through `better-sqlite3`
- Drizzle for schema definitions and migrations
- Zod for runtime and domain validation
- Vitest and Testing Library for unit, integration, and component tests
- Playwright for the production-mode browser journey

The application is a single Next.js service. There is no separate API service, worker process, or job queue.

## System Boundaries

### Linear-owned facts

Linear is authoritative for:

- workspaces and users;
- teams, project labels, and project statuses;
- projects and project metadata;
- issues, issue state, hierarchy, and estimates.

The integration requests read-only access. Synced data is treated as a cache and is replaced only by a successfully published synchronization generation.

### Horizonbound-owned judgments

Horizonbound is authoritative for:

- plan horizon and weekly capacity;
- capacity lanes and their allocations;
- project forecast ranges and horizon share;
- estimate confidence and basis;
- forecast revision reasons and source baselines.

These records survive source refreshes and are never written back to Linear.

## Application Structure

| Path              | Responsibility                                                 |
| ----------------- | -------------------------------------------------------------- |
| `src/app/`        | Next.js pages, route handlers, and server actions              |
| `src/components/` | Setup, connection, and roadmap user interfaces                 |
| `src/domain/`     | Pure planning validation and calculations                      |
| `src/db/`         | Schema, database lifecycle, repositories, and sync persistence |
| `src/sync/`       | Linear GraphQL adapter and full reconciliation workflow        |
| `src/auth/`       | API-key sessions, OAuth, token encryption, and web security    |
| `src/config/`     | Runtime configuration parsing and validation                   |
| `src/server/`     | Service construction, sessions, and refresh coordination       |
| `drizzle/`        | Ordered SQLite migrations                                      |
| `scripts/`        | Production startup, migration, smoke, and restart checks       |

The root page in `src/app/page.tsx` is the current application state coordinator. It renders connection, source preparation, plan setup, or roadmap state based on the session and locally published data.

## Data Model

The schema in `src/db/schema.ts` has five main groups:

- Identity and security: connections, application sessions, and OAuth state.
- Planning: plans and capacity lanes.
- Synchronization: generations, runs, and leases.
- Linear cache: teams, labels, statuses, projects, project relationships, issues, and derived project aggregates.
- Local forecasts: current project forecasts and append-only forecast revisions.

SQLite runtime state lives outside the repository. The configured state directory is private, the database file is private, foreign keys are enabled, and WAL mode is used. See [ADR 001](decisions/001-use-sqlite-for-local-first-persistence.md).

## Synchronization

Synchronization is a full, generation-based reconciliation:

1. Acquire a per-connection lease.
2. Create a staging generation and sync run.
3. Page through Linear configuration, projects, and issues.
4. Normalize records and calculate project issue aggregates.
5. Atomically publish the complete generation and point plans at it.
6. Discard the staging generation on failure and retain the previously published snapshot.

On startup, interrupted sync runs are marked interrupted, staging generations are discarded, and stale leases are removed. Cached roadmap data remains usable when a later refresh fails or OAuth requires reconnection.

Project membership currently requires the configured workspace, team, and membership label. The configured commitment status is stored but does not currently filter membership or create a commitment workflow.

## Forecasting

Issue aggregation currently derives:

- completed actual points from completed estimated issues;
- detailed open points from open estimated issues;
- a count of open unestimated issues;
- a warning when estimated parent and child issues may both be counted.

Canceled issues are excluded. Unestimated work is reported rather than treated as zero.

A project forecast combines source-derived work with a user-authored low, expected, and high estimate for unrefined work. Remaining expected and high work are multiplied by the configured horizon share and rounded up to produce horizon demand. Forecast saves append immutable revisions containing the source aggregate and lifetime-range baseline at that point in time.

## Authentication and Exposure

The application supports two Linear credential modes:

- A read-only personal API key for a single-user local installation. The key remains in server process configuration and is not stored in SQLite.
- OAuth with PKCE and read scope. Provider tokens are encrypted at rest and refreshed server-side.

Application sessions use opaque, hashed tokens in HttpOnly cookies. The application currently has no independent front-door user authentication. Personal-key bootstrap is therefore restricted to loopback use, and OAuth-backed network deployments require an external access boundary. See [ADR 003](decisions/003-support-api-key-and-oauth-connections.md).

## Current Product Surface

Implemented behavior includes:

- connecting one Linear workspace;
- selecting plan source scope and capacity assumptions;
- synchronizing matching projects and their issues;
- displaying source-derived project work totals and estimate warnings;
- authoring forecast ranges, lane assignment, horizon share, and revision rationale;
- retaining a revision history and cached roadmap through refresh failures.

The current roadmap is an alphabetical project-card list. Capacity settings and lane assignments are stored but are not yet used to calculate portfolio fit or completion timing.

## Next Planned Slice

The next intended slice is **sequenced lane fit**. This is proposed, not implemented.

The slice should connect existing forecasts and lanes by adding project sequence within a lane, calculating cumulative expected and high horizon demand against lane capacity, and rendering fit or overflow. It should avoid dependencies, drag-and-drop, commitment workflow, or probabilistic scheduling until this simpler model has been validated.
