# @bigballsports/sdk

Official TypeScript SDK for the Big Ball Sports API.

## Install

```bash
npm install @bigballsports/sdk
```

## Quick start

```ts
import { BigBallSportsClient } from '@bigballsports/sdk';

const client = new BigBallSportsClient('bbs_your_api_key');

const today = await client.matches.list({ sport: 'football', date: '2026-04-17' });
console.log(today.data);

const live = await client.matches.get('m-123', ['scores', 'odds', 'lineups']);
console.log(live.data.scores, live.data.odds);
```

## WebSocket subscriptions

```ts
import { io } from 'socket.io-client';

const unsubscribe = client.subscribe(
  'match:m-123',
  (event) => console.log(event.type, event.data),
  { socketIo: io },
);

// later:
unsubscribe();
```

Zero runtime dependencies. `socket.io-client` is required only if you use
`subscribe()` — pass it in via `{ socketIo: io }`.
