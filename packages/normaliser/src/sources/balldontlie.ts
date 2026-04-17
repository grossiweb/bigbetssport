import type { EntityResolver } from '../entity-resolver.js';
import type { NormalisedPayload, NormalisedStats } from '../types.js';

/**
 * balldontlie — normaliser for `stats`.
 *
 * `data[]` is a list of per-player per-game stat lines. We explode each
 * line into several NormalisedStats rows (one per metric) so the storage
 * layer can fan them out across `player_stats` rows.
 */

interface BdlPlayerRef {
  id?: number;
  first_name?: string;
  last_name?: string;
  team?: { id?: number; full_name?: string };
}

interface BdlGameRef {
  id?: number;
  date?: string;
}

interface BdlStat {
  id?: number;
  game?: BdlGameRef;
  player?: BdlPlayerRef;
  team?: { id?: number; full_name?: string };
  pts?: number;
  reb?: number;
  ast?: number;
  stl?: number;
  blk?: number;
  turnover?: number;
  min?: string;
  fg_pct?: number;
  fg3_pct?: number;
  ft_pct?: number;
}

const METRIC_FIELDS: readonly (keyof BdlStat)[] = [
  'pts',
  'reb',
  'ast',
  'stl',
  'blk',
  'turnover',
  'min',
  'fg_pct',
  'fg3_pct',
  'ft_pct',
];

export async function normaliseBallDontLieStats(
  raw: unknown,
  resolver: EntityResolver,
  source: string,
): Promise<NormalisedPayload | null> {
  if (raw === null || typeof raw !== 'object') return null;
  const data = (raw as { data?: unknown[] }).data;
  if (!Array.isArray(data)) return null;

  const out: NormalisedStats[] = [];
  const fetchedAt = new Date().toISOString();

  for (const entry of data as BdlStat[]) {
    if (!entry || typeof entry !== 'object') continue;
    const playerName =
      entry.player && entry.player.first_name && entry.player.last_name
        ? `${entry.player.first_name} ${entry.player.last_name}`
        : null;
    const teamName = entry.team?.full_name ?? entry.player?.team?.full_name ?? null;
    if (!playerName || !teamName || !entry.game?.id) continue;

    const [teamRes, playerRes] = await Promise.all([
      resolver.resolveTeam(teamName, 'basketball', source),
      resolver.resolvePlayer(playerName),
    ]);
    if (teamRes.confidence < 0.5 || playerRes.confidence < 0.5) continue;

    const matchBbsId = String(entry.game.id);
    const confidence = Math.min(teamRes.confidence, playerRes.confidence);

    for (const key of METRIC_FIELDS) {
      const value = entry[key];
      if (value === undefined || value === null) continue;
      out.push({
        match_bbs_id: matchBbsId,
        team_bbs_id: teamRes.bbs_id,
        player_bbs_id: playerRes.bbs_id,
        field: String(key),
        value,
        source,
        confidence,
        fetchedAt,
      });
    }
  }

  return { kind: 'stats', data: out };
}
