import { z } from 'zod';
import { ALL_FIELD_KEYS, ALL_SPORTS, type FieldKey, type SportType } from './types.js';

// ---------------------------------------------------------------------------
// Shared runtime validators.
// Gateway / orchestrator / normaliser all use these — do not duplicate.
// ---------------------------------------------------------------------------

const FIELD_KEY_VALUES = ALL_FIELD_KEYS as readonly [FieldKey, ...FieldKey[]];
const SPORT_VALUES = ALL_SPORTS as readonly [SportType, ...SportType[]];

/** 32+ lowercase hex chars, optionally prefixed with `bbs_`. */
export const ApiKeySchema = z
  .string()
  .regex(/^(bbs_)?[a-f0-9]{32,128}$/i, 'Invalid API key format');

export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type Pagination = z.infer<typeof PaginationSchema>;

export const FieldKeySchema = z.enum(FIELD_KEY_VALUES);
export const SportTypeSchema = z.enum(SPORT_VALUES);

/**
 * Accepts either a comma-separated string (`?fields=scores,odds`) or an array
 * form. Normalises to `FieldKey[]`.
 */
export const FieldSelectionSchema = z
  .union([z.string(), z.array(FieldKeySchema)])
  .transform((input, ctx): FieldKey[] => {
    if (Array.isArray(input)) return input;
    const parts = input
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const known = FIELD_KEY_VALUES as readonly string[];
    for (const p of parts) {
      if (!known.includes(p)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown field: ${p}`,
        });
        return z.NEVER;
      }
    }
    return parts as FieldKey[];
  });

const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be ISO YYYY-MM-DD');

const SeasonSchema = z
  .string()
  .regex(/^\d{4}(-\d{2,4})?$/, 'season must be YYYY or YYYY-YY(YY)');

export const MatchQuerySchema = z.object({
  sport: SportTypeSchema,
  matchId: z.string().min(1).optional(),
  leagueId: z.string().min(1).optional(),
  date: IsoDateSchema.optional(),
  season: SeasonSchema.optional(),
  fields: FieldSelectionSchema.optional(),
});
export type MatchQuery = z.infer<typeof MatchQuerySchema>;

export const PlayerQuerySchema = z.object({
  sport: SportTypeSchema,
  playerId: z.string().min(1).optional(),
  teamId: z.string().min(1).optional(),
  season: SeasonSchema.optional(),
  fields: FieldSelectionSchema.optional(),
});
export type PlayerQuery = z.infer<typeof PlayerQuerySchema>;

export const StandingsQuerySchema = z.object({
  sport: SportTypeSchema,
  leagueId: z.string().min(1),
  season: SeasonSchema.optional(),
});
export type StandingsQuery = z.infer<typeof StandingsQuerySchema>;
