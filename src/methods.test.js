import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSignals, methodSignal, makeSignalSource, fetchCandles } from './methods.js';
import { ruleScout, ruleAnalyst } from './agents.js';

// Steady uptrend with rising volume at the end.
const trend = Array.from({ length: 100 }, (_, i) => {
  const c = 100 + i * 0.4 + Math.sin(i) * 0.3;
  return { t: i, o: c - 0.2, h: c + 0.5, l: c - 0.5, c, v: i > 95 ? 300 : 100 };
});
// Flat chop that ends with a dip under the band.
const range = Array.from({ length: 100 }, (_, i) => {
  const c = i === 99 ? 97 : 100 + Math.sin(i * 1.3) * 0.8;
  return { t: i, o: c, h: c + 0.4, l: c - 0.4, c, v: 100 };
});

test('a clean uptrend reads as a trend breakout', () => {
  const s = computeSignals(trend);
  assert.equal(s.regime, 'trending');
  assert.ok(s.ema9 > s.ema21);
  const sig = methodSignal({ ...s, rsi: 62, macdHist: 0.05 }, { m5: 0.1 }, null);
  assert.equal(sig.method, 'trend-breakout');
  assert.equal(sig.action, 'buy');
});

test('chop with a dip under the lower band reads as mean reversion', () => {
  const s = computeSignals(range);
  const sig = methodSignal({ ...s, regime: 'ranging' }, { m5: 0, h6: -1 }, null);
  assert.equal(sig.method, 'mean-reversion');
});

test('exits: overbought, ATR stop, and no-chase', () => {
  const s = computeSignals(trend);
  assert.equal(methodSignal({ ...s, rsi: 80 }, {}, { entry: s.close }).reason.includes('overbought'), true);
  assert.equal(methodSignal({ ...s, rsi: 60 }, {}, { entry: s.close * 1.2 }).reason, 'hit 2x ATR stop');
  assert.equal(methodSignal(s, { m5: 50 }, null).method, 'no-chase');
  assert.equal(methodSignal(null, {}, null).method, 'none');
  assert.equal(computeSignals(trend.slice(0, 20)), null);
});

test('candles parse oldest first from GeckoTerminal', async () => {
  const body = { data: { attributes: { ohlcv_list: [[2, '1', '2', '0.5', '1.5', '10'], [1, '1', '1', '1', '1', '5']] } } };
  const k = await fetchCandles('pool', async () => ({ ok: true, json: async () => body }));
  assert.deepEqual(k.map(x => x.t), [1, 2]);
  assert.equal(k[1].c, 1.5);
});

test('signal source caches per pool and survives a failed fetch', async () => {
  let calls = 0, t = 0;
  const list = trend.map(k => [k.t, k.o, k.h, k.l, k.c, k.v]).reverse();
  const fetchImpl = async url => { calls++; if (url.includes('bad')) return { ok: false, status: 429 }; return { ok: true, json: async () => ({ data: { attributes: { ohlcv_list: list } } }) }; };
  const attach = makeSignalSource({ fetchImpl, now: () => t, sleep: async () => {} });
  const market = () => ({ tokens: [{ sym: 'A', pool: 'good' }, { sym: 'B', pool: 'bad' }, { sym: 'C' }] });
  const m1 = await attach(market());
  assert.ok(m1.tokens[0].ind);
  assert.equal(m1.tokens[1].ind, undefined);
  await attach(market());
  assert.equal(calls, 2);
  t = 11 * 60 * 1000; await attach(market());
  assert.equal(calls, 4);
});

test('rule fallback trades the playbook when indicators exist', () => {
  const s = computeSignals(trend);
  const market = { tokens: [{ sym: 'JUP', price: s.close, liq: 1e6, m5: 0, h1: 1, h6: 1, b1: 1, s1: 1, ind: { ...s, rsi: 60, macdHist: 0.05 } }, { sym: 'BONK', price: 1, liq: 1e6, m5: 0, h1: 0, h6: 0, b1: 1, s1: 1 }] };
  const book = { cash: 100, pos: {} };
  const scout = ruleScout(market, book);
  assert.deepEqual(scout.candidates.map(c => c.token), ['JUP']);
  const { proposals } = ruleAnalyst(scout, book, market, 'med');
  assert.equal(proposals[0].action, 'buy');
  assert.match(proposals[0].reason, /trend-breakout/);
});

test('smart money: distributing wallets veto a buy and exit a held position', () => {
  const s = { ...computeSignals(trend), rsi: 62, macdHist: 0.05 };
  const dumping = { m5: 0.1, smart: { state: 'distributing', sellers: 3, buyers: 0 } };
  assert.equal(methodSignal(s, dumping, null).action, 'hold');
  assert.equal(methodSignal(s, dumping, { entry: s.close }).action, 'sell');
  assert.match(methodSignal(s, { m5: 0.1, smart: { state: 'accumulating' } }, null).reason, /smart money buying/);
});
