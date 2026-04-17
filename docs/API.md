# Big Ball Sports API

The Big Ball Sports API unifies 20+ free-tier sports data sources behind a single Stripe-style HTTPS gateway. Every response follows the same envelope; every field carries provenance metadata; every source is rate-limited, circuit-breaker-guarded, and (where possible) gap-filled from a fleet of MCP scrapers.

Base URL (production): `https://api.bigballsports.com`

## Authentication

Two ways to pass your API key — pick one per request:

```http
Authorization: Bearer bbs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

```http
x-api-key: bbs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Admin endpoints (`/admin/*`) use a separate `x-admin-key` header and are not for consumer use.

## Quick Start (5-minute integration)

```ts
import { BigBallSportsClient } from '@bigballsports/sdk';

const client = new BigBallSportsClient('bbs_your_key');

// Today's NFL schedule
const matches = await client.matches.list({
  sport: 'american_football',
  date: '2026-04-17',
});

// Full match detail with scores, odds, and lineups
const match = await client.matches.get('m_abc123', ['scores', 'odds', 'lineups']);

// Access fields with confidence metadata
console.log(match.data.scores?.source);      // "nhl-api"
console.log(match.data.scores?.confidence);  // 0.95
console.log(match.meta.fields_missing);      // ["xg"] or undefined
```

## Endpoints

| Method | Path                                    | Description                                      | Auth |
|--------|-----------------------------------------|--------------------------------------------------|------|
| GET    | `/health`                               | Service health check                             | –    |
| GET    | `/metrics`                              | Prometheus metrics (IP-restricted)               | IP   |
| GET    | `/v1/docs`                              | Interactive Swagger UI                           | –    |
| GET    | `/v1/sports`                            | List all 11 supported sports                     | ✔    |
| GET    | `/v1/leagues`                           | List leagues; filter by `sport`, `country`       | ✔    |
| GET    | `/v1/leagues/:id`                       | Single league                                    | ✔    |
| GET    | `/v1/matches`                           | Match list filtered by `sport`, `league`, `date` | ✔    |
| GET    | `/v1/matches/:id`                       | Single match with requested `fields`             | ✔    |
| GET    | `/v1/matches/:id/odds`                  | Odds for a match                                 | ✔    |
| GET    | `/v1/matches/:id/events`                | Play-by-play / match events                      | ✔    |
| GET    | `/v1/teams/:id`                         | Team profile + current stats                     | ✔    |
| GET    | `/v1/teams/:id/matches`                 | Team match history                               | ✔    |
| GET    | `/v1/players/:id`                       | Player profile + career stats                    | ✔    |
| GET    | `/v1/players/:id/stats`                 | Player per-season stats                          | ✔    |
| GET    | `/v1/standings`                         | League standings                                 | ✔    |
| GET    | `/v1/injuries`                          | Injury reports                                   | ✔    |
| GET    | `/v1/cricket/matches`                   | Cricket matches (series/date filtered)           | ✔    |
| GET    | `/v1/cricket/matches/:id/scorecard`     | Full innings + batting + bowling scorecard       | ✔    |
| GET    | `/v1/cricket/series`                    | Active cricket series                            | ✔    |
| GET    | `/v1/cricket/players/:id`               | Cricket player with format-split stats           | ✔    |
| GET    | `/v1/fight-cards`                       | MMA/boxing fight cards (sport, date)             | ✔    |
| GET    | `/v1/fight-cards/:id`                   | Full card; bouts sorted by `bout_order ASC`      | ✔    |
| GET    | `/v1/bouts/:id`                         | Single bout with fighter stats                   | ✔    |
| GET    | `/v1/athletes/:id`                      | Combat athlete profile                           | ✔    |
| GET    | `/v1/athletes/:id/record`               | Fight record                                     | ✔    |
| POST   | `/v1/webhooks`                          | Register webhook endpoint                        | ✔    |
| GET    | `/v1/webhooks`                          | List this key's webhooks                         | ✔    |
| DELETE | `/v1/webhooks/:id`                      | Unregister a webhook                             | ✔    |
| POST   | `/graphql`                              | GraphQL endpoint (Yoga)                          | ✔    |

