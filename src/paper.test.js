import test from 'node:test';
import assert from 'node:assert/strict';
import { newBook, buy, sell, equity, sweepableUsd, closeAll, COST } from './paper.js';
import { parsePairs } from './market.js';
import { PAIRS } from './fixtures.js';

const market = () => ({ at: 0, tokens: parsePairs(PAIRS) });

test('a round trip at an unchanged price loses about twice the cost', () => {
  const m = market(), b = newBook(100, 100);
  buy(b, m, 'JUP', 10); sell(b, m, 'JUP', 1);
  assert.ok(Math.abs(equity(b, m) - (100 - 10 * 2 * COST)) < 0.01);
  assert.deepEqual(b.pos, {});
});

test('buy refuses to spend more cash than it has', () => {
  const m = market(), b = newBook(100, 100);
  assert.equal(buy(b, m, 'JUP', 150), null);
  assert.equal(b.cash, 100);
});

test('only cash above float plus reserve is sweepable', () => {
  const m = market(), b = newBook(100, 100);
  assert.equal(sweepableUsd(b, m), 0);
  b.cash = 110; // 0.02 SOL reserve at $100 = $2
  assert.ok(Math.abs(sweepableUsd(b, m) - 8) < 1e-9);
  buy(b, m, 'JUP', 105); // profit tied up in a position is not swept
  assert.ok(sweepableUsd(b, m) <= b.cash);
});

test('closeAll sells every position', () => {
  const m = market(), b = newBook(100, 100);
  buy(b, m, 'JUP', 10); buy(b, m, 'SOL', 10);
  assert.equal(closeAll(b, m).length, 2);
  assert.deepEqual(b.pos, {});
});
