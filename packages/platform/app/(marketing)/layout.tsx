import type { ReactNode } from 'react';
import Link from 'next/link';
import { Navbar } from '@/components/marketing/Navbar';

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-navy-800">
      <Navbar />
      <main>{children}</main>
      <footer className="border-t border-navy-100 bg-white py-12">
        <div className="mx-auto grid max-w-7xl gap-8 px-6 text-sm text-navy-500 md:grid-cols-4">
          <div>
            <div className="mb-3 flex items-center gap-2 font-semibold text-navy-800">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-navy-800 text-[10px] text-white">
                BBS
              </span>
              Big Ball Sports
            </div>
            <p className="max-w-xs text-xs leading-relaxed">
              The sports data API built for developers. Built to the same
              standard as Stripe.
            </p>
          </div>
          <div>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-navy-800">
              Product
            </h4>
            <ul className="space-y-2">
              <li><Link href="/docs/introduction" className="hover:text-navy-800">Docs</Link></li>
              <li><Link href="/pricing" className="hover:text-navy-800">Pricing</Link></li>
              <li><Link href="/status" className="hover:text-navy-800">Status</Link></li>
              <li><Link href="/changelog" className="hover:text-navy-800">Changelog</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-navy-800">
              Developers
            </h4>
            <ul className="space-y-2">
              <li><Link href="/docs/api-reference" className="hover:text-navy-800">API Reference</Link></li>
              <li><Link href="/docs/sdks/typescript" className="hover:text-navy-800">TypeScript SDK</Link></li>
              <li><Link href="/explorer" className="hover:text-navy-800">API Explorer</Link></li>
              <li><a href="https://github.com/bigballsports" className="hover:text-navy-800">GitHub</a></li>
            </ul>
          </div>
          <div>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-navy-800">
              Legal
            </h4>
            <ul className="space-y-2">
              <li><Link href="/legal/privacy" className="hover:text-navy-800">Privacy</Link></li>
              <li><Link href="/legal/terms" className="hover:text-navy-800">Terms</Link></li>
              <li><Link href="/legal/dpa" className="hover:text-navy-800">DPA</Link></li>
            </ul>
          </div>
        </div>
        <div className="mx-auto mt-8 max-w-7xl border-t border-navy-100 px-6 pt-6 text-xs text-navy-400">
          © {new Date().getFullYear()} Big Ball Sports. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
