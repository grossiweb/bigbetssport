import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { BattingEntry, BowlingEntry, CricketMatchState } from './cricket.js';
import type { BoxingBout, CombatAthlete, MmaBout } from './combat.js';

/**
 * Postgres writes for the cricket + combat extension tables from
 * migration 002.
 *
 * NOTE (scope): the P-04 deliverable spec included `upsertMatch`,
 * `upsertMatchStats`, `upsertPlayerStats`, and `appendOdds` on this class.
 * Those were held back when P-04 was scoped to entity resolution +
 * normalisation only. They'll land when a follow-up prompt re-opens the
 * storage layer. For now this class ships only the cricket + combat
 * methods required by P-08.
 *
 * All upserts are idempotent via `ON CONFLICT DO NOTHING` guards. Real
 * row-level update semantics (e.g., "re-ingest → patch latest") need
 * follow-up UNIQUE indexes on the migration side.
 */

export class NormalisedStore {
  constructor(private readonly db: Pool) {}

  // --- cricket ------------------------------------------------------------

  /**
   * Append a cricket match-state snapshot. The table is append-only
   * (BIGSERIAL pk), so every call inserts a new row — callers can select
   * `ORDER BY recorded_at DESC LIMIT 1` for the "current" state.
   */
  async upsertCricketMatchState(state: CricketMatchState): Promise<void> {
    await this.db.query(
      `INSERT INTO cricket_match_state
         (match_id, innings_number, batting_team_id, overs_bowled, runs_scored,
          wickets_fallen, target, required_run_rate, dls_target, result_method, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
      [
        state.matchId,
        state.inningsNumber,
        state.battingTeamId,
        state.oversBowled,
        state.runScored,
        state.wicketsFallen,
        state.target ?? null,
        state.requiredRunRate ?? null,
        state.dlsTarget ?? null,
        state.resultMethod ?? null,
      ],
    );
  }

  /**
   * Write a full innings scorecard. Existing rows for the (match_id,
   * innings_number) pair are cleared first so re-ingestion replaces prior
   * data — this is the natural semantics for a live scorecard that
   * updates as the match progresses.
   */
  async upsertCricketScorecard(
    matchId: string,
    innings: number,
    batting: readonly BattingEntry[],
    bowling: readonly BowlingEntry[],
  ): Promise<void> {
    await this.db.query('BEGIN');
    try {
      await this.db.query(
        `DELETE FROM cricket_batting_scorecard WHERE match_id = $1 AND innings_number = $2`,
        [matchId, innings],
      );
      await this.db.query(
        `DELETE FROM cricket_bowling_scorecard WHERE match_id = $1 AND innings_number = $2`,
        [matchId, innings],
      );
      for (const row of batting) {
        await this.db.query(
          `INSERT INTO cricket_batting_scorecard
             (match_id, innings_number, player_id, runs, balls, fours, sixes, strike_rate, dismissal_type)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            matchId,
            innings,
            row.playerId,
            row.runs,
            row.balls,
            row.fours,
            row.sixes,
            row.strikeRate ?? null,
            row.dismissalType ?? null,
          ],
        );
      }
      for (const row of bowling) {
        await this.db.query(
          `INSERT INTO cricket_bowling_scorecard
             (match_id, innings_number, player_id, overs, maidens, runs, wickets, economy, wides, no_balls)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            matchId,
            innings,
            row.playerId,
            row.overs,
            row.maidens,
            row.runs,
            row.wickets,
            row.economy ?? null,
            row.wides,
            row.noBalls,
          ],
        );
      }
      await this.db.query('COMMIT');
    } catch (err) {
      await this.db.query('ROLLBACK').catch(() => {
        /* best-effort */
      });
      throw err;
    }
  }

  // --- combat -------------------------------------------------------------

  async upsertMmaBout(bout: MmaBout): Promise<void> {
    await this.db.query(
      `INSERT INTO mma_bout
         (id, match_id, card_id, event_type, bout_order, weight_class, scheduled_rounds,
          title_fight, championship_id, result_winner_id, result_method, result_round,
          result_time, submission_type, judge_scores)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (id) DO NOTHING`,
      [
        randomUUID(),
        bout.matchId,
        bout.cardId ?? null,
        bout.eventType ?? null,
        bout.boutOrder ?? null,
        bout.weightClass ?? null,
        bout.scheduledRounds,
        bout.titleFight,
        bout.championshipId ?? null,
        bout.resultWinnerId ?? null,
        bout.resultMethod ?? null,
        bout.resultRound ?? null,
        bout.resultTime ?? null,
        bout.submissionType ?? null,
        bout.judgeScores === undefined ? null : JSON.stringify(bout.judgeScores),
      ],
    );
  }

  async upsertBoxingBout(bout: BoxingBout): Promise<void> {
    await this.db.query(
      `INSERT INTO boxing_bout
         (id, match_id, card_id, sanctioning_body, weight_class, scheduled_rounds,
          result_method, result_round, result_time, knockdowns_a, knockdowns_b,
          title_context, judge_scores)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (id) DO NOTHING`,
      [
        randomUUID(),
        bout.matchId,
        bout.cardId ?? null,
        bout.sanctioningBody ?? null,
        bout.weightClass ?? null,
        bout.scheduledRounds,
        bout.resultMethod ?? null,
        bout.resultRound ?? null,
        bout.resultTime ?? null,
        bout.knockdownsA,
        bout.knockdownsB,
        bout.titleContext ?? null,
        bout.judgeScores === undefined ? null : JSON.stringify(bout.judgeScores),
      ],
    );
  }

  /**
   * Insert-or-update a combat athlete. Returns the athlete_id so callers
   * can immediately link bouts / stats. When the input doesn't supply an
   * id, we generate a fresh UUID.
   */
  async upsertCombatAthlete(athlete: CombatAthlete): Promise<string> {
    const id = athlete.athleteId ?? randomUUID();
    await this.db.query(
      `INSERT INTO combat_athlete
         (athlete_id, name, nationality, dob, height_cm, reach_cm, stance,
          record_wins, record_losses, record_draws, record_nc,
          current_ranking, weight_class, promoter)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (athlete_id) DO UPDATE SET
         name = EXCLUDED.name,
         record_wins = EXCLUDED.record_wins,
         record_losses = EXCLUDED.record_losses,
         record_draws = EXCLUDED.record_draws,
         record_nc = EXCLUDED.record_nc,
         current_ranking = EXCLUDED.current_ranking,
         weight_class = EXCLUDED.weight_class`,
      [
        id,
        athlete.name,
        athlete.nationality ?? null,
        athlete.dob ?? null,
        athlete.heightCm ?? null,
        athlete.reachCm ?? null,
        athlete.stance ?? null,
        athlete.recordWins,
        athlete.recordLosses,
        athlete.recordDraws,
        athlete.recordNc,
        athlete.currentRanking ?? null,
        athlete.weightClass ?? null,
        athlete.promoter ?? null,
      ],
    );
    return id;
  }
}
