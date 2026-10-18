import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLimits } from './risk.js';
import { newBook, buy } from './paper.js';
import { parsePairs } from './market.js';
import { PAIRS } from './fixtures.js';

const market = { at: 0, tokens: parsePairs(PAIRS) };

test('caps buy size at the risk level no matter what the agents ask for', () => {
  const book = newBook(100, 100);
  const { approved } = applyLimits({ proposals: [{ token: 'JUP', action: 'buy', sizePct: 90 }], book, market, level: 'med' });
  assert.equal(approved[0].usd, 10);
});

test('blocks thin pools, unknown tokens and rejected trades', () => {
  const book = newBook(100, 100);
  const { approved, notes } = applyLimits({
    proposals: [{ token: 'WIF', action: 'buy', sizePct: 5 }, { token: 'FAKE', action: 'buy', sizePct: 5 }, { token: 'SOL', action: 'buy', sizePct: 5 }],
    decisions: [{ token: 'SOL', verdict: 'reject', reason: 'trend' }], book, market, level: 'med' });
  assert.equal(approved.length, 0);
  assert.match(notes.join(' '), /liquidity/);
});

test('daily loss stop blocks buys but still allows sells', () => {
  const book = newBook(100, 100);
  buy(book, market, 'JUP', 10);
  book.dayStartEquity = 120; // equity ~100 is a 17% drop
  const { approved } = applyLimits({ proposals: [{ token: 'SOL', action: 'buy', sizePct: 5 }, { token: 'JUP', action: 'sell', sizePct: 100 }], book, market, level: 'med' });
  assert.deepEqual(approved.map(a => a.action), ['sell']);
});

test('halted book refuses buys', () => {
  const book = newBook(100, 100); book.halted = true;
  assert.equal(applyLimits({ proposals: [{ token: 'SOL', action: 'buy', sizePct: 5 }], book, market, level: 'high' }).approved.length, 0);
});
