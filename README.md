# Horizonbound

Horizonbound is a capacity-aware roadmap forecasting application for Linear. Linear remains authoritative for projects and delivery work; Horizonbound adds explicit forecast ranges, refinement signals, capacity lanes, sequencing, fit, and commitment rationale.

> Horizonbound is under active development. The first vertical slice is not yet ready for production use.

## Local prerequisites

- Node.js 22 or newer
- npm
- A Linear OAuth application with a read-only callback, when enabling a real connection

## Setup

```bash
npm ci
cp .env.example .env
# Set TOKEN_ENCRYPTION_KEY with: openssl rand -base64 32
npm run check
```

The production server requires `APP_BASE_URL`. It defaults its listener to `127.0.0.1`, while `HOST`, `PORT`, and `HORIZONBOUND_STATE_DIR` are configurable:

```bash
APP_BASE_URL=http://127.0.0.1:3000 npm run build
APP_BASE_URL=http://127.0.0.1:3000 npm start
```

Runtime state is stored outside the repository. The default on Linux is `~/.local/state/horizonbound`. Disconnect removes local provider tokens and sessions but retains cached roadmap data; stop Horizonbound and delete the configured state directory when you intentionally want to remove that cache.

The Linear OAuth callback must exactly match `${APP_BASE_URL}/api/auth/linear/callback`. Horizonbound requests only Linear's `read` scope.

### Network exposure

You may explicitly bind Horizonbound to a LAN address or `0.0.0.0`. The application warns but does not prevent this. The MVP has no dedicated front-door access authentication, so network peers may be able to reach roadmap data and connection operations. Add an appropriate access boundary before exposing it to an untrusted network.

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

Ordinary tests are synthetic and make no network calls. Before pilot use, run the adapter contract against a separately authorized fixture workspace by setting `LINEAR_CONTRACT_ACCESS_TOKEN`, `LINEAR_CONTRACT_WORKSPACE_ID`, `LINEAR_CONTRACT_TEAM_ID`, `LINEAR_CONTRACT_PROJECT_LABEL_ID`, and `LINEAR_CONTRACT_PROJECT_ID`, then run `npm test -- src/sync/linear-contract.test.ts`. This check is skipped when those variables are absent and never mutates Linear.

OAuth registration and the full interactive Authorization Code + PKCE contract remain operator-controlled prerequisites; the repository does not create an OAuth application or Linear fixture data.

## Security and privacy

- Request only Linear's read scope.
- Keep OAuth credentials and the token-encryption key in environment variables, never tracked files.
- Use synthetic data in tests.
- Do not include raw provider payloads, authorization codes, tokens, cookies, workspace names, or internal identifiers in routine logs.

## License

Apache-2.0. See [LICENSE](LICENSE).
