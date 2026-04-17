'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { ApiKeysTable } from '@/components/dashboard/ApiKeysTable';
import { CreateKeyModal } from '@/components/dashboard/CreateKeyModal';
import type { SafeApiKey } from '@/lib/api-keys';

async function fetchKeys(): Promise<SafeApiKey[]> {
  const res = await fetch('/api/keys');
  if (!res.ok) throw new Error(`Failed to load keys (HTTP ${res.status})`);
  const body = (await res.json()) as { data: SafeApiKey[] };
  return body.data;
}

async function createKey(params: {
  name: string;
  environment: 'live' | 'test';
  scopes: string[];
}): Promise<{ key: string; prefix: string }> {
  const res = await fetch('/api/keys', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Failed (HTTP ${res.status})`);
  }
  const body = (await res.json()) as { data: { key: string; prefix: string } };
  return body.data;
}

export default function KeysPage() {
  const [keys, setKeys] = useState<SafeApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      setKeys(await fetchKeys());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load keys');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function handleRotate(id: string) {
    if (!confirm('Rotating will invalidate the current key. Continue?')) return;
    const res = await fetch(`/api/keys/${id}/rotate`, { method: 'POST' });
    if (res.ok) {
      const body = (await res.json()) as { data: { key: string } };
      alert(`Your new key (copy now — this is the only time you'll see it):\n\n${body.data.key}`);
      await reload();
    }
  }

  async function handleRevoke(id: string) {
    if (!confirm('Revoke this key? This is immediate and cannot be undone.')) return;
    await fetch(`/api/keys/${id}`, { method: 'DELETE' });
    await reload();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-navy-800">API Keys</h1>
          <p className="mt-1 text-sm text-navy-500">
            Create, rotate, and revoke keys for your integrations.
          </p>
        </div>
        <Button onClick={() => setIsOpen(true)}>+ Create API key</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="card text-center text-sm text-navy-500">Loading…</div>
      ) : (
        <ApiKeysTable keys={keys} onRotate={handleRotate} onRevoke={handleRevoke} />
      )}

      <CreateKeyModal
        isOpen={isOpen}
        onClose={() => {
          setIsOpen(false);
          void reload();
        }}
        onCreate={createKey}
      />
    </div>
  );
}
