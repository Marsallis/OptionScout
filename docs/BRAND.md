# Brand and motion

OptionScout’s mark is a magnifying glass with a rising chart. It means search and research. It is not a promise of profit.

## Where things live

- `apps/web/src/brand/tokens.ts` — light and dark palettes, type, radius, motion, shadows
- `apps/web/src/theme.ts` — MUI theme factory `createAppTheme`. New screens should use theme values, not one-off hex colors
- `apps/web/src/brand/ColorMode.tsx` — browser-local light/dark preference (`optionscout.colorMode`)
- `apps/web/src/brand/AppMark.tsx` — icon, including the researching state
- `apps/web/src/brand/Wordmark.tsx` — sidebar and mobile lockup
- `apps/web/public/favicon.svg` — browser icon
- `apps/web/public/fonts/` — bundled OFL fonts and their license texts

## Type

- Space Grotesk: headings and large figures
- Inter: body, buttons, forms, navigation
- IBM Plex Mono: tickers and contract identifiers

Fonts load from the local app. They are not fetched from a CDN at runtime.

## Motion

- Buttons: about 120–180ms. Primary buttons lift slightly on hover and scale to 0.98 on press. Disabled buttons do not move.
- Pages: a short fade and 6px rise. Shared research state stays mounted above the page.
- Stock rows and result cards use a light background or border change. They do not start a scan.
- The magnifying-glass scan line runs only while research is actually running, and it stops when reduced motion is requested.
- Progress percentages come from the server’s evaluation budget. The bar is indeterminate while work is still running.

## Color

The desk ships in dark mode and can switch to light from the sidebar, the mobile toolbar, or Settings. Both modes use the same type, radius, and motion. Primary actions are a solid teal. Money colors still follow the data tone below.

## Color and money

Green, amber, and red follow the existing data tone. A positive number that is incomplete, stale, or unreconciled stays warning-colored. Do not paint it green because the sign is positive.

## Adding a component

Use MUI `Button`, `TextField`, `Paper`, and `Alert`. Use `variant="contained"` for the main action, `outlined` for a secondary action, and `color="error"` or `color="warning"` for destructive actions. Keep confirmation dialogs. Do not add a second motion library for a hover effect.
