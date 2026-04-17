'use client';

import { useState } from 'react';
import { Badge } from '../Badge';
import { Button } from '../Button';
import type { SafeApiKey } from '@/lib/api-keys';

interface Props {
  readonly keys: readonly SafeApiKey[];
  readonly onRotate?: (keyId: string) => void;
  readonly onRevoke?: (keyId: string) => void;
}

function formatDate(d: Date | null): string {
  if (!d) return 'Never';
  try {
    return new Date(d).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch {
    return '—';
  }
}

export function ApiKeysTable({ keys, onRotate, onRevoke }: Props) {
  const [copying, setCopying] = useState<string | null>(null);

  async function copyPrefix(prefix: string) {
    try {
      await navigator.clipboard.writeText(prefix);
      setCopying(prefix);
      setTimeout(() => setCopying(null), 1200);
    } catch {
      /* clipboard unavailable — no-op */
    }
  }

  if (keys.length === 0) {
    return (
      <div className="card text-center">
        <p className="text-sm text-navy-500">No API keys yet.</p>
        <p className="mt-1 text-xs text-navy-400">
          Create your first key to start integrating.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-navy-100 bg-white shadow-card">
      <table className="min-w-full text-sm">
        <thead className="bg-navy-50 text-left text-xs uppercase tracking-wide text-navy-500">
          <tr>
            <th className="px-4 py-3 font-medium">Name</th>
            <th className="px-4 py-3 font-medium">Prefix</th>
            <th className="px-4 py-3 font-medium">Env</th>
            <th className="px-4 py-3 font-medium">Plan</th>
            <th className="px-4 py-3 font-medium">Created</th>
            <th className="px-4 py-3 font-medium">Last used</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-navy-100">
          {keys.map((k) => (
            <tr key={k.id} className={k.revokedAt ? 'opacity-50' : ''}>
              <td className="px-4 py-3 font-medium text-navy-800">{k.name ?? '(unnamed)'}</td>
              <td className="px-4 py-3">
                <button
                  onClick={() => copyPrefix(k.keyPrefix)}
                  className="rounded bg-navy-50 px-2 py-1 font-mono text-xs text-navy-700 hover:bg-navy-100"
                  title="Click to copy"
                >
                  {k.keyPrefix}…
                  {copying === k.keyPrefix && <span className="ml-2 text-emerald-600">✓</span>}
                </button>
              </td>
              <td className="px-4 py-3">
                <Badge color={k.environment === 'live' ? 'blue' : 'amber'}>
                  {k.environment}
                </Badge>
              </td>
              <td className="px-4 py-3 capitalize">{k.plan}</td>
              <td className="px-4 py-3 text-navy-500">{formatDate(k.createdAt)}</td>
              <td className="px-4 py-3 text-navy-500">{formatDate(k.lastUsedAt)}</td>
              <td className="px-4 py-3">
                {k.revokedAt
                  ? <Badge color="grey">Revoked</Badge>
                  : <Badge color="green">Active</Badge>}
              </td>
              <td className="px-4 py-3 text-right">
                {!k.revokedAt && (
                  <>
                    {onRotate && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onRotate(k.id)}
                        className="mr-2"
                      >
                        Rotate
                      </Button>
                    )}
                    {onRevoke && (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => onRevoke(k.id)}
                      >
                        Revoke
                      </Button>
                    )}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
