-- Indexes that make ingestion upserts cheap.
-- Idempotent via IF NOT EXISTS.

-- Look up a match by its Rundown event_id in one shot.
CREATE UNIQUE INDEX IF NOT EXISTS matches_external_therundown
  ON matches ((external_ids->>'therundown'))
  WHERE external_ids ? 'therundown';

-- Same for teams — one row per Rundown team_id.
CREATE UNIQUE INDEX IF NOT EXISTS teams_external_therundown
  ON teams ((external_ids->>'therundown'))
  WHERE external_ids ? 'therundown';

-- Fast "today's matches" queries hitting /v1/matches?sport=&date=
CREATE INDEX IF NOT EXISTS matches_sport_kickoff
  ON matches (sport_type, kickoff_utc DESC);

-- odds is a hypertable keyed on (match_id, fetched_at). Add a simple
-- secondary index for dashboard "latest line per market" queries.
CREATE INDEX IF NOT EXISTS odds_match_market_fetched
  ON odds (match_id, market, fetched_at DESC);
