-- ===========================================================================
-- Big Ball Sports — initial schema
-- Target: PostgreSQL 16 + TimescaleDB
-- ===========================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "timescaledb";

-- ---------------------------------------------------------------------------
-- Catalogue tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sports (
    bbs_id     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name       VARCHAR(100) NOT NULL,
    slug       VARCHAR(40)  NOT NULL UNIQUE,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leagues (
    bbs_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sport_id     UUID NOT NULL REFERENCES sports(bbs_id) ON DELETE CASCADE,
    name         VARCHAR(200) NOT NULL,
    country      VARCHAR(100),
    season       VARCHAR(20),
    external_ids JSONB NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (sport_id, name, season)
);

CREATE TABLE IF NOT EXISTS venues (
    bbs_id  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name    VARCHAR(200) NOT NULL,
    city    VARCHAR(100),
    country VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS teams (
    bbs_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    league_id    UUID REFERENCES leagues(bbs_id) ON DELETE SET NULL,
    name         VARCHAR(200) NOT NULL,
    short_name   VARCHAR(50),
    aliases      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    logo_url     TEXT,
    external_ids JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS players (
    bbs_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id      UUID REFERENCES teams(bbs_id) ON DELETE SET NULL,
    name         VARCHAR(200) NOT NULL,
    dob          DATE,
    position     VARCHAR(50),
    nationality  VARCHAR(100),
    external_ids JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- ---------------------------------------------------------------------------
-- Match data
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS matches (
    bbs_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    league_id    UUID REFERENCES leagues(bbs_id) ON DELETE SET NULL,
    home_id      UUID REFERENCES teams(bbs_id) ON DELETE SET NULL,
    away_id      UUID REFERENCES teams(bbs_id) ON DELETE SET NULL,
    kickoff_utc  TIMESTAMPTZ NOT NULL,
    status       VARCHAR(20) NOT NULL DEFAULT 'scheduled',
    sport_type   VARCHAR(20) NOT NULL,
    external_ids JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS match_stats (
    id         BIGSERIAL,
    match_id   UUID NOT NULL REFERENCES matches(bbs_id) ON DELETE CASCADE,
    team_id    UUID REFERENCES teams(bbs_id) ON DELETE SET NULL,
    field      VARCHAR(50) NOT NULL,
    value      JSONB       NOT NULL,
    source     VARCHAR(50) NOT NULL,
    confidence DECIMAL(3,2) NOT NULL DEFAULT 1.00,
    fetched_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, fetched_at)
);

CREATE TABLE IF NOT EXISTS player_stats (
    id         BIGSERIAL PRIMARY KEY,
    match_id   UUID NOT NULL REFERENCES matches(bbs_id) ON DELETE CASCADE,
    player_id  UUID NOT NULL REFERENCES players(bbs_id) ON DELETE CASCADE,
    field      VARCHAR(50) NOT NULL,
    value      JSONB       NOT NULL,
    source     VARCHAR(50) NOT NULL,
    confidence DECIMAL(3,2) NOT NULL DEFAULT 1.00,
    fetched_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS odds (
    id         BIGSERIAL,
    match_id   UUID NOT NULL REFERENCES matches(bbs_id) ON DELETE CASCADE,
    market     VARCHAR(50) NOT NULL,
    sportsbook VARCHAR(50) NOT NULL,
    line       JSONB       NOT NULL,
    fetched_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, fetched_at)
);

-- ---------------------------------------------------------------------------
-- Entity resolution
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS entity_aliases (
    id          BIGSERIAL PRIMARY KEY,
    entity_type VARCHAR(20) NOT NULL,
    bbs_id      UUID        NOT NULL,
    alias       TEXT        NOT NULL,
    source      VARCHAR(50) NOT NULL,
    UNIQUE (entity_type, alias, source)
);

CREATE TABLE IF NOT EXISTS unresolved_entities (
    id          BIGSERIAL PRIMARY KEY,
    entity_type VARCHAR(20) NOT NULL,
    raw_name    TEXT        NOT NULL,
    source      VARCHAR(50) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- API keys (gateway auth)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS api_keys (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key_hash     VARCHAR(64) NOT NULL UNIQUE,
    plan         VARCHAR(20) NOT NULL DEFAULT 'free',
    owner_email  VARCHAR(320),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- Timescale hypertables
-- Must be declared BEFORE any data is inserted.
-- ---------------------------------------------------------------------------

SELECT create_hypertable(
    'odds',
    'fetched_at',
    if_not_exists  => TRUE,
    migrate_data   => TRUE
);

SELECT create_hypertable(
    'match_stats',
    'fetched_at',
    if_not_exists  => TRUE,
    migrate_data   => TRUE
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_matches_kickoff       ON matches (kickoff_utc);
CREATE INDEX IF NOT EXISTS idx_matches_status        ON matches (status);
CREATE INDEX IF NOT EXISTS idx_matches_league        ON matches (league_id);
CREATE INDEX IF NOT EXISTS idx_matches_sport_type    ON matches (sport_type);

CREATE INDEX IF NOT EXISTS idx_odds_match_fetched
    ON odds (match_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_match_stats_match_fetched
    ON match_stats (match_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_player_stats_match
    ON player_stats (match_id);
CREATE INDEX IF NOT EXISTS idx_player_stats_player
    ON player_stats (player_id);

CREATE INDEX IF NOT EXISTS idx_entity_aliases_alias  ON entity_aliases (alias);
CREATE INDEX IF NOT EXISTS idx_entity_aliases_bbs_id ON entity_aliases (bbs_id);
CREATE INDEX IF NOT EXISTS idx_entity_aliases_type   ON entity_aliases (entity_type);

CREATE INDEX IF NOT EXISTS idx_unresolved_type_source
    ON unresolved_entities (entity_type, source) WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_teams_league ON teams (league_id);
CREATE INDEX IF NOT EXISTS idx_players_team ON players (team_id);

-- ---------------------------------------------------------------------------
-- Trigger: keep matches.updated_at fresh
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_matches_updated_at ON matches;
CREATE TRIGGER trg_matches_updated_at
    BEFORE UPDATE ON matches
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
