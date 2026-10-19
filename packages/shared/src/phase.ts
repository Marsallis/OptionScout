export const PHASE = '1C' as const;
export const APP_NAME = 'OptionScout';

/** Shown wherever demo balances, prices, or positions appear. */
export const DEMO_DISCLAIMER =
  'Synthetic demo data. These balances, prices, and positions are not live market information.';

export const DEMO_AS_OF = '2026-10-15T20:00:00.000Z';

/** Open legs expiring inside this many days of the demo snapshot are "upcoming". */
export const UPCOMING_EXPIRATION_DAYS = 90;
