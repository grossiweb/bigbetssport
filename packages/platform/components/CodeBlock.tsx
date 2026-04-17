import clsx from 'clsx';

export interface CodeBlockProps {
  readonly language?: string;
  readonly title?: string;
  readonly children: string;
  readonly className?: string;
}

/**
 * Minimal code block. Full syntax highlighting (Shiki/Prism) is a follow-up.
 * For now we render the content in a navy-background monospace block with
 * an optional filename tab and a copy button placeholder.
 */
export function CodeBlock({ language, title, children, className }: CodeBlockProps) {
  return (
    <div
      className={clsx(
        'overflow-hidden rounded-xl border border-navy-700 bg-navy-800 text-navy-100',
        className,
      )}
    >
      {(title || language) && (
        <div className="flex items-center justify-between border-b border-navy-700/60 bg-navy-900 px-4 py-2 text-xs font-medium text-navy-300">
          <span>{title ?? language ?? ''}</span>
          {language && (
            <span className="rounded bg-navy-700 px-2 py-0.5 text-[10px] uppercase tracking-wide">
              {language}
            </span>
          )}
        </div>
      )}
      <pre className="overflow-x-auto p-4 text-sm leading-relaxed">
        <code className="font-mono">{children}</code>
      </pre>
    </div>
  );
}