## Response envelope

Every JSON response — success or error — uses this shape:

```json
{
  "data": {
    "scores": {
      "value": { "home": 3, "away": 2, "period": "FT" },
      "source": "nhl-api",
      "via": "api",
      "confidence": 0.95,
      "fetchedAt": "2026-04-17T18:42:11.104Z",
      "ttlSeconds": 30
    }
  },
  "meta": {
    "source": "nhl-api",
    "confidence": 0.95,
    "cached": false,
    "cache_age_ms": 0,
    "request_id": "c2f1c4d0-…",
    "fields_missing": []
  },
  "error": null
}
```

On error, `data` is `null` and `error` is populated:

```json
{
  "data": null,
  "meta": { "source": "none", "confidence": 0, "cached": false, "cache_age_ms": 0, "request_id": "…" },
  "error": { "code": "rate_limited", "message": "rate limit exceeded (100/min)" }
}
```

Every response also carries `X-Request-Id` header for support correlation.

## Field selection

Use `?fields=` to request a subset on match / player endpoints. Comma-separated. Unknown fields yield a 400.

Valid `FieldKey` values:

```
scores  odds  lineups  players  stats
historical  injuries  xg  transfers  standings
```

Example:

```
GET /v1/matches/abc123?sport=football&fields=scores,odds,xg
```

Missing fields come back as `data.{field}: null` with the field listed in `meta.fields_missing`. The HTTP status stays 200 as long as *something* resolved.

## Error codes

| code                    | HTTP | Meaning                                            |
|-------------------------|------|----------------------------------------------------|
| `bad_request`           | 400  | Query or body failed validation                    |
| `unauthorized`          | 401  | Missing or invalid API key                         |
| `forbidden`             | 403  | Admin or IP-restricted endpoint refused            |
| `not_found`             | 404  | Unknown route or entity                            |
| `rate_limited`          | 429  | Per-minute or per-day quota exceeded; see `Retry-After` |
| `upstream_unavailable`  | 503  | No source could serve the request (even via MCP)   |
| `internal`              | 500  | Unhandled server error — please retry              |

## Rate limits

Per API key. Enforced by a dual-bucket limiter (per-minute sliding window + per-day UTC fixed window).

| Plan       | req/minute | req/day   | WebSocket connections |
|------------|-----------:|----------:|----------------------:|
| free       |        100 |     1,000 |                     1 |
| starter    |      1,000 |    50,000 |                    10 |
| pro        |      5,000 |   500,000 |                    50 |
| enterprise |   unlimited |  unlimited |              unlimited |

Every response includes these headers:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 72
X-RateLimit-Reset: 1745345672           ← Unix seconds
X-RateLimit-Limit-Minute: 100
X-RateLimit-Limit-Day: 1000
```

On 429, `Retry-After: <seconds>` is set to the time until the rejecting bucket resets.

## WebSocket rooms and events

Connect via socket.io at the base URL. Authenticate by including `x-api-key` in the handshake headers (or `auth: { apiKey }`). Emit `join` / `leave` messages with a room name.

Rooms:

| Pattern              | Example            | Scope                           |
|----------------------|--------------------|---------------------------------|
| `sport:{sport}`      | `sport:football`   | All matches for one sport       |
| `league:{leagueId}`  | `league:epl`       | All matches in one league       |
| `match:{matchId}`    | `match:m_abc123`   | One specific match              |

Events (all emit JSON `{ type, data }`):

```
score_update  odds_move         lineup_confirmed
match_start   match_end         goal
card          substitution
```

Client example:

```ts
import { io } from 'socket.io-client';
import { BigBallSportsClient } from '@bigballsports/sdk';

