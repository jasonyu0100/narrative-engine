'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';

const NAV_ITEMS = [
  { href: '/', label: 'Home', mobileOnly: false },
  { href: '/paper', label: 'Paper', mobileOnly: false },
  { href: '/case-analysis', label: 'Case Analysis', mobileOnly: true },
  { href: '/dashboard', label: 'Dashboard', mobileOnly: true },
  { href: '/discover', label: 'Discover', mobileOnly: true },
];

export function LandingTopbar() {
  const pathname = usePathname();
  if (pathname.startsWith('/series/') || pathname.startsWith('/analysis')) return null;

  return (
    <nav className="relative z-30 flex items-center justify-center pt-8 pb-6">
      <div className="flex items-center gap-0.5 rounded-full border border-white/8 bg-white/3 backdrop-blur-sm px-1 py-1">
        <Link href="/" className="flex items-center px-3 py-1.5 text-white/35 hover:text-white/60 transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
            <path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
            <path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
          </svg>
        </Link>
        <div className="w-px h-4 bg-white/8 mr-2" />
        {NAV_ITEMS.map(({ href, label, mobileOnly }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`text-[11px] px-4 py-1.5 rounded-full transition-all ${
                active
                  ? 'text-white bg-white/10'
                  : 'text-white/35 hover:text-white/60'
              } ${mobileOnly ? 'hidden md:block' : ''}`}
            >
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
