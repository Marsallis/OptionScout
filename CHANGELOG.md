# Changelog

## Unreleased

- A setup wizard starts on the simulated book, can save a local passphrase, and explains a personal read-only tastytrade grant. The public preview does not store a passphrase or a grant. Watchlist symbols show a simulated quote unless a read-only session is connected. Overview says Simulated or Connected, with the last update time. The payoff chart has a text summary. Phone width keeps a short path and the colorway control on the top bar. Orders stay off.
- The desk has a beginner welcome guide, a Beginner/Pro switch, a glossary, a watchlist, and five colorways saved in the browser. Orders stay off.
- Startup loads the dashboard, broker status, settings, and session separately. A failed section shows its own Retry button.
- PMCC Builder, Risk Lab, Research Feed, and Trade Journal work on the simulated book. Order routes stay rejected.
- Explore Stocks includes S&P 500, Nasdaq-100, and VTI company lists. Importing a holdings file is optional.
- Strategy rules can use 0 days to expiration. Open interest and volume are not saved, because quotes cannot score them. Invalid money is rejected instead of being stored as `NaN`.
- `PUBLIC_SIMULATED_DEMO=true` serves only the simulated book, allows a `DEMO` search without an owner session from a non-loopback host, loads no broker credentials, and refuses broker and credential changes.
- `scripts/setup.sh` prints the container name from `--container` and documents `--start`.
- Pasted ticker lists are selected after import, up to the picker limit.
