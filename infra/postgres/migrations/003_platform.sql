-- ===========================================================================
-- P-11: developer platform tables
-- ===========================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- --- users ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  name          VARCHAR(100),
  password_hash VARCHAR(100),
  github_id     VARCHAR(50),
  google_id     VARCHAR(50),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);

-- --- api_keys extensions --------------------------------------------------

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS user_id     UUID REFERENCES users(id);
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS name        VARCHAR(100);
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS scopes      TEXT[] NOT NULL DEFAULT ARRAY['read'];
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS metadata    JSONB NOT NULL DEFAULT '{}';
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS key_prefix  CHAR(16);
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS environment VARCHAR(10) NOT NULL DEFAULT 'live';
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix  ON api_keys(key_prefix);

-- --- usage_events (hypertable) --------------------------------------------

CREATE TABLE IF NOT EXISTS usage_events (
  id          BIGSERIAL,
  key_id      UUID REFERENCES api_keys(id),
  endpoint    VARCHAR(100) NOT NULL,
  sport       VARCHAR(30),
  field       VARCHAR(30),
  via         VARCHAR(10),
  status_code SMALLINT,
  latency_ms  SMALLINT,
  datapoints  SMALLINT NOT NULL DEFAULT 1,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at)
);
CREATE INDEX IF NOT EXISTS idx_usage_events_key   ON usage_events(key_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_time  ON usage_events(occurred_at DESC);
SELECT create_hypertable(
  'usage_events',
  'occurred_at',
  if_not_exists => TRUE,
  migrate_data  => TRUE
);

-- --- subscriptions --------------------------------------------------------

CREATE TABLE IF NOT EXISTS subscriptions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID REFERENCES users(id),
  owner_email          VARCHAR(255) NOT NULL,
  plan                 VARCHAR(20) NOT NULL DEFAULT 'free',
  stripe_customer_id   VARCHAR(100),
  stripe_sub_id        VARCHAR(100),
  status               VARCHAR(20) NOT NULL DEFAULT 'active',
  current_period_start TIMESTAMPTZ,
  current_period_end   TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id      ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_cust  ON subscriptions(stripe_customer_id);

-- --- webhook endpoints + delivery log ------------------------------------

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id      UUID REFERENCES api_keys(id),
  url         TEXT NOT NULL,
  events      TEXT[] NOT NULL,
  secret      VARCHAR(64) NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  description VARCHAR(200),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_key ON webhook_endpoints(key_id);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id           BIGSERIAL PRIMARY KEY,
  endpoint_id  UUID REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_type   VARCHAR(50),
  payload      JSONB,
  status_code  SMALLINT,
  attempt      SMALLINT NOT NULL DEFAULT 1,
  duration_ms  SMALLINT,
  error        TEXT,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint
  ON webhook_deliveries(endpoint_id, delivered_at DESC);

-- --- incidents ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS incidents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       VARCHAR(200) NOT NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'investigating',
  impact      VARCHAR(20) NOT NULL DEFAULT 'minor',
  body        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_incidents_created ON incidents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_unresolved ON incidents(resolved_at) WHERE resolved_at IS NULL;

-- --- sent_emails (debug log) ---------------------------------------------

CREATE TABLE IF NOT EXISTS sent_emails (
  id         BIGSERIAL PRIMARY KEY,
  to_email   VARCHAR(255) NOT NULL,
  template   VARCHAR(50) NOT NULL,
  subject    VARCHAR(200),
  status     VARCHAR(20) NOT NULL DEFAULT 'sent',
  provider_id VARCHAR(100),
  error      TEXT,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sent_emails_to ON sent_emails(to_email, sent_at DESC);
