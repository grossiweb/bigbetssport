import type { ReactNode } from 'react';
import clsx from 'clsx';

export function MetricCard({
  label,
  value,
  delta,
  helper,
}: {
  label: string;
  value: ReactNode;
  delta?: { direction: 'up' | 'down' | 'flat'; text: string };
  helper?: string;
}) {
  return (
    <div className="card">
      <div className="text-xs font-medium uppercase tracking-wide text-navy-500">
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold text-navy-800">{value}</div>
      <div className="mt-3 flex items-baseline justify-between text-xs">
        {delta && (
          <span
            className={clsx(
              'font-medium',
              delta.direction === 'up' && 'text-emerald-600',
              delta.direction === 'down' && 'text-red-600',
              delta.direction === 'flat' && 'text-navy-500',
            )}
          >
            {delta.text}
          </span>
        )}
        {helper && <span className="text-navy-500">{helper}</span>}
      </div>
    </div>
  );
}
