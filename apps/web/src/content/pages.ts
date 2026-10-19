export interface NavItem {
  label: string;
  to: string;
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Overview', to: '/' },
  { label: 'Find One Stock', to: '/leaps' },
  { label: 'Explore Stocks', to: '/discover' },
  { label: 'My Investing Rules', to: '/strategies' },
  { label: 'PMCC Builder', to: '/pmcc' },
  { label: 'My Positions', to: '/positions' },
  { label: 'Risk Lab', to: '/risk' },
  { label: 'Research Feed', to: '/research' },
  { label: 'Trade Journal', to: '/journal' },
  { label: 'Broker & Data', to: '/broker' },
  { label: 'Settings', to: '/settings' },
];

export interface PlaceholderCopy {
  title: string;
  paragraphs: string[];
}

export const PLACEHOLDERS: Record<string, PlaceholderCopy> = {
  '/pmcc': {
    title: 'PMCC Builder',
    paragraphs: [
      'This screen will pair a long LEAP with a short call and compare collected premium, rolls, and closes.',
      'Phase 1C does not build trades or submit orders. The demo book on Overview already contains two sample PMCC positions.',
    ],
  },
  '/risk': {
    title: 'Risk Lab',
    paragraphs: [
      'This screen will estimate price, expiration, and assignment scenarios for open positions.',
      'Phase 1C does not calculate scenarios. Demo alerts on Overview are stored fixtures, not a risk model.',
    ],
  },
  '/research': {
    title: 'Research Feed',
    paragraphs: [
      'This screen will hold research candidates and, later, an optional Faircloth OS connection.',
      'Phase 1C keeps three illustrative candidates in the local database and previews them on Overview. Faircloth OS is not connected.',
    ],
  },
  '/journal': {
    title: 'Trade Journal',
    paragraphs: [
      'This screen will collect notes for opens, closes, and rolls.',
      'Phase 1C stores three demo notes and previews them on Overview. There is no journal editor yet.',
    ],
  },
};
