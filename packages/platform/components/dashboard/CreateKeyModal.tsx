'use client';

import { useState } from 'react';
import { Button } from '../Button';
import { Callout } from '../Callout';

interface Props {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onCreate: (params: {
    name: string;
    environment: 'live' | 'test';
    scopes: string[];
  }) => Promise<{ key: string; prefix: string }>;
}

const AVAILABLE_SCOPES = [
  { value: 'read:matches',    label: 'read:matches' },
  { value: 'read:odds',       label: 'read:odds' },
  { value: 'read:players',    label: 'read:players' },
  { value: 'read:standings',  label: 'read:standings' },
  { value: 'read:injuries',   label: 'read:injuries' },
  { value: 'stream:live',     label: 'stream:live' },
  { value: 'webhook:write',   label: 'webhook:write' },
];

export function CreateKeyModal({ isOpen, onClose, onCreate }: Props) {
  const [step, setStep] = useState<'configure' | 'display'>('configure');
  const [name, setName] = useState('');
  const [environment, setEnvironment] = useState<'live' | 'test'>('live');
  const [scopes, setScopes] = useState<string[]>(['read:matches', 'read:odds']);
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  function reset() {
    setStep('configure');
    setName('');
    setEnvironment('live');
    setScopes(['read:matches', 'read:odds']);
    setCreatedKey(null);
    setCopied(false);
    setConfirmed(false);
    setError(null);
  }

  async function submit() {
    setCreating(true);
    setError(null);
    try {
      const result = await onCreate({ name, environment, scopes });
      setCreatedKey(result.key);
      setStep('display');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create key');
    } finally {
      setCreating(false);
    }
  }

  async function copy() {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey);
      setCopied(true);
    } catch {
      setError('Unable to copy — copy the key manually.');
    }
  }

  function close() {
    onClose();
    reset();
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-navy-900/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-elevated">
        {step === 'configure' && (
          <>
            <h2 className="text-lg font-semibold text-navy-800">Create API key</h2>
            <p className="mt-1 text-sm text-navy-500">
              Keys are environment-scoped. Test keys never hit billing.
            </p>

            <div className="mt-5 space-y-4">
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-navy-500">
                  Name
                </label>
                <input
                  className="mt-1 w-full rounded-lg border border-navy-200 bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  placeholder="Production"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-navy-500">
                  Environment
                </label>
                <div className="mt-1 flex gap-2">
                  <button
                    onClick={() => setEnvironment('live')}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${
                      environment === 'live'
                        ? 'border-brand bg-brand-50 text-brand-700'
                        : 'border-navy-200 bg-white text-navy-600'
                    }`}
                  >
                    Live
                  </button>
                  <button
                    onClick={() => setEnvironment('test')}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${
                      environment === 'test'
                        ? 'border-brand bg-brand-50 text-brand-700'
                        : 'border-navy-200 bg-white text-navy-600'
                    }`}
                  >
                    Test
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-navy-500">
                  Scopes
                </label>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  {AVAILABLE_SCOPES.map((s) => {
                    const checked = scopes.includes(s.value);
                    return (
                      <label
                        key={s.value}
                        className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium ${
                          checked
                            ? 'border-brand bg-brand-50 text-brand-700'
                            : 'border-navy-200 bg-white text-navy-600'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5"
                          checked={checked}
                          onChange={() =>
                            setScopes((prev) =>
                              prev.includes(s.value)
                                ? prev.filter((x) => x !== s.value)
                                : [...prev, s.value],
                            )
                          }
                        />
                        <span className="font-mono">{s.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            {error && (
              <div className="mt-4">
                <Callout type="danger">{error}</Callout>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <Button variant="secondary" onClick={close}>Cancel</Button>
              <Button disabled={!name || creating} onClick={submit}>
                {creating ? 'Creating…' : 'Generate key →'}
              </Button>
            </div>
          </>
        )}

        {step === 'display' && createdKey && (
          <>
            <h2 className="text-lg font-semibold text-navy-800">Your new API key</h2>
            <div className="mt-4">
              <Callout type="warning">
                This is the <strong>only</strong> time you will see this key. Copy it now.
              </Callout>
            </div>
            <div className="mt-4 overflow-hidden rounded-lg border border-navy-200 bg-navy-900">
              <div className="flex items-center justify-between p-3">
                <code className="truncate text-sm text-navy-100">{createdKey}</code>
                <Button size="sm" variant="secondary" onClick={copy}>
                  {copied ? 'Copied ✓' : 'Copy'}
                </Button>
              </div>
            </div>
            <label className="mt-5 flex items-start gap-2 text-sm text-navy-700">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <span>I have copied my API key and stored it somewhere safe.</span>
            </label>
            <div className="mt-6 flex justify-end">
              <Button disabled={!confirmed} onClick={close}>Done</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
