import type { ButtonHTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  readonly size?: 'sm' | 'md' | 'lg';
  readonly children?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      className={clsx(
        'inline-flex items-center justify-center rounded-lg font-semibold transition focus:outline-none focus:ring-2 focus:ring-offset-2',
        size === 'sm' && 'px-3 py-1.5 text-sm',
        size === 'md' && 'px-4 py-2 text-sm',
        size === 'lg' && 'px-5 py-2.5 text-base',
        variant === 'primary' &&
          'bg-brand text-white shadow-sm hover:bg-brand-600 focus:ring-brand',
        variant === 'secondary' &&
          'border border-navy-200 bg-white text-navy-700 shadow-sm hover:bg-navy-50 focus:ring-navy-300',
        variant === 'ghost' && 'text-navy-700 hover:bg-navy-100 focus:ring-navy-200',
        variant === 'danger' &&
          'bg-red-600 text-white shadow-sm hover:bg-red-700 focus:ring-red-500',
        className,
      )}
    />
  );
}
