import { ALL_SPORTS, type FetchParams, type FieldResult, type SportType } from '@bbs/shared';
import type { FieldRouter } from '@bbs/orchestrator';

/**
 * Resolvers built around `FieldRouter.fetchField`. The `Match` type's
 * scalar leaves `scores / odds / lineups / stats` are all lazy — they only
 * resolve if the client actually selects them, which lets clients ask for
 * any subset without paying for fields they don't need.
 *
 * `JSON` is a pass-through scalar; we don't introspect source-specific
 * shapes here (normaliser is responsible for the canonical form).
 */

interface MatchSource {
  readonly id: string;
  readonly sport: SportType;
}

function toFieldMeta(res: FieldResult | null): {
  source: string;
  confidence: number;
  cached: boolean;
  fetchedAt: string | null;
  via: string | null;
} {
  if (!res) {
    return { source: 'none', confidence: 0, cached: false, fetchedAt: null, via: null };
  }
  return {
    source: res.source,
    confidence: res.confidence,
    cached: res.via === 'cache',
    fetchedAt: res.fetchedAt,
    via: res.via,
  };
}

async function fetchAndMeta(
  router: FieldRouter,
  field: Parameters<FieldRouter['fetchField']>[0],
  params: FetchParams,
): Promise<{ raw: unknown; meta: ReturnType<typeof toFieldMeta> } | null> {
  const result = await router.fetchField(field, params);
  if (!result) return null;
  return { raw: result.value, meta: toFieldMeta(result) };
}

export interface ResolverContext {
  readonly router: FieldRouter;
}

export function createResolvers(): Record<string, unknown> {
  return {
    // --- JSON scalar (pass-through) --------------------------------------
    JSON: {
      __serialize: (v: unknown) => v,
      __parseValue: (v: unknown) => v,
      __parseLiteral: (ast: unknown) => ast,
    },

    Query: {
      sports: (): Array<{ slug: string; name: string }> =>
        ALL_SPORTS.map((slug) => ({
          slug,
          name: slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        })),

      match: async (
        _root: unknown,
        args: { id: string; sport: string; fields?: readonly string[] },
        _ctx: ResolverContext,
      ): Promise<MatchSource | null> => {
        if (!isSport(args.sport)) return null;
        // Lazy — the Match.* resolvers below do the actual fetches.
        return { id: args.id, sport: args.sport };
      },

      matches: async (
        _root: unknown,
        args: { sport: string; league?: string; date?: string; status?: string },
        ctx: ResolverContext,
      ): Promise<MatchSource[]> => {
        if (!isSport(args.sport)) return [];
        const params: FetchParams = {
          sport: args.sport,
          ...(args.league !== undefined ? { leagueId: args.league } : {}),
          ...(args.date !== undefined ? { date: args.date } : {}),
        };
        const result = await ctx.router.fetchField('scores', params);
        const list = asArrayOfIds(result?.value);
        return list.map((id) => ({ id, sport: args.sport as SportType }));
      },

      player: async (
        _root: unknown,
        args: { id: string; sport: string },
      ): Promise<{ id: string; name: string; sport: SportType; position: string | null } | null> => {
        if (!isSport(args.sport)) return null;
        return { id: args.id, name: args.id, sport: args.sport, position: null };
      },

      standings: async (
        _root: unknown,
        args: { league: string; season?: number },
        ctx: ResolverContext,
      ): Promise<Array<{ leagueId: string; season: number | null; raw: unknown; meta: ReturnType<typeof toFieldMeta> }>> => {
        // Without a sport hint we can't route — caller must supply via the
        // league id. For now we probe football (most common).
        const probe = await ctx.router.fetchField('standings', {
          sport: 'football',
          leagueId: args.league,
          ...(args.season !== undefined ? { season: String(args.season) } : {}),
        });
        if (!probe) return [];
        return [
          {
            leagueId: args.league,
            season: args.season ?? null,
            raw: probe.value,
            meta: toFieldMeta(probe),
          },
        ];
      },

      // --- P-08 resolver stubs -------------------------------------------
      // These return null until the storage-backed cricket / combat query
      // layer ships. REST routes already cover the read path via FieldRouter.
      cricketMatch: async (): Promise<null> => null,
      fightCard: async (): Promise<null> => null,
      mmaBout: async (): Promise<null> => null,
      boxingBout: async (): Promise<null> => null,
      athlete: async (): Promise<null> => null,
    },

    Match: {
      id: (m: MatchSource) => m.id,
      homeTeam: (m: MatchSource) => ({ id: `${m.id}:home`, name: '', sport: m.sport }),
      awayTeam: (m: MatchSource) => ({ id: `${m.id}:away`, name: '', sport: m.sport }),
      kickoffUtc: () => '',
      status: () => 'scheduled',

      scores: async (m: MatchSource, _args: unknown, ctx: ResolverContext) =>
        fetchAndMeta(ctx.router, 'scores', { sport: m.sport, matchId: m.id }),
      odds: async (m: MatchSource, _args: unknown, ctx: ResolverContext) => {
        const res = await ctx.router.fetchField('odds', { sport: m.sport, matchId: m.id });
        if (!res) return null;
        const raws = Array.isArray(res.value) ? res.value : [res.value];
        return raws.map((raw) => ({ raw, meta: toFieldMeta(res) }));
      },
      lineups: async (m: MatchSource, _args: unknown, ctx: ResolverContext) =>
        fetchAndMeta(ctx.router, 'lineups', { sport: m.sport, matchId: m.id }),
      stats: async (m: MatchSource, _args: unknown, ctx: ResolverContext) =>
        fetchAndMeta(ctx.router, 'stats', { sport: m.sport, matchId: m.id }),
      meta: async (m: MatchSource, _args: unknown, ctx: ResolverContext) => {
        const res = await ctx.router.fetchField('scores', { sport: m.sport, matchId: m.id });
        return toFieldMeta(res);
      },
    },

    Subscription: {
      matchUpdated: {
        // Returns an async iterator over Redis pub/sub messages. The P-07
        // scaffold leaves the iterator empty; P-08's live-window publisher
        // wires real events into `bbs:updates:{sportId}`.
        subscribe: async function* () {
          return;
        },
        resolve: (payload: unknown) => payload,
      },
      liveScores: {
        subscribe: async function* () {
          return;
        },
        resolve: (payload: unknown) => payload,
      },
    },
  };
}

function isSport(v: string): v is SportType {
  return (ALL_SPORTS as readonly string[]).includes(v);
}

function asArrayOfIds(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (item && typeof item === 'object') {
      const id = (item as { id?: unknown }).id;
      if (typeof id === 'string' || typeof id === 'number') out.push(String(id));
    }
  }
  return out;
}
