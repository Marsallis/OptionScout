# Future tastytrade integration

Phase 1B includes a read-only client for the personal OAuth refresh-token grant. Live calls stay behind `TASTYTRADE_ENABLE_LIVE`, which defaults to false. The client does not use the retired session login, does not open a DXLink socket, and does not submit orders.

Official references used for this note, retrieved 15 Oct 2026:

- [OAuth2 authentication](https://developer.tastytrade.com/docs/authentication/oauth2/)
- [Market data](https://developer.tastytrade.com/docs/concepts/market-data/)
- [Streaming](https://developer.tastytrade.com/docs/concepts/streaming/)

The legacy `POST /sessions` username and password flow was decommissioned on 11 Feb 2026. Do not implement it.

## Environments

Production and sandbox do not share credentials.

| Environment | REST base URL |
| --- | --- |
| Production | `https://api.tastyworks.com` |
| Sandbox | `https://api.cert.tastyworks.com` |

Every REST call, including token requests, needs a `User-Agent` header in `product/version` form. The planned value is `OptionScout/<version>`.

A personal OAuth application can be used against the owner's own account. Other people cannot connect to that application until tastytrade completes third-party verification. OptionScout should start with a personal grant. The authorization-code grant is only needed once other operators are supported.

## OAuth refresh-token flow

For the owner's own app, tastytrade issues a long-lived refresh token from the OAuth application grant. Refresh tokens do not expire and are not rotated when an access token is minted.

The API process, not the browser, will exchange that refresh token:

- `POST /oauth/token`
- JSON body fields: `grant_type` of `refresh_token`, `refresh_token`, and `client_secret`
- `client_id` is optional and must match if it is sent
- An optional `scope` can request a subset of the grant. OptionScout should ask for `read` only

The response access token is a JWT valid for 15 minutes. Refreshing does not return a new refresh token. An expired access token produces HTTP 401.

Store the refresh token and client secret only in the local data volume, mode 0600 inside Linux. A Windows process cannot enforce that Unix mode. The file is not encrypted, and a backup of the Docker data volume can include it. Cache the access token in memory. Disconnect persists across restarts and does not fall back to `secrets/tastytrade.env`. `TASTYTRADE_ENABLE_LIVE=true` does not override a disconnect. `TASTYTRADE_DISABLE_LIVE=true` blocks Test Connection, import, and research calls. Refresh on a schedule, or when it is inside a short window of expiry, not on every API call. On 401, refresh once and retry the read. If refresh fails, mark the connection disconnected and stop. Never log either token.

Third-party authorization, when it exists later, uses the authorization-code grant against `https://my.tastytrade.com/auth.html` (sandbox URL is documented by tastytrade separately). Customers need 2FA enabled before they can grant `read` or `trade`. OptionScout must not request `trade`.

## Positions and transactions

The OAuth guide shows position reads at:

`GET /accounts/{account_number}/positions`

Send `Authorization: Bearer <access token>` and the User-Agent. Import only the account the owner confirmed after Test Connection. A grant that can see several accounts is not rejected. The owner picks one. The browser receives the account type and a masked number, not the full account number. A later import of a different account or the other environment is refused, and the stored transactions stay in place.

Transaction history is an account REST read. Confirm the current path, filters, and pagination in the OpenAPI reference at implementation time, then map fills into the existing `transactions` table. Do not invent pagination behavior.

Reconciliation compares the brokerage snapshot with local rows by account and instrument. Differences become alerts or a reconciliation list. OptionScout does not submit an order to "fix" a break.

## Option chains (Phase 1D.1)

`GET /option-chains/{symbol}/nested` is the preferred chain read. It returns expirations, strikes, OCC symbols, and official `call-streamer-symbol` / `put-streamer-symbol` values in one response. The flat `GET /option-chains/{symbol}` route is not allowlisted in 1D.1; active and closing-only stay unknown when absent. `GET /instruments/equities/{symbol}` supplies the underlying equity streamer symbol. Streamer symbols are never constructed by guessing. Live Finder scans remain behind `FINDER_LIVE_SCAN` (default false).

## REST quotes

`GET /market-data/by-type` returns real-time quotes for funded accounts. There is no delayed REST quote.

Equity options use tastytrade symbology. The documented shape is like `SPY 250428P00355000`. The demo fixtures already store a `tasty_symbol` in that style so the later client does not have to rewrite the dashboard.

One request can include several instrument types. The combined symbol count is capped at 100. Split larger books across requests.

Each item includes `updated-at`. Persist `fetchedAt` locally and keep the provider timestamp. A later phase will decide when a quote is too old to show as current. Until that rule exists, the UI must show the timestamp and must not label the quote as live without it.

REST quotes are for snapshots. Streaming is the intended path for a book that stays on screen.

Market data is read-only. Do not add order routes beside it.

## DXLink streaming

Quote streaming is separate from the account streamer.

1. `GET /api-quote-tokens` with the OAuth access token. The response includes a quote token and `dxlink-url`. Quote tokens last 24 hours.
2. Open a WebSocket to that URL.
3. Send `SETUP` on channel 0. After `AUTH_STATE` is `UNAUTHORIZED`, send `AUTH` with the quote token.
4. Send `CHANNEL_REQUEST` for service `FEED` on channel 3 with contract `AUTO`. After `CHANNEL_OPENED`, send `FEED_SETUP` for compact Quote, Trade, and Greeks, then `FEED_SUBSCRIPTION` using the instrument `streamer-symbol`.
5. Send `KEEPALIVE` about every 30 seconds. The socket closes if DXLink sees none within its 60-second timeout.

Phase 1C.2 implements that sequence. The allowlist accepts the documented `wss://tasty-openapi-ws.dxfeed.com/realtime` address and the production quote-token host `wss://tasty-openapi-dxlink-md-ws.dxfeed.com/realtime`. Any other host is rejected. The account streamer hosts are rejected. `DXLINK_LIVE_DIAGNOSTIC` defaults to false, and startup does not open a socket. Official streamer symbols come from `GET /instruments/equity-options/{symbol}`; the returned OCC symbol must match the request, and the mapping is stored apart from brokerage transactions.

Subscription caps called out in the streaming guide: 5 concurrent sessions, 25,000 subscriptions per session, 100 each for Candle, Order, and Series, and 10,000 subscription changes per minute.

`QuoteStreamService` is the seam for this work. The Phase 1A mock leaves it idle.

The account streamer (`wss://streamer.tastyworks.com`, sandbox `wss://streamer.cert.tastyworks.com`) pushes order, balance, and position notifications. It uses the OAuth access token, which expires in 15 minutes, so a long-lived socket has to re-authenticate after refresh. It does not place orders. OptionScout can adopt it later for sync freshness. It is not required to show a REST snapshot.

## Rate limits and errors

Documented client behavior:

- **401.** Refresh the access token once and retry the read. Then surface a disconnected state.
- **403.** The token is valid but not allowed. Do not retry in a loop. Reads require `read`. A 403 on a mutation is a signal that the code asked for something OptionScout should not do.
- **406.** An `Accept-Version` value is gone. Pin a version only after checking the current version guide.
- **429.** Back off and retry. Do not treat a 429 as a successful empty book.
- **5xx or a timeout.** Limited retries with jitter for reads. Do not retry a write, and Phase 1A has no writes to tastytrade anyway.

The streaming guide's session and subscription caps are separate from REST 429 handling. Confirm the current REST rate-limit numbers in the rate-limit guide when the client is built, and record them next to the adapter rather than guessing them here.

DXLink and the account socket should reconnect with backoff. A quiet DXLink feed can mean the symbol has no prints. That is not, by itself, a failure.

## What stays true after the connection exists

- The dashboard still reads local rows through the same view model.
- Demo rows and brokerage rows stay distinguishable. `is_demo` stays on the fixture account, and the UI keeps a demo label on those rows.
- No order, dry-run, or cancel endpoint is added to OptionScout.
- The app remains useful with the connection absent: Demo Mode is the fallback, not an error page.
