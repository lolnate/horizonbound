# 001: Use SQLite for Local-First Persistence

- Status: Accepted
- Date recorded: 2026-10-01

## Context

Horizonbound currently targets lightweight, single-user or small-team installations and supports one Linear workspace per installation. It needs durable storage for synchronized Linear data, local forecasts, revision history, sessions, and synchronization state without requiring separate infrastructure.

## Decision

Use SQLite as the application database through `better-sqlite3`. Use Drizzle to declare the schema and apply ordered migrations. Store runtime state outside the repository in a private state directory.

Enable foreign keys, WAL mode, and a busy timeout. Restrict the state directory and database file permissions. Apply migrations before production startup and recover interrupted synchronization state when opening the database.

## Rationale

SQLite keeps local setup and operation simple, supports transactional generation publication, and is sufficient for the current single-service deployment model. A network database would add operational complexity without solving a current product requirement.

## Consequences

- The application can run without a separate database service.
- Persistence and synchronization code may rely on SQLite transactions and constraints.
- Horizontal scaling and concurrent application replicas are not current assumptions.
- State-directory backup and deletion are operator responsibilities.
- A future move to PostgreSQL or another shared database requires a new decision record and a deliberate migration plan; do not add compatibility abstractions preemptively.
