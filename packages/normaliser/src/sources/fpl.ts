import type { EntityResolver } from '../entity-resolver.js';
import type { NormalisedPayload, NormalisedPlayer } from '../types.js';

/**
 * Fantasy Premier League — normaliser for `players`.
 *
 * Parses `elements[]` from /bootstrap-static/. Positions come from
 * `element_type`: 1=GK, 2=DEF, 3=MID, 4=FWD.
 */

interface FplElement {
  id?: number;
  first_name?: string;
  second_name?: string;
  web_name?: string;
  team?: number;
  team_code?: number;
  element_type?: number;
}

const POSITION_MAP: Readonly<Record<number, string>> = {
  1: 'GK',
  2: 'DEF',
  3: 'MID',
  4: 'FWD',
};

function fullName(el: FplElement): string | null {
  const first = el.first_name?.trim();
  const second = el.second_name?.trim();
  if (first && second) return `${first} ${second}`;
  if (el.web_name) return el.web_name.trim();
  return null;
}

export async function normaliseFplPlayers(
  raw: unknown,
  resolver: EntityResolver,
  source: string,
): Promise<NormalisedPayload | null> {
  if (raw === null || typeof raw !== 'object') return null;
  const elements = (raw as { elements?: unknown[] }).elements;
  if (!Array.isArray(elements)) return null;

  const out: NormalisedPlayer[] = [];
  for (const el of elements as FplElement[]) {
    if (!el || typeof el !== 'object') continue;
    const name = fullName(el);
    if (!name) continue;

    const resolved = await resolver.resolvePlayer(name);
    // Unlike matches, players are more often new/unresolved — we still emit
    // the canonical shape so the storage layer can insert as a new player.
    const player: NormalisedPlayer = {
      ...(resolved.confidence >= 0.5 ? { bbs_id: resolved.bbs_id } : {}),
      name,
      ...(el.element_type && POSITION_MAP[el.element_type]
        ? { position: POSITION_MAP[el.element_type] }
        : {}),
      source,
      confidence: resolved.confidence,
    };
    out.push(player);
  }

  return { kind: 'players', data: out };
}
