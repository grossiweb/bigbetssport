import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import McpFbrefServer from './mcp-fbref.js';

/**
 * We don't boot Fastify for these tests — we instantiate the scraper and
 * call `handleRpcCall` directly. `fetchHtml` is swapped out for a fixture
 * function so no network traffic occurs.
 */

const MATCH_HTML = `
<!doctype html>
<html>
<body>
  <div class="scorebox">
    <strong><a href="/en/squads/X">Arsenal</a></strong>
    <strong><a href="/en/squads/Y">Chelsea</a></strong>
  </div>
  <table>
    <tr>
      <td data-stat="possession">62</td>
      <td data-stat="shots">14</td>
      <td data-stat="shots_on_target">6</td>
      <td data-stat="xg">1.8</td>
      <td data-stat="passes">512</td>
      <td data-stat="progressive_passes">44</td>
      <td data-stat="pressures">128</td>
    </tr>
  </table>
</body>
</html>
`;

const PLAYER_HTML = `
<!doctype html>
<html>
<body>
  <table id="stats_standard_dom_lg">
    <tbody>
      <tr>
        <th data-stat="season">2023-24</th>
        <td data-stat="team">Arsenal</td>
        <td data-stat="comp_level">Premier League</td>
        <td data-stat="games">34</td>
        <td data-stat="minutes">2800</td>
        <td data-stat="goals">9</td>
        <td data-stat="assists">7</td>
        <td data-stat="xg">8.2</td>
      </tr>
      <tr>
        <th data-stat="season">2022-23</th>
        <td data-stat="team">Arsenal</td>
        <td data-stat="comp_level">Premier League</td>
        <td data-stat="games">36</td>
        <td data-stat="minutes">3100</td>
        <td data-stat="goals">12</td>
        <td data-stat="assists">5</td>
        <td data-stat="xg">10.5</td>
      </tr>
    </tbody>
  </table>
</body>
</html>
`;

describe('McpFbrefServer — parsing', () => {
  let redis: Redis;
  let server: McpFbrefServer;

  beforeEach(async () => {
    redis = new RedisMock() as unknown as Redis;
    await redis.flushall();
    server = new McpFbrefServer(redis);
  });

  afterEach(async () => {
    await redis.quit();
  });

  it('parseMatchStats extracts possession, shots, xG, pressures', () => {
    const result = server.parseMatchStats(MATCH_HTML) as Record<string, unknown>;
    expect(result['possession_home']).toBe(62);
    expect(result['shots_home']).toBe(14);
    expect(result['shots_on_target_home']).toBe(6);
    expect(result['xg_home']).toBe(1.8);
    expect(result['progressive_passes_home']).toBe(44);
    expect(result['pressures_home']).toBe(128);
    const scorebox = result['scorebox'] as Record<string, unknown>;
    expect(scorebox['home']).toBe('Arsenal');
    expect(scorebox['away']).toBe('Chelsea');
  });

  it('parsePlayerCareer returns seasons array', () => {
    const result = server.parsePlayerCareer(PLAYER_HTML) as { seasons: Array<Record<string, unknown>> };
    expect(result.seasons).toHaveLength(2);
    expect(result.seasons[0]).toMatchObject({
      season: '2023-24',
      team: 'Arsenal',
      goals: 9,
      xg: 8.2,
    });
    expect(result.seasons[1]).toMatchObject({ season: '2022-23', goals: 12 });
  });
});

describe('McpFbrefServer — RPC dispatch', () => {
  let redis: Redis;
  let server: McpFbrefServer;

  beforeEach(async () => {
    redis = new RedisMock() as unknown as Redis;
    await redis.flushall();
    server = new McpFbrefServer(redis);
    server.fetchHtml = async () => MATCH_HTML;
    server.interRequestDelayMs = 0;
  });

  afterEach(async () => {
    await redis.quit();
  });

  it('JSON-RPC 2.0: tools/call routes to scrape_match_stats', async () => {
    const response = await server.handleRpcCall({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'scrape_match_stats', arguments: { matchId: 'abc123' } },
    });

    expect('result' in response).toBe(true);
    if ('result' in response) {
      const text = response.result.content[0]?.text ?? '';
      const parsed = JSON.parse(text) as Record<string, unknown>;
      expect(parsed['possession_home']).toBe(62);
    }
  }, 10_000);

  it('returns method-not-found for unknown tool name', async () => {
    const response = await server.handleRpcCall({
      jsonrpc: '2.0',
      id: 42,
      method: 'tools/call',
      params: { name: 'nonexistent_tool', arguments: {} },
    });

    expect('error' in response).toBe(true);
    if ('error' in response) {
      expect(response.error.code).toBe(-32_601);
      expect(response.error.message).toMatch(/unknown tool/);
    }
  });

  it('returns invalid-request for wrong jsonrpc version', async () => {
    const response = await server.handleRpcCall({
      jsonrpc: '1.0' as '2.0',
      id: 1,
      method: 'tools/call',
    });
    expect('error' in response).toBe(true);
    if ('error' in response) {
      expect(response.error.code).toBe(-32_600);
    }
  });

  it('rejects with rate_limited after 20 successful calls within the hour', async () => {
    server.fetchHtml = async () => MATCH_HTML;
    const call = (id: number) =>
      server.handleRpcCall({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name: 'scrape_match_stats', arguments: { matchId: String(id) } },
      });

    for (let i = 0; i < 20; i += 1) {
      const response = await call(i);
      expect('result' in response).toBe(true);
    }
    const blocked = await call(999);
    expect('error' in blocked).toBe(true);
    if ('error' in blocked) {
      expect(blocked.error.code).toBe(-32_000);
      expect(blocked.error.message).toMatch(/rate limit/);
    }
  }, 60_000);
});
