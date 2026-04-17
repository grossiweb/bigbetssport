import type { Redis } from 'ioredis';
import { REDIS_KEYS, childLogger, circuitState, CIRCUIT_STATE_CODE } from '@bbs/shared';

const cbLog = childLogger({ component: 'circuit-breaker' });

/**
 * Three-state circuit breaker with Redis-backed state.
 *
 *   closed    → all traffic allowed; failure counter tracks consecutive fails
 *   open      → all traffic rejected; cooldown timer is running
 *   half-open → cooldown elapsed; we issue `halfOpenProbes` probes to decide
 *               whether upstream has recovered. Extra traffic is still
 *               rejected during this window.
 *
 * Redis layout:
 *   cb:{id}            → 'open' | 'half-open'   (missing = closed)
 *   cb:{id}:cooldown   → '1'     (exists ↔ still in open cooldown phase; PX-expiring)
 *   cb:{id}:probe      → N       (in-flight probe counter)
 *   cb:{id}:fails      → N       (consecutive failure counter; window-expiring)
 */

export type CBState = 'closed' | 'open' | 'half-open';

export interface CBConfig {
  readonly failureThreshold?: number;
  readonly cooldownMs?: number;
  readonly halfOpenProbes?: number;
  readonly failWindowMs?: number;
}

export const CB_DEFAULTS = {
  failureThreshold: 3,
  cooldownMs: 60_000,
  halfOpenProbes: 1,
  failWindowMs: 5 * 60_000,
} as const;

// Legacy pure helper retained for test harness consumers.
export function shouldOpen(failCount: number, threshold: number): boolean {
  return failCount >= threshold;
}

function cooldownKey(sourceId: string): string {
  return `${REDIS_KEYS.cb(sourceId)}:cooldown`;
}
function probeKey(sourceId: string): string {
  return `${REDIS_KEYS.cb(sourceId)}:probe`;
}

/**
 * Atomic allowRequest logic. Structure:
 *   KEYS: state, cooldown, probe
 *   ARGV: halfOpenProbes
 *
 *   returns an array:
 *     [allowed, newState]
 *
 *   allowed:  1 = caller may issue the request, 0 = blocked
 *   newState: 'closed' | 'open' | 'half-open'
 */
const LUA_ALLOW = `
local state_key = KEYS[1]
local cooldown_key = KEYS[2]
local probe_key = KEYS[3]
local max_probes = tonumber(ARGV[1])

local state = redis.call('GET', state_key)

if not state then
  return {1, 'closed'}
end

if state == 'open' then
  local cooling = redis.call('EXISTS', cooldown_key)
  if cooling == 1 then
    return {0, 'open'}
  end
  -- cooldown elapsed: promote to half-open and try to grab the first probe slot.
  redis.call('SET', state_key, 'half-open')
  local probes = redis.call('INCR', probe_key)
  if probes <= max_probes then
    return {1, 'half-open'}
  else
    redis.call('DECR', probe_key)
    return {0, 'half-open'}
  end
end

if state == 'half-open' then
  local probes = redis.call('INCR', probe_key)
  if probes <= max_probes then
    return {1, 'half-open'}
  else
    redis.call('DECR', probe_key)
    return {0, 'half-open'}
  end
end

return {1, 'closed'}
`;

const COMMAND_NAME = 'bbsCbAllow';

interface RedisWithCb {
  bbsCbAllow(
    stateKey: string,
    cooldownKey: string,
    probeKey: string,
    halfOpenProbes: string,
  ): Promise<[number, string]>;
}

function defineOnce(redis: Redis): void {
  const tagged = redis as unknown as { __bbsCbAllowDefined?: boolean };
  if (tagged.__bbsCbAllowDefined) return;
  redis.defineCommand(COMMAND_NAME, { numberOfKeys: 3, lua: LUA_ALLOW });
  tagged.__bbsCbAllowDefined = true;
}

export class CircuitBreaker {
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly halfOpenProbes: number;
  private readonly failWindowMs: number;

  constructor(
    private readonly redis: Redis,
    private readonly sourceId: string,
    config: CBConfig = {},
  ) {
    this.threshold = config.failureThreshold ?? CB_DEFAULTS.failureThreshold;
    this.cooldownMs = config.cooldownMs ?? CB_DEFAULTS.cooldownMs;
    this.halfOpenProbes = config.halfOpenProbes ?? CB_DEFAULTS.halfOpenProbes;
    this.failWindowMs = config.failWindowMs ?? CB_DEFAULTS.failWindowMs;
    defineOnce(redis);
  }

