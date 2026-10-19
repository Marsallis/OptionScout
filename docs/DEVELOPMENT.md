# Development

This is the practical companion to [CONTRIBUTING.md](../CONTRIBUTING.md) and [architecture.md](architecture.md). Commands below were checked against this repository on Windows. The npm scripts are the same on macOS and Linux. The shell setup script has not been run on those systems here.

## Install for development

Docker is the shortest path and is documented in the [README](../README.md).

For a local Node process:

```powershell
npm ci
npm test
npm run build
npm start
```

`npm start` serves the API and the built web app on `http://127.0.0.1:3180`. The database is created at `apps/api/data/optionscout.sqlite`.

Create a passphrase only after that database exists:

```powershell
npm run owner-setup
```

The command reads a masked prompt. It rejects a passphrase shorter than 12 characters, and it rejects a passphrase passed as an argument.

## Two processes while you edit the UI

Stop any OptionScout container that is using port 3180 first.

```powershell
npm run dev:api
npm run dev:web
```

`dev:api` runs `tsx watch` on the API. `dev:web` runs Vite at `http://127.0.0.1:5173`.

Copy `.env.example` to `.env` only when you need a local override. The sample turns live brokerage access off. Do not put client secrets or refresh tokens in `.env`.

## Tests and builds

| Command | What it does |
| --- | --- |
| `npm test` | Builds `packages/shared`, then runs shared, API, and web Vitest suites |
| `npm run build` | Typechecks and builds shared, the API, and the web app |
| `npm test -w @optionscout/shared` | Shared calculations only. Build shared first if its `dist` is missing |
| `npm test -w @optionscout/api` | API tests, including migration and research-session fixtures |
| `npm test -w @optionscout/web` | Component tests with mocked `fetch` |

API tests use an in-memory or temporary SQLite file. Web tests do not open a browser and do not call tastytrade. A stderr line from a test that deliberately sends malformed JSON is a failed-request assertion, not a failed suite, when Vitest still exits successfully.

CI runs `npm ci`, `npm test`, and `npm run build` on Ubuntu with Node 22. It has no secrets and no brokerage access.

## Docker from a checkout

```powershell
.\scripts\setup.ps1
docker compose up -d --build
docker compose logs optionscout
docker compose exec -it optionscout node apps/api/dist/owner-setup.js
```

The image build uses `docker/Dockerfile`. Compose reads `OPTIONSCOUT_PORT`, `OPTIONSCOUT_CONTAINER`, `OPTIONSCOUT_IMAGE`, `FINDER_LIVE_SCAN`, `SMART_SCAN_LIVE`, and `TASTYTRADE_ENABLE_LIVE` from the environment or from a `.env` file in the project directory. Unset live switches default to `false`. The image name defaults to `optionscout:1b`. Set `OPTIONSCOUT_IMAGE` when you build a second copy so that tag stays on the app you are already running.

The container listens on `0.0.0.0` inside its network so Docker can forward traffic. The published binding remains `127.0.0.1`.

## How to explore the demo without credentials

1. Start with the live switches false and with a blank `secrets/tastytrade.env`.
2. Open `/`. The simulated book loads from `/api/dashboard` with no session.
3. Run owner setup and sign in on Broker & Data.
4. On Find One Stock, scan `DEMO`. Any other symbol in the demo portfolio is rejected.
5. On Explore Stocks, a curated example runs the simulated chain in `apps/api/src/finder/smart-mock.ts`. The result says it is simulated.
6. Practice symbols `ZZBEST`, `ZZNEAR`, `ZZOUT`, `ZZEMP`, `ZZBAD`, `ZZGRK`, and `ZZINV` exist so tests and the UI can show a best match, a near match, a rejection, and broken quotes without a provider.

Turning on brokerage view without a successful import shows an empty imported book. It does not display the NVDA demo position as if it were yours.

## Adding a change

Shared rule:

1. Edit `packages/shared/src`.
2. Add or extend a `*.test.ts` next to it.
3. Run `npm run build -w @optionscout/shared` and `npm test -w @optionscout/shared`.
4. Update the API or web caller.

API route or table:

1. Add `apps/api/migrations/00xx_name.sql`. Do not change an older file.
2. Update `apps/api/src/db/schema.ts` so Drizzle matches the SQL.
3. Cover the behavior from a temporary database in Vitest.
4. Keep provider calls out of the test. Pass a fake client or use the demo fixture.

Web page:

1. Keep dollar math out of the component. Format a value the API or `packages/shared` already computed.
2. Add a Testing Library test that mocks `fetch`.
3. If the page can start a search, assert that the test did not call a live URL. The existing Discover tests are the pattern.

## Troubleshooting

**Port 3180 is already in use.** Another OptionScout container or `npm start` has it. Stop that process, or set `OPTIONSCOUT_PORT` and `OPTIONSCOUT_CONTAINER` before `docker compose up`.

**Compose says the brokerage secret file is incomplete.** `TASTYTRADE_ENABLE_LIVE` is true while `secrets/tastytrade.env` is blank. Set the switch to `false` for the demo, or finish the file before enabling it.

**Sign-in says to run owner-setup.** The database has no passphrase yet. Run the owner-setup command against that same database. A Docker volume and `apps/api/data` are different databases.

**The passphrase prompt does nothing under `exec -it`.** Use a normal terminal. Do not pipe the passphrase into a logged command if your shell records history. The non-interactive path reads two lines from stdin: the passphrase, then the same passphrase again.

**The Overview is the fictional book and you expected imported positions.** Settings is still on the demo portfolio, or this browser is signed out. The brokerage book is a different screen and requires a session.

**`npm ci` fails on `better-sqlite3`.** Use Node 22. On a machine without a prebuild, the module compiles from source and needs a C++ toolchain. The Docker image builds that module for you.

**You ran `docker compose down -v`.** That deleted the volume for this Compose project. The next start creates a new simulated book and an empty brokerage book. It does not restore a deleted passphrase or saved research.
