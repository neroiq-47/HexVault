import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesk } from './desk.js';
import { loadConfig } from './config.js';
import { parsePairs } from './market.js';
import { makeBrain } from './agents.js';
import { PAIRS } from './fixtures.js';

const config = loadConfig({});
const fetchMarket = async () => ({ at: Date.now(), tokens: parsePairs(PAIRS) });

test('a rule-based round runs and only buys liquid tokens', async () => {
  const desk = createDesk({ config, fetchMarket, brain: null });
  await desk.cycle();
  const { book, lastRound, lastError } = desk.state;
  assert.equal(lastError, null);
  assert.equal(book.rounds, 1);
  assert.equal(lastRound.scout.via, 'rules');
  assert.ok(!book.pos.WIF, 'WIF pool is under the liquidity floor');
});

test('agents use Claude replies, and hard limits still cap them', async () => {
  const replies = [
    { candidates: [{ token: 'JUP', reason: 'momentum' }] },
    { proposals: [{ token: 'JUP', action: 'buy', sizePct: 80, confidence: 0.9, reason: 'all in' }] },
    { decisions: [{ token: 'JUP', verdict: 'approve', sizePct: 80 }] },
    { note: 'Bought JUP.' },
  ];
  const client = { messages: { create: async () => ({ content: [{ type: 'text', text: JSON.stringify(replies.shift()) }] }) } };
  const desk = createDesk({ config, fetchMarket, brain: makeBrain({ client, model: 'm' }) });
  await desk.cycle();
  const fill = desk.state.lastRound.trader.fills[0];
  assert.equal(fill.sym, 'JUP');
  assert.equal(fill.usd, 10);
  assert.equal(desk.state.lastRound.trader.note, 'Bought JUP.');
});

test('a broken Claude reply falls back to rules', async () => {
  const client = { messages: { create: async () => ({ content: [{ type: 'text', text: 'not json' }] }) } };
  const desk = createDesk({ config, fetchMarket, brain: makeBrain({ client, model: 'm' }) });
  await desk.cycle();
  assert.equal(desk.state.lastRound.scout.via, 'rules');
});

test('sweep sends profit to the allow-listed address once a day', async () => {
  const { loadKeypair, newKeypair } = await import('./wallet.js');
  const sent = [];
  const wallet = { keypair: loadKeypair(newKeypair().secret), connection: { getBalance: async () => 5e9 }, send: async (_c, tx) => { sent.push(tx); return 'sig1'; } };
  const desk = createDesk({ config, fetchMarket, brain: null, wallet });
  await desk.refresh();
  desk.state.book.cash = 120; // $20 above float, $2 reserve at SOL $100
  const r = await desk.sweep(Date.now());
  assert.equal(r.status, 'sent');
  assert.ok(Math.abs(r.sol - 0.18) < 1e-9);
  assert.equal(await desk.sweep(Date.now()), null, 'second sweep the same day is skipped');
  assert.equal(sent.length, 1);
});

test('a failed send keeps the profit in the book', async () => {
  const { loadKeypair, newKeypair } = await import('./wallet.js');
  const wallet = { keypair: loadKeypair(newKeypair().secret), connection: { getBalance: async () => 0 } };
  const desk = createDesk({ config, fetchMarket, brain: null, wallet });
  await desk.refresh();
  desk.state.book.cash = 120;
  const r = await desk.sweep(Date.now());
  assert.equal(r.status, 'failed');
  assert.match(r.error, /needs/);
  assert.equal(desk.state.book.cash, 120);
});

test('kill switch closes positions and halts trading', async () => {
  const desk = createDesk({ config, fetchMarket, brain: null });
  await desk.refresh();
  const { buy } = await import('./paper.js');
  buy(desk.state.book, desk.state.market, 'JUP', 10);
  const r = await desk.kill();
  assert.equal(r.fills.length, 1);
  assert.equal(desk.state.book.halted, true);
  await desk.cycle();
  assert.equal(desk.state.book.rounds, 0);
});
