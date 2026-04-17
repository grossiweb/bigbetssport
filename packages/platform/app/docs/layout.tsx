import type { ReactNode } from 'react';
import Link from 'next/link';
import { Navbar } from '@/components/marketing/Navbar';

const NAV_GROUPS = [
  {
    title: 'Getting started',
    items: [
      { href: '/docs/introduction', label: 'Introduction' },
      { href: '/docs/quickstart',   label: 'Quickstart' },
      { href: '/docs/authentication', label: 'Authentication' },
      { href: '/docs/errors',        label: 'Error codes' },
      { href: '/docs/rate-limits',   label: 'Rate limits' },
    ],
  },
  {
    title: 'API Reference',
    items: [
      { href: '/docs/response-envelope', label: 'Response envelope' },
      { href: '/docs/field-selection',   label: 'Field selection' },
      { href: '/docs/matches',           label: 'Matches' },
      { href: '/docs/players',           label: 'Players' },
      { href: '/docs/standings',         label: 'Standings' },
      { href: '/docs/cricket',           label: 'Cricket' },
      { href: '/docs/combat-sports',     label: 'Combat sports' },
    ],
  },
  {
    title: 'Real-time',
    items: [
      { href: '/docs/websocket', label: 'WebSocket' },
      { href: '/docs/webhooks',  label: 'Webhooks' },
    ],
  },
  {
    title: 'SDKs',
    items: [
      { href: '/docs/sdks/typescript', label: 'TypeScript' },
      { href: '/docs/sdks/python',     label: 'Python' },
      { href: '/docs/sdks/go',         label: 'Go' },
    ],
  },
];

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <div className="mx-auto flex max-w-7xl gap-10 px-6 py-10">
        <aside className="hidden w-60 shrink-0 md:block">
          <div className="sticky top-20 space-y-8">
            {NAV_GROUPS.map((group) => (
              <div key={group.title}>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy-500">
                  {group.title}
                </h4>
                <ul className="space-y-1 text-sm">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className="block rounded px-2 py-1 text-navy-600 hover:bg-navy-50 hover:text-navy-900"
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </aside>
        <article className="prose prose-slate min-w-0 flex-1 max-w-3xl">
          {children}
        </article>
      </div>
    </div>
  );
}
