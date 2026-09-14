# Horizonbound

Horizonbound is a capacity-aware roadmap forecasting application for Linear. Linear remains authoritative for projects and delivery work; Horizonbound adds explicit forecast ranges, refinement signals, capacity lanes, sequencing, fit, and commitment rationale.

> Horizonbound is under active development. The first vertical slice is not yet ready for production use.

## Local prerequisites

- Node.js 22 or newer
- npm
- A read-only Linear personal API key for a single-user local connection, or a Linear OAuth application for the retained OAuth mode

## Setup

```bash
npm ci
cp .env.example .env
# Set LINEAR_API_KEY to a read-only personal key for local use.
# OAuth mode instead requires LINEAR_CLIENT_ID and a TOKEN_ENCRYPTION_KEY from:
# openssl rand -base64 32
npm run check
```

The production server requires `APP_BASE_URL`. It defaults its listener to `127.0.0.1`, while `HOST`, `PORT`, and `HORIZONBOUND_STATE_DIR` are configurable:

```bash
APP_BASE_URL=http://127.0.0.1:3000 npm run build
APP_BASE_URL=http://127.0.0.1:3000 npm start
```

Runtime state is stored outside the repository. The default on Linux is `~/.local/state/horizonbound`. Ending a personal-key-backed local session retains both the operator-managed key and cached roadmap data; revoke or rotate the key in Linear and remove it from process configuration when needed. OAuth disconnect removes local provider tokens and sessions. Stop Horizonbound and delete the configured state directory when you intentionally want to remove cached data.

### Linear credentials

For a single-user local installation, create a personal API key under **Linear Settings → Security & access → Personal API keys**. Select **Read** permission and the narrowest team scope that exposes the source data Horizonbound needs, then set `LINEAR_API_KEY` in server-side operator configuration. Do not enter the key in the browser or commit it. If both modes are configured, the personal API key takes precedence.

OAuth remains available for deployments that register an application. Its callback must exactly match `${APP_BASE_URL}/api/auth/linear/callback`; Horizonbound requests only Linear's `read` scope.

### Network exposure

You may explicitly bind Horizonbound to a LAN address or `0.0.0.0` for OAuth-backed deployments. The application warns but does not prevent this. Personal API-key connection bootstrap is restricted to a loopback listener and browser-visible origin because the MVP has no dedicated front-door access authentication. Add an appropriate access boundary before exposing Horizonbound to an untrusted network.

## Commands

| Command                | Purpose                                                             |
| ---------------------- | ------------------------------------------------------------------- |
| `npm run dev`          | Start the Next.js development server                                |
| `npm run build`        | Build the production application                                    |
| `npm start`            | Apply migrations and start the production server                    |
| `npm test`             | Run deterministic unit and integration tests                        |
| `npm run test:e2e`     | Run the synthetic production-mode journey and cached restart proof  |
| `npm run typecheck`    | Type-check the application                                          |
| `npm run lint`         | Run ESLint                                                          |
| `npm run format:check` | Check formatting                                                    |
| `npm run smoke`        | Exercise a built production server from a temporary state directory |

## Opt-in Linear contract test

Ordinary tests are synthetic and make no network calls. Before pilot use, run the adapter contract against a separately authorized fixture workspace by setting either `LINEAR_CONTRACT_API_KEY` (personal-key mode) or `LINEAR_CONTRACT_ACCESS_TOKEN` (OAuth mode), plus `LINEAR_CONTRACT_WORKSPACE_ID`, `LINEAR_CONTRACT_TEAM_ID`, `LINEAR_CONTRACT_PROJECT_LABEL_ID`, and `LINEAR_CONTRACT_PROJECT_ID`. Then run `npm test -- src/sync/linear-contract.test.ts`. This check is skipped when required variables are absent and never mutates Linear.

Personal-key creation, OAuth registration, and fixture access remain operator-controlled. The repository does not create credentials or Linear fixture data.

## Security and privacy

- Use read-only Linear credentials and the narrowest compatible personal-key team scope.
- Keep personal API keys, OAuth credentials, and token-encryption keys in server-side operator configuration, never tracked files. Personal API keys are not copied into SQLite.
- Use synthetic data in tests.
- Do not include raw provider payloads, authorization codes, tokens, cookies, workspace names, or internal identifiers in routine logs.

## License

Apache-2.0. See [LICENSE](LICENSE).
