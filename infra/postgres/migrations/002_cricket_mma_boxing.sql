-- ===========================================================================
-- Big Ball Sports — sport-specific extensions: cricket, MMA, boxing
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Cricket
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cricket_match_state (
    id                 BIGSERIAL PRIMARY KEY,
    match_id           UUID NOT NULL REFERENCES matches(bbs_id) ON DELETE CASCADE,
    innings_number     SMALLINT NOT NULL,
    batting_team_id    UUID REFERENCES teams(bbs_id) ON DELETE SET NULL,
    overs_bowled       DECIMAL(5,1) NOT NULL DEFAULT 0,
    runs_scored        INT NOT NULL DEFAULT 0,
    wickets_fallen     SMALLINT NOT NULL DEFAULT 0,
    target             INT,
    required_run_rate  DECIMAL(5,2),
    dls_target         INT,
    result_method      VARCHAR(20),
    recorded_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cricket_match_state_match
    ON cricket_match_state (match_id, innings_number);

CREATE TABLE IF NOT EXISTS cricket_batting_scorecard (
    id                  BIGSERIAL PRIMARY KEY,
    match_id            UUID NOT NULL REFERENCES matches(bbs_id) ON DELETE CASCADE,
    innings_number      SMALLINT NOT NULL,
    player_id           UUID NOT NULL REFERENCES players(bbs_id) ON DELETE CASCADE,
    runs                INT NOT NULL DEFAULT 0,
    balls               INT NOT NULL DEFAULT 0,
    fours               SMALLINT NOT NULL DEFAULT 0,
    sixes               SMALLINT NOT NULL DEFAULT 0,
    strike_rate         DECIMAL(6,2),
    dismissal_type      VARCHAR(30),
    dismissal_bowler_id UUID REFERENCES players(bbs_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_cricket_batting_match
    ON cricket_batting_scorecard (match_id, innings_number);

CREATE TABLE IF NOT EXISTS cricket_bowling_scorecard (
    id             BIGSERIAL PRIMARY KEY,
    match_id       UUID NOT NULL REFERENCES matches(bbs_id) ON DELETE CASCADE,
    innings_number SMALLINT NOT NULL,
    player_id      UUID NOT NULL REFERENCES players(bbs_id) ON DELETE CASCADE,
    overs          DECIMAL(5,1) NOT NULL DEFAULT 0,
    maidens        SMALLINT NOT NULL DEFAULT 0,
    runs           INT NOT NULL DEFAULT 0,
    wickets        SMALLINT NOT NULL DEFAULT 0,
    economy        DECIMAL(5,2),
    wides          SMALLINT NOT NULL DEFAULT 0,
    no_balls       SMALLINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cricket_bowling_match
    ON cricket_bowling_scorecard (match_id, innings_number);

CREATE TABLE IF NOT EXISTS cricket_match_meta (
    match_id           UUID PRIMARY KEY REFERENCES matches(bbs_id) ON DELETE CASCADE,
    match_type         VARCHAR(20),
    toss_winner_id     UUID REFERENCES teams(bbs_id) ON DELETE SET NULL,
    toss_decision      VARCHAR(10),
    day_night          BOOLEAN NOT NULL DEFAULT FALSE,
    venue_pitch_report TEXT,
    dls_applied        BOOLEAN NOT NULL DEFAULT FALSE
);

-- ---------------------------------------------------------------------------
-- Combat athletes and fight cards (shared by MMA and boxing)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS combat_athlete (
    athlete_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name             VARCHAR(200) NOT NULL,
    nationality      VARCHAR(100),
    dob              DATE,
    height_cm        SMALLINT,
    reach_cm         SMALLINT,
    stance           VARCHAR(10),
    record_wins      SMALLINT NOT NULL DEFAULT 0,
    record_losses    SMALLINT NOT NULL DEFAULT 0,
    record_draws     SMALLINT NOT NULL DEFAULT 0,
    record_nc        SMALLINT NOT NULL DEFAULT 0,
    current_ranking  SMALLINT,
    weight_class     VARCHAR(50),
    promoter         VARCHAR(50)
);
CREATE INDEX IF NOT EXISTS idx_combat_athlete_name ON combat_athlete (name);

CREATE TABLE IF NOT EXISTS fight_card (
    card_id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sport             VARCHAR(10) NOT NULL,
    promoter          VARCHAR(50),
    event_name        VARCHAR(200) NOT NULL,
    event_date        DATE NOT NULL,
    venue_id          UUID REFERENCES venues(bbs_id) ON DELETE SET NULL,
    ppv_number        INT,
    broadcast_network VARCHAR(100)
);
CREATE INDEX IF NOT EXISTS idx_fight_card_event_date ON fight_card (event_date);

-- ---------------------------------------------------------------------------
-- MMA
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mma_bout (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id          UUID NOT NULL REFERENCES matches(bbs_id) ON DELETE CASCADE,
    card_id           UUID REFERENCES fight_card(card_id) ON DELETE SET NULL,
    event_type        VARCHAR(30),
    bout_order        SMALLINT,
    weight_class      VARCHAR(50),
    scheduled_rounds  SMALLINT NOT NULL DEFAULT 3,
    title_fight       BOOLEAN NOT NULL DEFAULT FALSE,
    championship_id   UUID,
    result_winner_id  UUID REFERENCES combat_athlete(athlete_id) ON DELETE SET NULL,
    result_method     VARCHAR(40),
    result_round      SMALLINT,
    result_time       TIME,
    submission_type   VARCHAR(50),
    judge_scores      JSONB
);
CREATE INDEX IF NOT EXISTS idx_mma_bout_match ON mma_bout (match_id);
CREATE INDEX IF NOT EXISTS idx_mma_bout_card  ON mma_bout (card_id);

CREATE TABLE IF NOT EXISTS mma_bout_stats (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id              UUID NOT NULL REFERENCES matches(bbs_id) ON DELETE CASCADE,
    fighter_id            UUID NOT NULL REFERENCES combat_athlete(athlete_id) ON DELETE CASCADE,
    corner                CHAR(1) NOT NULL,
    sig_strikes_head      INT NOT NULL DEFAULT 0,
    sig_strikes_body      INT NOT NULL DEFAULT 0,
    sig_strikes_leg       INT NOT NULL DEFAULT 0,
    total_strikes         INT NOT NULL DEFAULT 0,
    takedowns_attempted   INT NOT NULL DEFAULT 0,
    takedowns_landed      INT NOT NULL DEFAULT 0,
    control_time_seconds  INT NOT NULL DEFAULT 0,
    knockdowns            SMALLINT NOT NULL DEFAULT 0,
    UNIQUE (match_id, fighter_id)
);
CREATE INDEX IF NOT EXISTS idx_mma_bout_stats_match ON mma_bout_stats (match_id);

-- ---------------------------------------------------------------------------
-- Boxing
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS boxing_bout (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id          UUID NOT NULL REFERENCES matches(bbs_id) ON DELETE CASCADE,
    card_id           UUID REFERENCES fight_card(card_id) ON DELETE SET NULL,
    sanctioning_body  VARCHAR(20),
    weight_class      VARCHAR(50),
    scheduled_rounds  SMALLINT NOT NULL DEFAULT 12,
    result_method     VARCHAR(40),
    result_round      SMALLINT,
    result_time       TIME,
    knockdowns_a      SMALLINT NOT NULL DEFAULT 0,
    knockdowns_b      SMALLINT NOT NULL DEFAULT 0,
    title_context     VARCHAR(100),
    judge_scores      JSONB
);
CREATE INDEX IF NOT EXISTS idx_boxing_bout_match ON boxing_bout (match_id);
CREATE INDEX IF NOT EXISTS idx_boxing_bout_card  ON boxing_bout (card_id);

CREATE TABLE IF NOT EXISTS boxing_punch_stats (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id      UUID NOT NULL REFERENCES matches(bbs_id) ON DELETE CASCADE,
    fighter_id    UUID NOT NULL REFERENCES combat_athlete(athlete_id) ON DELETE CASCADE,
    corner        CHAR(1) NOT NULL,
    total_thrown  INT NOT NULL DEFAULT 0,
    total_landed  INT NOT NULL DEFAULT 0,
    jabs_thrown   INT NOT NULL DEFAULT 0,
    jabs_landed   INT NOT NULL DEFAULT 0,
    power_thrown  INT NOT NULL DEFAULT 0,
    power_landed  INT NOT NULL DEFAULT 0,
    UNIQUE (match_id, fighter_id)
);
CREATE INDEX IF NOT EXISTS idx_boxing_punch_stats_match ON boxing_punch_stats (match_id);
