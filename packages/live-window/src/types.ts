import type { SportType } from '@bbs/shared';

export interface Fixture {
  readonly eventId: string;
  readonly sport: SportType;
  readonly kickoffUtc: string;
  readonly homeTeam: string;
  readonly awayTeam: string;
  readonly leagueId?: string;
}
