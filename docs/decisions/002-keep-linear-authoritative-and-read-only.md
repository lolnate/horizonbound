# 002: Keep Linear Authoritative and Read-Only

- Status: Accepted
- Date recorded: 2026-10-01

## Context

Teams already manage projects, issues, estimates, statuses, labels, and delivery progress in Linear. Horizonbound exists to add forecasting and capacity planning, not to replace issue tracking or create competing copies of delivery facts.

## Decision

Treat Linear as authoritative for source work and request read-only access. Normalize the required Linear records into generation-scoped local cache tables. Store Horizonbound-specific judgments, such as plan capacity, lane allocation, forecasts, and forecast revisions, separately and never write them back to Linear.

Publish source refreshes atomically by generation. A failed or partial refresh must leave the last complete published generation available.

## Rationale

The boundary reduces integration risk, avoids conflicting edits, preserves existing team workflows, and makes it clear which system owns each fact. Generation publication allows forecasting to continue from a consistent cached snapshot during provider or network failures.

## Consequences

- Horizonbound can derive and display source facts but cannot correct them in Linear.
- Planning judgments remain available across Linear refreshes and reconnects.
- Features that appear to change Linear data must instead link users to Linear or require a future explicit reversal of this decision.
- Forecast saves must protect against stale source generations and aggregates.
- Tests must verify that partial synchronization never replaces complete cached data.
