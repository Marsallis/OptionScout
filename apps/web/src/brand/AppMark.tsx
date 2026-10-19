import { useId } from 'react';

/** Magnifying glass with a rising chart. Simplified from the brand-kit mark so it stays clear at 16px. */
export function AppMark({
  size = 32,
  researching = false,
  title = 'OptionScout',
}: {
  size?: number;
  researching?: boolean;
  title?: string;
}) {
  const id = useId().replace(/:/g, '');
  const ring = `ring-${id}`;
  const gain = `gain-${id}`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label={title}
      className={researching ? 'os-mark os-mark--live' : 'os-mark'}
    >
      <defs>
        <linearGradient id={ring} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#51DEFF" />
          <stop offset="1" stopColor="#2078FF" />
        </linearGradient>
        <linearGradient id={gain} x1="0" y1="1" x2="1" y2="0">
          <stop stopColor="#12D9AF" />
          <stop offset="1" stopColor="#4BF28D" />
        </linearGradient>
      </defs>
      <path d="M21.2 20.4 26.4 25.6" stroke={`url(#${ring})`} strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="13.2" cy="13" r="8.2" fill="none" stroke={`url(#${ring})`} strokeWidth="2.2" />
      <path
        d="M8.2 16.6 V14.2 H9.6 V17.4 H8.2 Z M11.2 15.2 V12.2 H12.6 V16.2 H11.2 Z M14.2 13.6 V10 H15.6 V14.4 H14.2 Z M17.1 11.6 V7.6 H18.5 V12.4 H17.1 Z"
        fill={`url(#${gain})`}
      />
      <path d="M7.4 17.2 C10.2 16.2 12.4 14 14.4 12.2 C16.6 10.2 18 8.4 19.6 6.4" fill="none" stroke={`url(#${gain})`} strokeWidth="1.4" strokeLinecap="round" />
      <path d="M17.6 6.6 H20.2 V9.2" fill="none" stroke={`url(#${gain})`} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <rect className="os-scan" x="7" y="12" width="12" height="1.2" fill="#F8FAFC" opacity="0.0" />
    </svg>
  );
}
