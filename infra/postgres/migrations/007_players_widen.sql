-- Sprint 4 follow-up: TheSportsDB returns height/weight as strings like
-- "6 ft 3 in (191 cm)" or "210 lbs (95 kg)". Widen from 20 → 64 to fit.

ALTER TABLE players
  ALTER COLUMN height TYPE VARCHAR(64),
  ALTER COLUMN weight TYPE VARCHAR(64),
  ALTER COLUMN jersey_number TYPE VARCHAR(20);
