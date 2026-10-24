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
