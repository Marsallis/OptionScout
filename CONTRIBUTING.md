# Contributing to OptionScout

Thanks for wanting to help. OptionScout is a local research desk for long-dated options. Small, tested changes are the most useful kind.

This project is not a brokerage and it cannot place orders. Please keep it that way.

## Before you write code

1. Follow the [README](README.md) quick start, or use Node 22 with `npm ci`.
2. Read [docs/architecture.md](docs/architecture.md) for how data moves, and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the commands.
3. OptionScout is MIT licensed. That license covers this source tree. It does not cover third-party holdings files or provider market data.

## How the repository is organized

- `apps/web` is the React 19 interface. Vite builds it. MUI draws it. Vitest and Testing Library cover it.
- `apps/api` is the Express API in TypeScript. It owns SQLite through Drizzle and `better-sqlite3`, the demo seed, brokerage import, and research sessions. Tests use Vitest and Supertest.
- `packages/shared` holds the Zod schemas and the calculations both sides must agree on. Change a contract here first, then update the API and the web app together.
- `apps/api/migrations` holds forward-only SQL migrations.
- `docker` is the production image. Compose runs that one container.

## Everyday commands

```powershell
npm test
npm run build
npm run dev:api
npm run dev:web
```

`npm test` is the command CI runs, followed by `npm run build`. Neither command needs a brokerage login. Do not point tests at a personal SQLite file or a live provider.

## Branches and pull requests

- `master` is the stable line. `v0.1.0` is the first tagged application release.
- Do feature work on a new branch from `master`.
- Keep the change focused. A pull request that also restyles an unrelated page is harder to review.
- Describe why the change exists. Include the test you added or the existing test that covers it.
- Do not commit `.env`, `secrets/`, SQLite files, backups, or screenshots of a real account.

## Adding a feature

1. Decide whether the behavior belongs in `packages/shared` (a rule both sides use), the API (storage or a provider call), or the web app (how it is explained).
2. If you add a table or column, add a new migration file. Do not edit a migration that has already shipped.
3. Keep demo rows in the demo tables. Do not write simulated quotes into brokerage tables, and do not let a live search fall back to a fixture.
4. If a figure can be missing, say so. Do not invent a zero, a grade, or a profit.
5. Add a mocked test that fails before the change and passes after it.
6. Run `npm test` and, when types or the UI build are involved, `npm run build`.

Financial calculations already live in the accounting engine and in `packages/shared`. Call them. Do not add a second formula for the same dollar amount in a React component.

## Reporting a bug

Use the bug report template. Include the page, whether you were in the demo portfolio or the brokerage portfolio, and what you expected.

Do not include:

- passphrases
- OAuth client ids, client secrets, refresh tokens, or access tokens
- brokerage account numbers or screenshots of a real account
- SQLite databases, backups, or exports of transactions
- raw market-data responses or quote dumps

A fictional ticker, the built-in `DEMO` chain, or a sentence such as "the long call mark was blank" is enough.

## Security issues

Do not open a public issue for a vulnerability. Follow [SECURITY.md](SECURITY.md).
