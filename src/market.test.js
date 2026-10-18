import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePairs, fetchMarket } from './market.js';
import { PAIRS } from './fixtures.js';

test('keeps the deepest pool per token and drops tokens off the watchlist', () => {
  const t = parsePairs(PAIRS);
  assert.deepEqual(t.map(x => x.sym), ['SOL', 'JUP', 'WIF']);
  assert.equal(t[0].price, 100);
});

test('rejects an unexpected response', () => {
  assert.throws(() => parsePairs({ pairs: [] }));
  assert.throws(() => parsePairs([]));
});

test('fetchMarket reports HTTP errors', async () => {
  await assert.rejects(fetchMarket(async () => ({ ok: false, status: 429 })), /429/);
  const m = await fetchMarket(async () => ({ ok: true, json: async () => PAIRS }));
  assert.equal(m.tokens.length, 3);
});