  async getState(): Promise<CBState> {
    const raw = await this.redis.get(REDIS_KEYS.cb(this.sourceId));
    if (raw === 'open' || raw === 'half-open') return raw;
    return 'closed';
  }

  /**
   * Decide whether to allow one more request through. The call is atomic:
   * if the breaker is currently half-open and we're out of probe slots,
   * `false` is returned without consuming a slot.
   */
  async allowRequest(): Promise<boolean> {
    const [allowed] = await (this.redis as unknown as RedisWithCb).bbsCbAllow(
      REDIS_KEYS.cb(this.sourceId),
      cooldownKey(this.sourceId),
      probeKey(this.sourceId),
      String(this.halfOpenProbes),
    );
    return allowed === 1;
  }

  /**
   * Record a successful upstream call. Transitions:
   *   closed    → closed      (reset fails counter)
   *   half-open → closed      (probe succeeded → trust restored)
   *   open      → open        (shouldn't happen but no-op defensively)
   */
  async recordSuccess(): Promise<void> {
    const state = await this.getState();
    await this.redis
      .multi()
      .del(REDIS_KEYS.cbFails(this.sourceId))
      .del(probeKey(this.sourceId))
      .exec();
    if (state !== 'closed') {
      await this.redis
        .multi()
        .del(REDIS_KEYS.cb(this.sourceId))
        .del(cooldownKey(this.sourceId))
        .exec();
      cbLog.warn(
        { sourceId: this.sourceId, from: state, to: 'closed' },
        'circuit breaker state change',
      );
    }
    circuitState.set({ source_id: this.sourceId }, CIRCUIT_STATE_CODE['closed'] ?? 0);
  }

  /**
   * Record a failed upstream call.
   *
   *   closed:    increment fails counter; open the breaker if threshold hit.
   *   half-open: immediately reopen — the probe failed.
   *   open:      already open; no-op.
   *
   * Returns `{ opened: true }` when this call transitioned the breaker
   * into the open state.
   */
  async recordFailure(): Promise<{ opened: boolean }> {
    const state = await this.getState();

    if (state === 'open') return { opened: false };

    if (state === 'half-open') {
      await this.openFor(this.cooldownMs);
      cbLog.warn(
        { sourceId: this.sourceId, from: 'half-open', to: 'open' },
        'circuit breaker state change',
      );
      circuitState.set({ source_id: this.sourceId }, CIRCUIT_STATE_CODE['open'] ?? 1);
      return { opened: true };
    }

    const fails = await this.redis.incr(REDIS_KEYS.cbFails(this.sourceId));
    if (fails === 1) {
      await this.redis.pexpire(REDIS_KEYS.cbFails(this.sourceId), this.failWindowMs);
    }
    if (shouldOpen(fails, this.threshold)) {
      await this.openFor(this.cooldownMs);
      cbLog.warn(
        { sourceId: this.sourceId, from: 'closed', to: 'open', fails },
        'circuit breaker state change',
      );
      circuitState.set({ source_id: this.sourceId }, CIRCUIT_STATE_CODE['open'] ?? 1);
      return { opened: true };
    }
    return { opened: false };
  }

  /**
   * Force the breaker into the open state. Used for manual intervention.
   */
  async trip(): Promise<void> {
    await this.openFor(this.cooldownMs);
  }

  /**
   * Clear all breaker state for this source.
   */
  async reset(): Promise<void> {
    await this.redis
      .multi()
      .del(REDIS_KEYS.cb(this.sourceId))
      .del(cooldownKey(this.sourceId))
      .del(probeKey(this.sourceId))
      .del(REDIS_KEYS.cbFails(this.sourceId))
      .exec();
  }

  private async openFor(cooldownMs: number): Promise<void> {
    await this.redis
      .multi()
      .set(REDIS_KEYS.cb(this.sourceId), 'open')
      .set(cooldownKey(this.sourceId), '1', 'PX', cooldownMs)
      .del(probeKey(this.sourceId))
      .del(REDIS_KEYS.cbFails(this.sourceId))
      .exec();
  }
}
