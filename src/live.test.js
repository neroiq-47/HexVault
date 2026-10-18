import test from 'node:test';
import assert from 'node:assert/strict';
import { createJupiter, MINTS, SOL_MINT } from './jupiter.js';
import { createExecutor } from './live.js';
import { createDesk } from './desk.js';
import { loadConfig } from './config.js';
import { newBook } from './paper.js';
import { parsePairs } from './market.js';
import { loadKeypair, newKeypair } from './wallet.js';
import { PAIRS } from './fixtures.js';

const market = { at: 0, tokens: parsePairs(PAIRS) }; // SOL $100, JUP $0.28
const ok = body => ({ ok: true, json: async () => body });

test('quote rejects high price impact, unknown mints and mismatched replies', async () => {
  const jup = impact => createJupiter({ apiKey: 'k', fetchImpl: async () => ok({ inputMint: SOL_MINT, outputMint: MINTS.JUP, outAmount: '1000', priceImpactPct: impact }) });
  await assert.rejects(jup('0.02').quote({ inputMint: SOL_MINT, outputMint: MINTS.JUP, amount: 1000 }), /price impact/);
  await assert.rejects(jup('0').quote({ inputMint: SOL_MINT, outputMint: 'Evil1111111111111111111111111111111111111111', amount: 1000 }), /watchlist/);
  await assert.rejects(jup('0').quote({ inputMint: SOL_MINT, outputMint: MINTS.RAY, amount: 1000 }), /do not match/);
  const q = await jup('0.001').quote({ inputMint: SOL_MINT, outputMint: MINTS.JUP, amount: 1000 });
  assert.equal(q.outAmount, '1000');
});

test('quote sends the API key and caps slippage at 1%', async () => {
  let seen;
  const j = createJupiter({ apiKey: 'secret-key', fetchImpl: async (url, init) => { seen = { url, init }; return ok({ inputMint: SOL_MINT, outputMint: MINTS.JUP, outAmount: '5', priceImpactPct: '0' }); } });
  await j.quote({ inputMint: SOL_MINT, outputMint: MINTS.JUP, amount: 10 });
  assert.equal(seen.init.headers['x-api-key'], 'secret-key');
  assert.match(seen.url, /slippageBps=100/);
});

function fakeJupiter() {
  const calls = [];
  return {
    calls,
    quote: async ({ inputMint, outputMint, amount }) => { calls.push(['quote', inputMint, outputMint, amount]);
      // 1 SOL buys 357.14 JUP at $0.28; selling returns SOL at the same rate.
      const out = inputMint === SOL_MINT ? Math.floor(amount / 1e9 * 100 / 0.28 * 1e6) : Math.floor(amount / 1e6 * 0.28 / 100 * 1e9);
      return { inputMint, outputMint, outAmount: String(out), priceImpactPct: '0.001' }; },
    swapTransaction: async () => { calls.push(['swap']); return { sign() {}, serialize() { return new Uint8Array(); }, message: {} }; },
  };
}

test('shadow mode books quoted fills and never sends', async () => {
  const jupiter = fakeJupiter(); let sent = 0;
  const exec = createExecutor({ mode: 'shadow', jupiter, connection: {}, keypair: loadKeypair(newKeypair().secret), send: async () => { sent++; } });
  const book = newBook(50, 100);
  const fills = await exec({ book, market, approved: [{ action: 'buy', token: 'JUP', usd: 5 }, { action: 'buy', token: 'SOL', usd: 5 }] });
  assert.equal(fills.length, 1, 'SOL is the float and is never bought');
  assert.equal(sent, 0);
  assert.ok(!jupiter.calls.some(c => c[0] === 'swap'));
  assert.ok(Math.abs(book.pos.JUP.qty - 17.857142) < 1e-3);
});

test('live mode signs and sends the swap, and books it with the signature', async () => {
  const jupiter = fakeJupiter();
  const connection = { getParsedTokenAccountsByOwner: async () => ({ value: [{ account: { data: { parsed: { info: { tokenAmount: { amount: '17857142' } } } } } }] }) };
  const exec = createExecutor({ mode: 'live', jupiter, connection, keypair: loadKeypair(newKeypair().secret), send: async () => 'sigLive' });
  const book = newBook(50, 100);
  const [buyFill] = await exec({ book, market, approved: [{ action: 'buy', token: 'JUP', usd: 5 }] });
  assert.equal(buyFill.signature, 'sigLive');
  const [sellFill] = await exec({ book, market, approved: [{ action: 'sell', token: 'JUP', frac: 1 }] });
  assert.equal(sellFill.signature, 'sigLive');
  assert.deepEqual(book.pos, {});
});

test('a failed live swap leaves the book untouched', async () => {
  const jupiter = fakeJupiter();
  const exec = createExecutor({ mode: 'live', jupiter, connection: {}, keypair: loadKeypair(newKeypair().secret), send: async () => { throw new Error('blockhash expired'); } });
  const book = newBook(50, 100);
  assert.deepEqual(await exec({ book, market, approved: [{ action: 'buy', token: 'JUP', usd: 5 }] }), []);
  assert.equal(book.cash, 50);
});

function liveDesk({ solBalance, tokenRaw = '0', send = async () => 'sweepSig' }) {
  const config = loadConfig({ TRADING_MODE: 'live', JUPITER_API_KEY: 'k', FLOAT_SOL: '1', AGENT_WALLET_SECRET: 'x' });
  const keypair = loadKeypair(newKeypair().secret);
  const connection = {
    getBalance: async () => solBalance * 1e9,
    getParsedTokenAccountsByOwner: async (_o, { mint }) => ({ value: mint.toBase58() === MINTS.JUP && tokenRaw !== '0' ? [{ account: { data: { parsed: { info: { tokenAmount: { amount: tokenRaw } } } } } }] : [] }),
  };
  const jupiter = fakeJupiter();
  const executor = createExecutor({ mode: 'live', jupiter, connection, keypair, send: async () => 'swapSig' });
  return createDesk({ config, fetchMarket: async () => market, brain: null, wallet: { keypair, connection, send }, executor });
}

test('live sweep sends only real profit above float plus reserve', async () => {
  const desk = liveDesk({ solBalance: 1.3 });
  await desk.refresh();
  const r = await desk.sweep(Date.now());
  assert.equal(r.status, 'sent');
  assert.ok(Math.abs(r.sol - 0.28) < 1e-9);
});

test('live sweep does nothing when the wallet is at or below the float', async () => {
  const desk = liveDesk({ solBalance: 1.01 });
  await desk.refresh();
  assert.equal(await desk.sweep(Date.now()), null);
});

test('a 20% drawdown closes every position and halts trading', async () => {
  const desk = liveDesk({ solBalance: 0.7, tokenRaw: '17857142' }); // 0.7 SOL + 0.05 SOL of JUP = 0.75 of a 1 SOL float
  await desk.refresh();
  desk.state.book.pos.JUP = { qty: 17.857142, cost: 5 };
  await desk.cycle();
  assert.equal(desk.state.book.halted, true);
  assert.match(desk.state.book.haltReason, /drawdown/);
  assert.equal(desk.state.book.pos.JUP, undefined);
  assert.equal(desk.state.book.rounds, 0);
});
