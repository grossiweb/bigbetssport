import type { FastifyInstance } from 'fastify';
import { ALL_SPORTS } from '@bbs/shared';
import type { AuthedRequest } from '../auth.js';

/**
 * Catalogue routes. The Big Ball Sports sport list is a static enum from
 * `@bbs/shared`. League data would come from the `leagues` table — for
 * P-07 we return a small curated list, left as a seed for the storage
 * layer to replace.
 */

interface LeagueCatalogueEntry {
  readonly id: string;
  readonly name: string;
  readonly sport: string;
  readonly country: string;
}

const LEAGUES: readonly LeagueCatalogueEntry[] = [
  { id: 'epl', name: 'English Premier League', sport: 'football', country: 'england' },
  { id: 'laliga', name: 'La Liga', sport: 'football', country: 'spain' },
  { id: 'bundesliga', name: 'Bundesliga', sport: 'football', country: 'germany' },
  { id: 'serie-a', name: 'Serie A', sport: 'football', country: 'italy' },
  { id: 'ligue-1', name: 'Ligue 1', sport: 'football', country: 'france' },
  { id: 'mls', name: 'Major League Soccer', sport: 'football', country: 'usa' },
  { id: 'nfl', name: 'National Football League', sport: 'american_football', country: 'usa' },
  { id: 'ncaaf', name: 'NCAA Football', sport: 'american_football', country: 'usa' },
  { id: 'nba', name: 'National Basketball Association', sport: 'basketball', country: 'usa' },
  { id: 'mlb', name: 'Major League Baseball', sport: 'baseball', country: 'usa' },
  { id: 'nhl', name: 'National Hockey League', sport: 'ice_hockey', country: 'usa' },
  { id: 'ipl', name: 'Indian Premier League', sport: 'cricket', country: 'india' },
  { id: 'ufc', name: 'UFC', sport: 'mma', country: 'usa' },
];

function envelope<T>(data: T, requestId: string, source = 'catalogue') {
  return {
    data,
    meta: {
      source,
      confidence: 1,
      cached: false,
      cache_age_ms: 0,
      request_id: requestId,
    },
    error: null,
  };
}

export async function registerSportsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/sports', async (req) => {
    const rid = (req as AuthedRequest).requestId ?? '';
    return envelope(
      ALL_SPORTS.map((slug) => ({ slug, name: humanise(slug) })),
      rid,
    );
  });

  app.get<{ Querystring: { sport?: string; country?: string } }>(
    '/v1/leagues',
    async (req) => {
      const rid = (req as AuthedRequest).requestId ?? '';
      const { sport, country } = req.query;
      let out = LEAGUES;
      if (sport) out = out.filter((l) => l.sport === sport);
      if (country) out = out.filter((l) => l.country === country);
      return envelope(out, rid);
    },
  );

  app.get<{ Params: { id: string } }>('/v1/leagues/:id', async (req, reply) => {
    const rid = (req as AuthedRequest).requestId ?? '';
    const league = LEAGUES.find((l) => l.id === req.params.id);
    if (!league) {
      return reply.status(404).send({
        data: null,
        meta: {
          source: 'catalogue',
          confidence: 0,
          cached: false,
          cache_age_ms: 0,
          request_id: rid,
        },
        error: { code: 'not_found', message: `unknown league: ${req.params.id}` },
      });
    }
    return envelope(league, rid);
  });
}

function humanise(slug: string): string {
  return slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
