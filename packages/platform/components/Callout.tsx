import type { ReactNode } from 'react';
import clsx from 'clsx';

export function Callout({
  type = 'info',
  children,
}: {
  type?: 'info' | 'warning' | 'danger';
  children: ReactNode;
}) {
  return (
    <div
      className={clsx(
        'rounded-lg border px-4 py-3 text-sm',
        type === 'info' && 'border-brand-600/20 bg-brand-50 text-brand-700',
        type === 'warning' && 'border-amber-600/30 bg-amber-50 text-amber-800',
        type === 'danger' && 'border-red-600/30 bg-red-50 text-red-800',
      )}
    >
      {children}
    </div>
  );
}