const client = new BigBallSportsClient('bbs_your_key');
const unsubscribe = client.subscribe(
  'match:m_abc123',
  (evt) => console.log(evt.type, evt.data),
  { socketIo: io },
);
```

## Webhook setup + signature verification

Register your endpoint:

```bash
curl -X POST https://api.bigballsports.com/v1/webhooks \
  -H "x-api-key: bbs_your_key" \
  -H "content-type: application/json" \
  -d '{
    "url": "https://your-app.example.com/webhooks/bbs",
    "events": ["score_update", "match_end", "odds_move"]
  }'
```

The response contains a `secret` — store it; you'll never see it again.

On each event, Big Ball Sports POSTs JSON to your URL with headers:

```
content-type: application/json
x-bbs-signature: sha256=<hex>
x-bbs-event-id:   evt_...
x-bbs-event-type: score_update
x-bbs-webhook-id: wh_...
```

Verify with Node.js:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

function verifyBbsSignature(body: string, header: string, secret: string): boolean {
  const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Express example:
app.post('/webhooks/bbs', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.header('x-bbs-signature') ?? '';
  const body = req.body.toString('utf8');
  if (!verifyBbsSignature(body, sig, process.env.BBS_WEBHOOK_SECRET!)) {
    return res.status(401).end();
  }
  const event = JSON.parse(body);
  // ... handle event.type + event.data
  res.status(204).end();
});
```

Retry policy: 5 attempts with exponential backoff (1s, 2s, 4s, 8s, 16s). After the final failure your webhook is dropped from this event's fan-out — use the admin endpoint to re-list and confirm it's still registered.

## Data confidence scores

Every `FieldResult` carries `confidence` from 0.0 to 1.0:

| Source tier                | Typical range | Notes                                    |
|----------------------------|--------------:|------------------------------------------|
| Official league API        |    0.95 – 1.0 | NHL, MLB, NBA, CFB, FPL                  |
| Top paid aggregator (tier-2) |    0.85 – 0.95 | API-Sports, Sportmonks, TheRundown     |
| Community free tiers       |    0.75 – 0.85 | balldontlie, TheSportsDB, Highlightly    |
| MCP scraper fallback       |    0.60 – 0.75 | fbref, SofaScore, UFCStats, BoxRec       |

`meta.confidence` on the envelope is the mean across all returned fields. Show a "best-effort" caveat on your UI when it drops below 0.75.

## Free vs paid features

The free upstream tier covers a lot, but has specific carve-outs:

- **Real-time odds** — the free The Odds API has a ~5 minute delay vs. Vegas books. Paid tiers fix this.
- **Expected goals (xG)** — Sportmonks free plan doesn't expose xG; it arrives via the `mcp-fbref` scraper with lower confidence.
- **Full league coverage in football** — Sportmonks free covers only the Danish Superliga (id 271) and Scottish Premiership (id 501). Requests for other leagues return 503 / empty on Sportmonks and fall through to other sources.
- **Historical depth** — most free upstreams cap historical at 2–3 seasons. Older data comes from the fbref MCP scraper (slower).

## Known limitations

- **TheRundown odds** carry a ~5 minute delay on the free plan.
- **Sportmonks** free plan is limited to Danish Superliga + Scottish Premiership.
- **NBA stats source** (`stats.nba.com`) is unofficial — expect intermittent blocks; circuit breaker is tuned aggressively.
- **CricketData.org** free-tier quota limits are not publicly documented; monitor `bbs_quota_remaining` on your dashboard.
- **BoxRec** requires an account — `BOXREC_USERNAME` / `BOXREC_PASSWORD` env vars. Rate-limited to 3/hour.
- **MMA API** is a community-maintained endpoint with no SLA; TheRundown + mcp-ufc-stats are preferred for MMA data.
- **GraphQL subscriptions** are wired to Redis pub/sub but only publish when an upstream delta-poller fires; in practice, prefer REST + the WebSocket surface for now.
