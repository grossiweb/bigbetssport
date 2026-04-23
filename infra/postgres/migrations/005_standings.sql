-- Sprint 2: Season standings (W/L/T per team per league).
-- Sourced from ESPN public endpoints (sport/league scoped).

CREATE TABLE IF NOT EXISTS standings (
    id            BIGSERIAL PRIMARY KEY,
    league_id     UUID NOT NULL REFERENCES leagues(bbs_id) ON DELETE CASCADE,
    team_id       UUID NOT NULL REFERENCES teams(bbs_id)   ON DELETE CASCADE,
    season        VARCHAR(20) NOT NULL,
    rank          INT,
    games_played  INT,
    wins          INT,
    losses        INT,
    ties          INT DEFAULT 0,
    win_pct       NUMERIC(5,4),
    points_for    NUMERIC(10,2),
    points_against NUMERIC(10,2),
    streak        VARCHAR(20),
    source        VARCHAR(50) NOT NULL DEFAULT 'espn',
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (league_id, team_id, season, source)
);

CREATE INDEX IF NOT EXISTS standings_league_season
  ON standings (league_id, season, rank);
