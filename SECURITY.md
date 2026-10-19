# Security policy

OptionScout is a single-user application meant to run on your own computer. It is not designed to be exposed to the public internet.

## Reporting a vulnerability

Do not open a public GitHub issue for a security report. Do not include exploit details, credentials, or account data in a public place.

Until this repository has a published security contact, send the report privately to the maintainer who shared the project with you. After the repository is public, use GitHub private vulnerability reporting for that repository. A personal email address is intentionally not published here.

Please describe the affected version or commit, the impact, and a way to reproduce the problem with fictional data. You do not need to include a passphrase, an OAuth token, or a brokerage account number.

## What this application already enforces

- The Docker port is bound to `127.0.0.1`, not to your local network.
- Outside Docker, the process refuses to bind every network interface.
- There is no public registration and no remote multi-user login.
- Order, transfer, and other brokerage mutation paths are rejected before a request is sent.
- Scheduled brokerage synchronization cannot be enabled.
- Brokerage secrets are rejected if they are placed in the process environment. They belong only in the gitignored `secrets/` directory.
- Access tokens stay in memory. They are not written to the browser or the database.
- Sign-in uses a local passphrase, an HttpOnly session cookie, a CSRF token, and a lockout after repeated failures.
- Logs are written to remove bearer tokens and JWT-shaped strings.

The local security notes in [docs/security.md](docs/security.md) describe the same controls in more detail.

## What you should do

- Keep the app on loopback. Do not port-forward it and do not put it behind a public proxy as-is. It does not ship with TLS or an internet-facing account system.
- Choose your own passphrase of at least 12 characters. There is no default password.
- Request only the tastytrade `read` scope.
- Revoke the provider refresh token when you disconnect.
- Do not commit `secrets/`, `.env`, or a SQLite file after it contains personal research or imported positions.
