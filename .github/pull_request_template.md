## Summary

## Why

## Test plan

- [ ] `npm test`
- [ ] `npm run build` if shared contracts, the API, or the web app changed
- [ ] Mocked or demo coverage for the behavior, with no live brokerage call
- [ ] No secrets, account identifiers, SQLite files, or real quote dumps are included

## Safety

- [ ] Order execution stays disabled
- [ ] Startup does not scan or synchronize
- [ ] Demo records stay out of brokerage tables
