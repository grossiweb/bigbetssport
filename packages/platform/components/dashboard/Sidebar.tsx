'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';

const NAV = [
  { href: '/dashboard',          label: 'Overview' },
  { href: '/dashboard/matches',  label: 'Matches' },
  { href: '/dashboard/standings', label: 'Standings' },
  { href: '/dashboard/keys',     label: 'API Keys' },
  { href: '/dashboard/usage',    label: 'Usage' },
  { href: '/dashboard/webhooks', label: 'Webhooks' },
  { href: '/dashboard/logs',     label: 'Logs' },
  { href: '/dashboard/explorer', label: 'API Explorer' },
  { href: '/dashboard/billing',  label: 'Billing' },
  { href: '/dashboard/settings', label: 'Settings' },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-56 shrink-0 border-r border-navy-100 bg-white">
      <div className="p-5">
        <Link href="/dashboard" className="flex items-center gap-2 text-sm font-semibold text-navy-800">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-navy-800 text-[10px] text-white">
            BBS
          </span>
          Big Ball Sports
        </Link>
      </div>
      <nav className="px-3 pb-6">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname?.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                'block rounded-lg px-3 py-2 text-sm font-medium transition',
                active
                  ? 'bg-navy-100 text-navy-900'
                  : 'text-navy-600 hover:bg-navy-50 hover:text-navy-900',
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
