import type { ReactNode } from 'react';
import clsx from 'clsx';

export function Badge({
  color = 'navy',
  children,
}: {
  color?: 'navy' | 'blue' | 'green' | 'amber' | 'red' | 'grey';
  children: ReactNode;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        color === 'navy' && 'bg-navy-50 text-navy-700 ring-navy-200',
        color === 'blue' && 'bg-brand-50 text-brand-700 ring-brand-600/20',
        color === 'green' && 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
        color === 'amber' && 'bg-amber-50 text-amber-700 ring-amber-600/20',
        color === 'red' && 'bg-red-50 text-red-700 ring-red-600/20',
        color === 'grey' && 'bg-slate-50 text-slate-600 ring-slate-300',
      )}
    >
      {children}
    </span>
  );
}
