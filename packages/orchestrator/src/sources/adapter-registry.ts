import type { SourceAdapter } from './adapter.js';
import nhlAdapter from './tier1/nhl.js';
import mlbAdapter from './tier1/mlb.js';
import nbaAdapter from './tier1/nba.js';
import openLigaDbAdapter from './tier1/openligadb.js';
import fplAdapter from './tier1/fpl.js';
import openF1Adapter from './tier1/openf1.js';
import cflAdapter from './tier1/cfl.js';
import cfbAdapter from './tier1/cfb.js';
import theRundownAdapter from './tier2/therundown.js';
import apiSportsAdapter from './tier2/api-sports.js';
import theSportsDbAdapter from './tier2/thesportsdb.js';
import ballDontLieAdapter from './tier2/balldontlie.js';
import sportmonksAdapter from './tier2/sportmonks.js';
import footballDataAdapter from './tier2/football-data.js';
import highlightlyAdapter from './tier2/highlightly.js';
import isportsAdapter from './tier2/isports.js';
import sportsrcAdapter from './tier2/sportsrc.js';
import pandaScoreAdapter from './tier2/pandascore.js';
import cricketDataAdapter from './tier2/cricketdata.js';
import mmaApiAdapter from './tier2/mmaapi.js';

/**
 * Build the default adapter map. One entry per source id from
 * `sources/registry.ts`. If a new source is added to the catalogue, its
 * adapter must be registered here or the field router will skip it.
 */
export function createAdapterRegistry(): Map<string, SourceAdapter> {
  const entries: readonly SourceAdapter[] = [
    nhlAdapter,
    mlbAdapter,
    nbaAdapter,
    openLigaDbAdapter,
    fplAdapter,
    openF1Adapter,
    cflAdapter,
    cfbAdapter,
    theRundownAdapter,
    apiSportsAdapter,
    theSportsDbAdapter,
    ballDontLieAdapter,
    sportmonksAdapter,
    footballDataAdapter,
    highlightlyAdapter,
    isportsAdapter,
    sportsrcAdapter,
    pandaScoreAdapter,
    cricketDataAdapter,
    mmaApiAdapter,
  ];

  const map = new Map<string, SourceAdapter>();
  for (const a of entries) {
    if (map.has(a.sourceId)) {
      throw new Error(`duplicate adapter id: ${a.sourceId}`);
    }
    map.set(a.sourceId, a);
  }
  return map;
}
