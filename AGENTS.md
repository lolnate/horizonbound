# Project Guidance

Horizonbound is a capacity-aware roadmap forecasting application for Linear. It is early-stage software for lightweight product and engineering planning; do not assume enterprise workflows or multi-tenant requirements.

## Before Changing Code

- Read `docs/architecture.md` for system boundaries and current behavior.
- Read `docs/development.md` for setup, commands, and development conventions.
- Read relevant records in `docs/decisions/` before changing an established architectural choice.

## Working Agreements

- Keep Linear read-only and authoritative for projects, issues, teams, labels, and statuses.
- Keep Horizonbound planning judgments, including forecasts and capacity choices, local.
- Preserve generation-based sync publication: failed or partial refreshes must not replace the last complete snapshot.
- Use synthetic data in tests. Never log or commit credentials, tokens, provider payloads, or real workspace data.
- Add database changes through Drizzle schema updates and new migrations; do not rewrite applied migrations.
- Prefer focused domain functions and repository tests for planning calculations and persistence behavior.
- Run the narrowest relevant checks while developing and `npm run check` before considering a substantial change complete.

## Documentation

Treat `docs/` as durable project memory for future agents and sessions. Update it in the same change whenever architecture, setup, operational behavior, data ownership, or important constraints change. Add a numbered decision record for choices that constrain future implementation; do not use decision records for routine code changes.

Keep documentation factual. Clearly label proposed work and do not describe planned features as implemented.
