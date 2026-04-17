import { createHash } from 'node:crypto';

/**
 * Plan tier determines per-minute AND per-day rate limits enforced in `auth.ts`.
 */
export type Plan = 'free' | 'starter' | 'pro' | 'enterprise';

export interface PlanLimits {
  readonly perMinute: number;
  readonly perDay: number;
}

/**
 * Per-plan rate limits. Per-minute is a sliding window; per-day is a
 * UTC fixed window. Enterprise bypasses both buckets.
 */
export const PLAN_LIMITS: Readonly<Record<Plan, PlanLimits>> = Object.freeze({
  free: { perMinute: 100, perDay: 1_000 },
  starter: { perMinute: 1_000, perDay: 50_000 },
  pro: { perMinute: 5_000, perDay: 500_000 },
  enterprise: {
    perMinute: Number.POSITIVE_INFINITY,
    perDay: Number.POSITIVE_INFINITY,
  },
});

export interface KeyRecord {
  readonly keyId: string;
  readonly plan: Plan;
  readonly limits: PlanLimits;
  readonly ownerEmail?: string;
}

/**
 * Hash a raw API key with SHA-256. The `api_keys` table stores the hash,
 * never the raw key.
 */
export function hashKey(raw: string): string {
  return createHash('sha256').update(raw.trim()).digest('hex');
}

export interface KeyStore {
  lookup(hashedKey: string): Promise<KeyRecord | null>;
}

interface EnvKeyEntry {
  readonly key?: string;
  readonly keyHash?: string;
  readonly plan?: Plan;
  readonly ownerEmail?: string;
}

/**
 * `API_KEYS_JSON` format — array of entries:
 *
 *   [{ "key": "raw-token", "plan": "starter", "ownerEmail": "a@b.c" }, ...]
 *
 * `keyHash` may be used directly if the caller has pre-hashed the token.
 */
export class EnvKeyStore implements KeyStore {
  private readonly byHash = new Map<string, KeyRecord>();

  constructor(raw: string | undefined = process.env['API_KEYS_JSON']) {
    if (!raw || raw.trim().length === 0) return;
    let entries: EnvKeyEntry[];
    try {
      entries = JSON.parse(raw) as EnvKeyEntry[];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[key-store] invalid API_KEYS_JSON: ${msg}`);
      return;
    }
    if (!Array.isArray(entries)) return;

    let idx = 0;
    for (const entry of entries) {
      idx += 1;
      const hash = entry.keyHash ?? (entry.key ? hashKey(entry.key) : null);
      if (!hash) continue;
      const plan: Plan = entry.plan ?? 'free';
      const record: KeyRecord = {
        keyId: `env-${idx}`,
        plan,
        limits: PLAN_LIMITS[plan],
        ...(entry.ownerEmail !== undefined ? { ownerEmail: entry.ownerEmail } : {}),
      };
      this.byHash.set(hash, record);
    }
  }

  async lookup(hashedKey: string): Promise<KeyRecord | null> {
    return this.byHash.get(hashedKey) ?? null;
  }

  /** Test / bootstrapping helper — add a key programmatically. */
  put(rawKey: string, plan: Plan, ownerEmail?: string): KeyRecord {
    const hash = hashKey(rawKey);
    const record: KeyRecord = {
      keyId: `env-${this.byHash.size + 1}`,
      plan,
      limits: PLAN_LIMITS[plan],
      ...(ownerEmail !== undefined ? { ownerEmail } : {}),
    };
    this.byHash.set(hash, record);
    return record;
  }

  size(): number {
    return this.byHash.size;
  }
}

/**
 * Dev-mode store that accepts ANY key and pins it to the free plan. Used
 * when the server is explicitly told there's no auth.
 */
export class AllowAnyKeyStore implements KeyStore {
  async lookup(): Promise<KeyRecord | null> {
    return {
      keyId: 'dev',
      plan: 'free',
      limits: PLAN_LIMITS.free,
    };
  }
}
