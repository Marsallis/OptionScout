# Security

OptionScout Phase 1B is a single-user application on your own machine. Live brokerage access is off until you explicitly enable it.

## What this version enforces

- Compose publishes the app on `127.0.0.1:3180` only.
- Outside Docker, the process binds to a loopback address. Binding every interface is rejected unless the process is the container listener behind that loopback publish.
- There is no registration, no public user database, and no remote login.
- There are no order, transfer, or other brokerage mutation routes. The tastytrade client allowlist rejects any `/orders` path before a request is sent.
- Browser-initiated brokerage reads require an owner session. Automatic scheduled synchronization is rejected at startup.
- Brokerage client ids, secrets, refresh tokens, and access tokens are rejected if they are present in the process environment. The failure log names the variable and not the value.
- When live access is off, secret-file values are not kept in memory. A boolean records whether the file looks complete.
- `.env`, `.env.local`, `secrets/`, and SQLite files are gitignored.
- `.env.example` contains only non-sensitive placeholders. The blank credential template is `secrets.example/tastytrade.env.example`.
- The database file is on a Docker volume. No database port is published.
- Responses send `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, and `Cache-Control: no-store`.
- JSON bodies are limited to 32 KB.
- Logs redact `Bearer` values and JWT-shaped strings.

## Owner passphrase

Create the owner credential with a one-time local command. It reads the passphrase from a masked terminal prompt, or from a single stdin line when there is no terminal. It refuses a passphrase passed as an argument.

The database stores `scrypt$16384$8$1$<salt>$<hash>`. The raw passphrase is not written to a file.

Sign-in sets an `os_session` cookie: `HttpOnly`, `SameSite=Strict`, `Path=/`, and an 8-hour absolute lifetime. The cookie is not marked `Secure` because the app is served over `http://127.0.0.1`, where a Secure cookie is not reliably stored. Only the SHA-256 of the session id is stored.

`GET /api/session` returns a CSRF token and stores only its hash. State-changing requests send that token in `X-CSRF-Token`. Login itself uses the passphrase plus a loopback `Origin` check. Other unsafe methods require a loopback `Origin` as well.

Five failed sign-ins in 15 minutes return HTTP 429 without checking another passphrase. A successful sign-in clears the failures.

Demo routes stay available without a brokerage connection. Brokerage account numbers, imported positions, and sync actions are not returned to an anonymous browser. Switching the portfolio view to brokerage requires a session.

## Secrets once you enable the read-only connection

- Put `TASTYTRADE_CLIENT_ID`, `TASTYTRADE_CLIENT_SECRET`, `TASTYTRADE_REFRESH_TOKEN`, and `TASTYTRADE_ENVIRONMENT` in `secrets/tastytrade.env`.
- Compose mounts that directory read-only at `/run/secrets` and keeps `TASTYTRADE_ENABLE_LIVE=false`.
- Access tokens stay in API memory. They are not written to the browser or the database.
- Request the `read` scope only. Do not request `trade`.
- OptionScout still cannot submit orders after the account is connected.

## Logging

Startup and request failures log a static message or a configuration message that has already been stripped of secret values. The process does not dump `process.env`. Brokerage error responses are short local sentences. Provider response bodies are not forwarded to the browser.
