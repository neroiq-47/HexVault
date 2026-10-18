import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesk } from './desk.js';
import { createServer } from './server.js';
import { loadConfig } from './config.js';
import { loadKeypair, newKeypair } from './wallet.js';
import { createExecutor } from './live.js';
import { MINTS } from './jupiter.js';

const SECRET = 'a'.repeat(32);
const market = { at: 0, tokens: [{ sym: 'SOL', price: 100, liq: 1e9 }, { sym: 'JUP', price: 0.28, liq: 1e8 }] };
const fakeJupiter = () => ({
  quote: async ({ inputMint, amount }) => ({ outAmount: String(inputMint === MINTS.SOL ? Math.floor(amount / 1e9 * 100 / 0.28 * 1e6) : Math.floor(amount / 1e6 * 0.28 / 100 * 1e9)), priceImpactPct: '0' }),
  swapTransaction: async () => ({}),
});

function armedDesk({ mode = 'live', solBalance = 1, tokenRaw = '1000000000', sent = [] } = {}) {
  const config = loadConfig({ TRADING_MODE: mode, JUPITER_API_KEY: 'k', FLOAT_SOL: '1', AGENT_WALLET_SECRET: 'x', ADMIN_SECRET: SECRET });
  const keypair = loadKeypair(newKeypair().secret);
  const connection = { getBalance: async () => solBalance * 1e9, getParsedTokenAccountsByOwner: async () => ({ value: tokenRaw === '0' ? [] : [{ account: { data: { parsed: { info: { tokenAmount: { amount: tokenRaw } } } } } }] }) };
  const jupiter = fakeJupiter();
  const executors = { shadow: createExecutor({ mode: 'shadow', jupiter, connection, keypair }) };
  if (mode === 'live') executors.live = createExecutor({ mode: 'live', jupiter, connection, keypair, send: async () => { sent.push(1); return 'sig'; } });
  const desk = createDesk({ config, fetchMarket: async () => market, brain: null, wallet: { keypair, connection }, executors, mode: 'shadow' });
  return { desk, config, wallet: { keypair, connection } };
}

test('the Live switch turns live on from a fresh book and off by selling back to SOL', async () => {
  const sent = [];
  const { desk } = armedDesk({ sent });
  await desk.refresh();
  desk.state.book.pos.JUP = { qty: 50, cost: 14 }; // a shadow position is dropped, never sold for real
  assert.equal((await desk.setLive(true)).mode, 'live');
  assert.deepEqual(desk.state.book.pos, {});
  assert.equal(sent.length, 0);
  desk.state.book.pos.JUP = { qty: 10, cost: 3 };
  const off = await desk.setLive(false);
  assert.equal(off.mode, 'shadow');
  assert.equal(off.fills.length, 1);
  assert.equal(sent.length, 1, 'the live position was sold with a real swap');
});

test('the Live switch stays locked unless TRADING_MODE=live armed it', async () => {
  const { desk } = armedDesk({ mode: 'shadow' });
  await desk.refresh();
  await assert.rejects(desk.setLive(true), /locked/);
  assert.equal(desk.state.mode, 'shadow');
});

test('the Live switch refuses an underfunded wallet and stays in shadow', async () => {
  const { desk } = armedDesk({ solBalance: 0.1, tokenRaw: '0' });
  await desk.refresh();
  await assert.rejects(desk.setLive(true), /Fund it/);
  assert.equal(desk.state.mode, 'shadow');
});

test('POST /api/live needs the admin secret', async () => {
  const { desk, config, wallet } = armedDesk();
  await desk.refresh();
  const server = createServer({ desk, config, wallet, persist: async () => {} }).listen(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const bad = await fetch(`${url}/api/live`, { method: 'POST', headers: { authorization: 'Bearer nope' }, body: '{"on":true}' });
    assert.equal(bad.status, 401);
    const ok = await fetch(`${url}/api/live`, { method: 'POST', headers: { authorization: `Bearer ${SECRET}` }, body: '{"on":true}' });
    assert.equal((await ok.json()).mode, 'live');
    const st = await (await fetch(`${url}/api/state`)).json();
    assert.equal(st.mode, 'live'); assert.equal(st.armed, true);
    const page = await fetch(`${url}/`);
    assert.match(await page.text(), /role="switch"/);
  } finally { server.close(); }
});
