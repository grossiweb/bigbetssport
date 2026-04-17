# Big Ball Sports — Unified Sports Data API

A single HTTPS / WebSocket / GraphQL surface that fuses 20+ free-tier sports data providers, fills coverage gaps via a fleet of MCP scrapers, and serves the canonical result in a Stripe-style envelope.

- **Coverage**: football/soccer, basketball, baseball, ice hockey, American football, cricket, MMA, boxing, esports, Formula 1, rugby.
- **Live**: WebSocket rooms (`sport:`, `league:`, `match:`) bridged to Redis pub/sub.
- **Reliable**: per-source circuit breakers, quota-aware routing, three-tier priority queueing (P0 live → P1 pre-match → P2 background), MCP gap fallback.
- **Observable**: Prometheus metrics, structured pino logs, `/admin/health` introspection, alert rules in `infra/prometheus/alerts.yml`.

Full API reference: **[docs/API.md](docs/API.md)**.

## Architecture overview

```
client ──► gateway (Fastify) ─────────────────┐
            │ auth + rate-limit               │
            │ REST + GraphQL + WebSocket      │
            ▼                                 │
         FieldRouter (synchronous fetch)      │
            │                                 │
            │ cache → FIELD_REGISTRY          │
            ▼                                 ▼
      RateLimitOrchestrator            FieldCache (Redis)
       quota + CB + priority queues
            │
            ▼
      20 upstream adapters (tier-1 + tier-2)
            │
            ▼  (when all exhausted)
      GapDetector ──► 10 MCP scrapers (Docker fleet)
```

Package map:

| Package               | Role                                                                   |
|-----------------------|------------------------------------------------------------------------|
| `@bbs/shared`         | Types, Redis client, Zod schemas, shared metrics, pino logger          |
| `@bbs/orchestrator`   | FieldRouter, RateLimitOrchestrator, source adapters, FIELD_REGISTRY    |
| `@bbs/gateway`        | Fastify REST + GraphQL + WebSocket + webhooks + admin                  |
| `@bbs/normaliser`     | Entity resolution + per-source normalisers + Postgres store (cricket + combat so far) |
| `@bbs/mcp-fleet`      | 10 JSON-RPC 2.0 scraper services, rate-limited per hour                |
| `@bbs/live-window`    | Schedule fetcher + pre-fetch pub/sub + poll-interval calculator        |
| `@bigballsports/sdk`  | Zero-dep TypeScript client (npm publishable)                           |

## Prerequisites

- **Node.js 22+**
- **pnpm 9+** (`npm install -g pnpm`)
- **Docker** with Compose v2 (for local Postgres + Redis + Prometheus + Grafana)

## First run

```bash
# 1. Clone + install
git clone <this-repo>
cd bigbetssport
pnpm install

# 2. Copy the env template
cp .env.example .env
# Edit .env to add any API keys you have — all upstreams have free tiers.

# 3. Start infrastructure
make dev                # docker compose up -d (postgres, redis, prometheus, grafana)

# 4. Apply SQL migrations
make migrate

# 5. Seed sports + leagues catalogue (idempotent)
make seed

# 6. Verify everything compiles
pnpm -r build

# 7. Run services
pnpm --filter @bbs/orchestrator dev   # in one terminal
pnpm --filter @bbs/gateway dev         # in another
```

Gateway listens on http://localhost:3000 · orchestrator on :3006 · Prometheus on :9090 · Grafana on :3001 · pgAdmin on :5050.

## Make targets

| Target         | What it does                                                        |
|----------------|---------------------------------------------------------------------|
| `make dev`     | `docker compose up -d` — start infra                                |
| `make down`    | Stop infra                                                          |
| `make migrate` | Apply every `.sql` in `infra/postgres/migrations/` in order         |
| `make seed`    | Run `packages/shared/scripts/seed-sports.ts`                        |
| `make test`    | `pnpm -r test`                                                      |
| `make lint`    | `pnpm -r lint`                                                      |
| `make build`   | `pnpm -r build`                                                     |
| `make clean`   | Remove build artefacts                                              |
| `make reset`   | **Destroys** docker volumes then restarts (interactive prompt)      |

