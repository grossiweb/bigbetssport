-- Sprint 4: extend players table with common profile fields.

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS jersey_number VARCHAR(10),
  ADD COLUMN IF NOT EXISTS height        VARCHAR(20),
  ADD COLUMN IF NOT EXISTS weight        VARCHAR(20),
  ADD COLUMN IF NOT EXISTS headshot_url  TEXT,
  ADD COLUMN IF NOT EXISTS description   TEXT;

-- Look up by TheSportsDB player id (one per player in their system).
CREATE UNIQUE INDEX IF NOT EXISTS players_external_thesportsdb
  ON players ((external_ids->>'thesportsdb'))
  WHERE external_ids ? 'thesportsdb';

-- Fast "players for this team" queries.
CREATE INDEX IF NOT EXISTS players_team_name
  ON players (team_id, name);
