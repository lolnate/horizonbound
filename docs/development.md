# Development

## Prerequisites

- Node.js 22 or newer
- npm
- A read-only Linear personal API key for local use, or a configured Linear OAuth application

Install dependencies and create local configuration:

```bash
npm ci
cp .env.example .env
```

Never commit `.env` or credentials. Ordinary development and tests should use synthetic data; a real Linear connection is not required for the test suite.

## Runtime Configuration

`APP_BASE_URL` is required for production startup. The development defaults and available variables are documented in `.env.example`.

Important variables include:

- `APP_BASE_URL`: browser-visible application origin.
- `HOST` and `PORT`: listener configuration; the default host is loopback.
- `HORIZONBOUND_STATE_DIR`: state directory outside the repository.
- `LINEAR_API_KEY`: preferred single-user local credential.
- `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`, and `TOKEN_ENCRYPTION_KEY`: OAuth configuration.

If both credential modes are configured, the personal API key takes precedence. Do not expose a personal-key installation to an untrusted network.

## Common Commands

| Command                 | Purpose                                                       |
| ----------------------- | ------------------------------------------------------------- |
| `npm run dev`           | Start the Next.js development server                          |
| `npm run build`         | Create a production build                                     |
| `npm start`             | Apply migrations and start the production server              |
| `npm test`              | Run Vitest tests once                                         |
| `npm run test:watch`    | Run Vitest in watch mode                                      |
| `npm run test:coverage` | Run tests with coverage                                       |
| `npm run test:e2e`      | Run the Playwright journey and cached restart proof           |
| `npm run typecheck`     | Run TypeScript without emitting files                         |
| `npm run lint`          | Run ESLint                                                    |
| `npm run format:check`  | Check Prettier formatting                                     |
| `npm run format`        | Apply Prettier formatting                                     |
| `npm run db:generate`   | Generate a migration from schema changes                      |
| `npm run db:migrate`    | Apply migrations to the configured database                   |
| `npm run smoke`         | Test built-server health, migration, restart, and persistence |
| `npm run check`         | Run formatting, lint, typecheck, tests, and build             |

Use focused tests during development. Run `npm run check` before considering a substantial change complete. Changes to startup, persistence, or production behavior may also require `npm run test:e2e` or `npm run smoke`.

## Database Changes

`src/db/schema.ts` is the schema source. Migration files live in `drizzle/` and are applied during production startup.

For schema changes:

1. Update `src/db/schema.ts`.
2. Run `npm run db:generate` to create a new migration.
3. Review the generated SQL and metadata.
4. Add repository or migration tests for constraints and data behavior.
5. Verify upgrade behavior against a temporary database.

Do not edit or reorder an applied migration. Repositories currently use prepared SQL through `better-sqlite3` even though Drizzle owns schema declarations and migration execution; preserve that convention unless intentionally changing the persistence approach.

## Testing Conventions

- Keep domain calculations pure and cover boundaries directly.
- Use temporary SQLite databases for repository and synchronization tests.
- Test failed synchronization paths to ensure the last published generation remains intact.
- Use synthetic Linear identities and records. Never add real workspace names, IDs, payloads, tokens, or cookies to fixtures or snapshots.
- Component tests that require a browser environment opt into jsdom; the default Vitest environment is Node.
- The live Linear contract test is opt-in and must remain read-only. Setup is documented in `README.md`.

## Security and Privacy

- Request only Linear read scope and preserve the no-writeback boundary.
- Keep provider credentials server-side.
- Do not log secrets, raw provider payloads, authorization codes, cookies, or internal workspace data.
- Validate provider responses and user input at runtime.
- Preserve origin checks for unsafe application operations.
- Treat cached roadmap data as private even when provider tokens have been removed.

## Documentation Maintenance

Update `docs/architecture.md` when system boundaries, data flow, major components, current product behavior, or planned-slice status changes. Update this file when setup, commands, test strategy, or operational practices change.

Add a numbered record under `docs/decisions/` when making a consequential choice that future work should not casually reverse. Use the next available three-digit prefix and include status, context, decision, rationale, and consequences. If a decision changes, add a superseding record rather than rewriting history.
