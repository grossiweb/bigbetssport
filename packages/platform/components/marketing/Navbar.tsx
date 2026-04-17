import Link from 'next/link';
import { Button } from '../Button';

export function Navbar() {
  return (
    <nav className="border-b border-navy-100 bg-white/80 backdrop-blur sticky top-0 z-20">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2 font-semibold text-navy-800">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-navy-800 text-white">
            BBS
          </span>
          <span>Big Ball Sports</span>
        </Link>
        <div className="hidden items-center gap-6 text-sm font-medium text-navy-600 md:flex">
          <Link href="/docs/introduction" className="hover:text-navy-900">Docs</Link>
          <Link href="/pricing" className="hover:text-navy-900">Pricing</Link>
          <Link href="/status" className="hover:text-navy-900">Status</Link>
          <Link href="/changelog" className="hover:text-navy-900">Changelog</Link>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/login" className="text-sm font-medium text-navy-600 hover:text-navy-900">
            Sign in
          </Link>
          <Link href="/signup">
            <Button size="sm">Get API key — free</Button>
          </Link>
        </div>
      </div>
    </nav>
  );
}
