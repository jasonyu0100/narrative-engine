'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';

const NAV_ITEMS = [
  { href: '/', label: 'Home' },
  { href: '/paper', label: 'Paper' },
  { href: '/case-analysis', label: 'Case Analysis' },
  { href: '/discover', label: 'Discover' },
  { href: '/dashboard', label: 'Dashboard' },
];

export function LandingTopbar() {
  const pathname = usePathname();
  if (pathname.startsWith('/series/') || pathname.startsWith('/analysis')) return null;

  return (
    <nav className="relative z-30 flex items-center justify-center pt-5 pb-2">
      <div className="flex items-center gap-0.5 rounded-full border border-white/8 bg-white/3 backdrop-blur-sm px-1 py-1">
        {NAV_ITEMS.map(({ href, label }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`text-[11px] px-4 py-1.5 rounded-full transition-all ${
                active
                  ? 'text-white bg-white/10'
                  : 'text-white/35 hover:text-white/60'
              }`}
            >
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
