import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import McpUfcStatsServer from './mcp-ufc-stats.js';

/**
 * ufcstats.com fight-details pages emit a long table where each row lists
 * one fighter. The column order is fixed; we parse by indexed
 * `.b-fight-details__table-col` cells.
 */

const FIGHT_HTML = `
<!doctype html>
<html>
<body>
  <p class="b-fight-details__text"><i>Method:</i> KO/TKO (Punches)</p>
  <p class="b-fight-details__text"><i>Round:</i> 2</p>
  <p class="b-fight-details__text"><i>Time:</i> 3:45</p>
  <p class="b-fight-details__text"><i>Referee:</i> Herb Dean</p>
  <table class="b-fight-details__table">
    <tbody class="b-fight-details__table-body">
      <tr class="b-fight-details__table-row">
        <td class="b-fight-details__table-col">
          <div class="b-fight-details__table-text">Jon Jones</div>
        </td>
        <td class="b-fight-details__table-col">3</td>
        <td class="b-fight-details__table-col">95 of 150</td>
        <td class="b-fight-details__table-col">63%</td>
        <td class="b-fight-details__table-col">110 of 180</td>
        <td class="b-fight-details__table-col">4 of 6</td>
        <td class="b-fight-details__table-col">66%</td>
        <td class="b-fight-details__table-col">2</td>
        <td class="b-fight-details__table-col">0</td>
        <td class="b-fight-details__table-col">8:12</td>
      </tr>
      <tr class="b-fight-details__table-row">
        <td class="b-fight-details__table-col">
          <div class="b-fight-details__table-text">Stipe Miocic</div>
        </td>
        <td class="b-fight-details__table-col">0</td>
        <td class="b-fight-details__table-col">32 of 88</td>
        <td class="b-fight-details__table-col">36%</td>
        <td class="b-fight-details__table-col">45 of 100</td>
        <td class="b-fight-details__table-col">0 of 2</td>
        <td class="b-fight-details__table-col">0%</td>
        <td class="b-fight-details__table-col">0</td>
        <td class="b-fight-details__table-col">0</td>
        <td class="b-fight-details__table-col">1:30</td>
      </tr>
    </tbody>
  </table>
</body>
</html>
`;

const FIGHTER_HTML = `
<!doctype html>
<html>
<body>
  <h2 class="b-content__title-highlight">Jon Jones</h2>
  <span class="b-content__title-record">Record: 27-1-0 (1 NC)</span>
  <div class="b-list__info-box">
    <ul class="b-list__box-list">
      <li><i class="b-list__box-list-item-title">Height:</i> 6' 4"</li>
      <li><i class="b-list__box-list-item-title">Weight:</i> 205 lbs.</li>
      <li><i class="b-list__box-list-item-title">Reach:</i> 84"</li>
      <li><i class="b-list__box-list-item-title">Stance:</i> Orthodox</li>
      <li><i class="b-list__box-list-item-title">DOB:</i> Jul 19, 1987</li>
    </ul>
  </div>
</body>
</html>
`;

describe('McpUfcStatsServer — parsing', () => {
  let redis: Redis;
  let server: McpUfcStatsServer;

  beforeEach(async () => {
    redis = new RedisMock() as unknown as Redis;
    await redis.flushall();
    server = new McpUfcStatsServer(redis);
  });

  afterEach(async () => {
    await redis.quit();
  });

  it('parseFightStats extracts per-fighter sig strikes / takedowns / knockdowns / control time', () => {
    const result = server.parseFightStats(FIGHT_HTML) as {
      fighters: Array<Record<string, unknown>>;
      method: string | null;
      round: string | null;
    };
    expect(result.fighters).toHaveLength(2);
    expect(result.fighters[0]).toMatchObject({
      name: 'Jon Jones',
      knockdowns: 3,
      sig_strikes: 95,
      total_strikes: 110,
      takedowns: 4,
      control_time: '8:12',
    });
    expect(result.fighters[1]).toMatchObject({ name: 'Stipe Miocic', knockdowns: 0 });
    expect(result.method).toMatch(/KO\/TKO/);
    expect(result.round).toBe('2');
  });

  it('parseFighterRecord extracts height/weight/reach/DOB/stance', () => {
    const result = server.parseFighterRecord(FIGHTER_HTML) as Record<string, unknown>;
    expect(result['name']).toBe('Jon Jones');
    expect(result['record']).toMatch(/27-1-0/);
    expect(result['height']).toMatch(/6/);
    expect(result['weight']).toMatch(/205/);
    expect(result['reach']).toMatch(/84/);
    expect(result['stance']).toBe('Orthodox');
    expect(result['dob']).toMatch(/1987/);
  });
});

describe('McpUfcStatsServer — RPC', () => {
  let redis: Redis;
  let server: McpUfcStatsServer;

  beforeEach(async () => {
    redis = new RedisMock() as unknown as Redis;
    await redis.flushall();
    server = new McpUfcStatsServer(redis);
    server.fetchHtml = async () => FIGHT_HTML;
    server.interRequestDelayMs = 0;
  });

  afterEach(async () => {
    await redis.quit();
  });

  it('routes tools/call → scrape_fight_stats', async () => {
    const response = await server.handleRpcCall({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'scrape_fight_stats', arguments: { fightId: 'abc' } },
    });
    expect('result' in response).toBe(true);
  }, 10_000);

  it('rejects unknown tool name with method-not-found', async () => {
    const response = await server.handleRpcCall({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'does_not_exist', arguments: {} },
    });
    expect('error' in response).toBe(true);
    if ('error' in response) {
      expect(response.error.code).toBe(-32_601);
    }
  });

  it('rate limit rejects the 11th call in the same hour (limit = 10)', async () => {
    const call = (id: number) =>
      server.handleRpcCall({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name: 'scrape_fight_stats', arguments: { fightId: String(id) } },
      });

    for (let i = 0; i < 10; i += 1) {
      const ok = await call(i);
      expect('result' in ok).toBe(true);
    }
    const blocked = await call(99);
    expect('error' in blocked).toBe(true);
    if ('error' in blocked) {
      expect(blocked.error.code).toBe(-32_000);
    }
  }, 60_000);
});
