-- Sprint: advanced stats — per-period scores + game metadata + play-by-play.

-- Per-match summary: linescore (quarters/innings/periods), attendance, broadcast.
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS linescore   JSONB,
  ADD COLUMN IF NOT EXISTS attendance  INT,
  ADD COLUMN IF NOT EXISTS broadcast   VARCHAR(100);

-- match_events: each play / goal / strike / etc. from ESPN or other sources.
-- Lets us compute shot charts, scoring streaks, quarter-by-quarter timelines.
CREATE TABLE IF NOT EXISTS match_events (
    id                BIGSERIAL PRIMARY KEY,
    match_id          UUID NOT NULL REFERENCES matches(bbs_id) ON DELETE CASCADE,
    source            VARCHAR(50) NOT NULL,
    external_id       VARCHAR(100),                              -- source's play id
    sequence_number   INT,                                       -- ordering
    period            INT,                                       -- quarter/inning/period
    period_display    VARCHAR(40),                               -- e.g., "1st Quarter"
    clock             VARCHAR(20),
    type              VARCHAR(50),                               -- ESPN play type text
    description       TEXT,
    team_id           UUID REFERENCES teams(bbs_id)   ON DELETE SET NULL,
    player_id         UUID REFERENCES players(bbs_id) ON DELETE SET NULL,
    scoring_play      BOOLEAN NOT NULL DEFAULT FALSE,
    score_value       INT,
    home_score        INT,
    away_score        INT,
    coordinate_x      NUMERIC(10,2),
    coordinate_y      NUMERIC(10,2),
    wallclock         TIMESTAMPTZ,
    UNIQUE (match_id, source, external_id)
);

CREATE INDEX IF NOT EXISTS match_events_match_seq
  ON match_events (match_id, sequence_number);

CREATE INDEX IF NOT EXISTS match_events_match_scoring
  ON match_events (match_id, scoring_play)
  WHERE scoring_play = TRUE;

CREATE INDEX IF NOT EXISTS match_events_match_period
  ON match_events (match_id, period);
