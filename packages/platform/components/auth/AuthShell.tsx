import Link from 'next/link';
import type { ReactNode } from 'react';

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-navy-50 to-white">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2 font-semibold text-navy-800">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-navy-800 text-xs text-white">
            BBS
          </span>
          <span>Big Ball Sports</span>
        </Link>
        <div className="rounded-xl border border-navy-100 bg-white p-8 shadow-card">
          <h1 className="text-xl font-semibold text-navy-800">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-navy-500">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <div className="mt-6 text-center text-sm text-navy-500">{footer}</div>}
      </div>
    </div>
  );
}