## Running tests

```bash
pnpm -r test          # unit + integration (ioredis-mock + MSW)
E2E=1 pnpm -r test    # include e2e suite (requires docker-compose up)
```

Coverage: per-package via Vitest (`--coverage`). CI uploads to Codecov.

## API key setup

Each upstream needs a free-tier account. The orchestrator boots without any of these — it will just return 503 for uncovered sports — but sources go offline until their env var is set.

| Source            | Sign-up                                            | Env var                |
|-------------------|----------------------------------------------------|------------------------|
| API-Football      | https://www.api-football.com                       | `API_SPORTS_KEY`       |
| football-data.org | https://www.football-data.org/client/register      | `FOOTBALL_DATA_KEY`    |
| TheRundown        | https://rapidapi.com/therundown/api/therundown     | `RUNDOWN_API_KEY`      |
| Sportmonks        | https://www.sportmonks.com                         | `SPORTMONKS_API_KEY`   |
| TheSportsDB       | https://www.thesportsdb.com/api.php                | `THESPORTSDB_API_KEY`  |
| balldontlie       | https://balldontlie.io                             | `BALLDONTLIE_API_KEY`  |
| Highlightly       | https://highlightly.net                            | `HIGHLIGHTLY_API_KEY`  |
| PandaScore        | https://pandascore.co                              | `PANDASCORE_API_KEY`   |
| CricketData.org   | https://cricketdata.org                            | `CRICKETDATA_API_KEY`  |
| CollegeFootballData | https://collegefootballdata.com                  | `CFB_API_KEY`          |
| BoxRec (scraper)  | https://boxrec.com/en/register                     | `BOXREC_USERNAME` + `BOXREC_PASSWORD` |

Unauthenticated tier-1 sources (NHL, MLB, NBA, OpenLigaDB, FPL, OpenF1, CFL) don't need keys.

## Known limitations and assumptions

Carried verbatim from the architecture doc, and enforced in code (see `docs/API.md#known-limitations`):

- **TheRundown odds** carry a ~5 minute delay on the free plan.
- **Sportmonks** free plan covers *only* Danish Superliga (id 271) and Scottish Premiership (id 501). The adapter returns `null` for other leagues to avoid wasting quota.
- **NBA stats source** (`stats.nba.com`) is UNOFFICIAL — expect intermittent 403s. The circuit breaker is tuned aggressively here.
- **CricketData.org** free-tier quota limits are not publicly documented. The adapter logs a warning on first use.
- **MMA API** (`mmaapi.com`) is a community-maintained endpoint — TheRundown + `mcp-ufc-stats` are preferred.
- **BoxRec** requires a login; session cookie is cached in-memory per scraper process.
- **xG** on the Sportmonks free plan is paid-only; xG requests fall through to the `mcp-fbref` scraper with lower confidence.
- **Historical depth** on free upstreams caps at 2–3 seasons; older data via MCP scrapers.
- **GraphQL subscriptions** are scaffolded with empty async iterators — REST + socket.io is the live path today.

## Contributing

This repository is a working scaffold — the shape is fixed; individual source adapters and normalisers evolve as upstream APIs change.

1. Open a PR against `main`.
2. CI runs `pnpm -r lint`, `pnpm -r build`, `pnpm -r test`, plus `npm audit` and a dependency-vuln scan.
3. Every new source adapter must implement the `SourceAdapter` interface (see [packages/orchestrator/src/sources/adapter.ts](packages/orchestrator/src/sources/adapter.ts)) and be added to:
   - `packages/orchestrator/src/sources/registry.ts` (SourceConfig)
   - `packages/orchestrator/src/sources/adapter-registry.ts` (adapter default export)
   - `packages/orchestrator/src/field-registry.ts` (per-field priority lists)
4. Every new MCP scraper extends `McpScraperServer` — see [packages/mcp-fleet/src/server-base.ts](packages/mcp-fleet/src/server-base.ts) — and must have vitest parsing tests against a known HTML fixture.
5. Keep tests deterministic: use `ioredis-mock` for Redis, MSW for HTTP, and never bake in real API keys.

## Licence

Proprietary — all rights reserved.
