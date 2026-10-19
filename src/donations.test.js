import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyDonation } from './donations.js';
import { createDesk } from './desk.js';
import { createServer } from './server.js';
import { loadConfig } from './config.js';
import { loadKeypair, newKeypair } from './wallet.js';

const SIG = '5'.repeat(88);
const AGENT = loadKeypair(newKeypair().secret);
const DONOR = loadKeypair(newKeypair().secret).publicKey.toBase58();
const txOf = (sol, to = AGENT.publicKey.toBase58(), err = null) => ({
  blockTime: 1, meta: { err },
  transaction: { message: { instructions: [{ program: 'system', parsed: { type: 'transfer', info: { source: DONOR, destination: to, lamports: Math.round(sol * 1e9) } } }] } },
});
const conn = tx => ({ getParsedTransaction: async () => tx, getLatestBlockhash: async () => ({ blockhash: 'bh', lastValidBlockHeight: 1 }) });

test('a donation counts only when it is a confirmed 0.5 to 10 SOL transfer to the agent wallet', async () => {
  const me = AGENT.publicKey.toBase58();
  assert.equal((await verifyDonation(conn(txOf(2)), SIG, me)).deposit.sol, 2);
  assert.equal((await verifyDonation(conn(null), SIG, me)).status, 'pending');
  assert.match((await verifyDonation(conn(txOf(0.4)), SIG, me)).error, /0.5 to 10/);
  assert.match((await verifyDonation(conn(txOf(11)), SIG, me)).error, /0.5 to 10/);
  assert.match((await verifyDonation(conn(txOf(2, DONOR)), SIG, me)).error, /No SOL transfer/);
  assert.match((await verifyDonation(conn(txOf(2, me, { x: 1 })), SIG, me)).error, /failed/);
  assert.equal((await verifyDonation(conn(txOf(2)), 'nope', me)).status, 'invalid');
});

test('donations raise the live baseline so they are not swept as profit', async () => {
  const config = loadConfig({ TRADING_MODE: 'live', JUPITER_API_KEY: 'k', FLOAT_SOL: '1', AGENT_WALLET_SECRET: 'x' });
  const connection = { getBalance: async () => 3e9, getParsedTokenAccountsByOwner: async () => ({ value: [] }) };
  const market = { at: 0, tokens: [{ sym: 'SOL', price: 100, liq: 1e9 }] };
  const desk = createDesk({ config, fetchMarket: async () => market, brain: null, wallet: { keypair: AGENT, connection, send: async () => 'sig' } });
  desk.addDeposit({ ts: 0, sol: 2, from: DONOR, signature: SIG });
  assert.equal(desk.addDeposit({ ts: 0, sol: 2, from: DONOR, signature: SIG }), false, 'the same signature counts once');
  await desk.refresh();
  assert.equal(await desk.sweep(Date.now()), null, '3 SOL in a wallet with a 1 SOL float and 2 SOL donated has no profit');
});

test('the donation endpoints are off unless DONATIONS=on', async () => {
  const run = async env => {
    const config = loadConfig(env);
    const desk = createDesk({ config, fetchMarket: async () => ({ at: 0, tokens: [] }), brain: null });
    const server = createServer({ desk, config, wallet: { keypair: AGENT, connection: conn(txOf(1)) }, persist: async () => {} }).listen(0);
    const url = `http://127.0.0.1:${server.address().port}`;
    try {
      const post = await fetch(`${url}/api/donation`, { method: 'POST', body: JSON.stringify({ signature: SIG }) });
      const state = await (await fetch(`${url}/api/state`)).json();
      return { status: post.status, body: await post.json(), state };
    } finally { server.close(); }
  };
  assert.equal((await run({})).status, 404);
  const on = await run({ DONATIONS: 'on' });
  assert.equal(on.status, 200);
  assert.equal(on.state.donations.totalSol, 1);
  assert.equal(on.state.donations.enabled, true);
});

test('HEAD requests are answered like GET, without a body', async () => {
  const config = loadConfig({});
  const desk = createDesk({ config, fetchMarket: async () => ({ at: 0, tokens: [] }), brain: null });
  const server = createServer({ desk, config, wallet: null, persist: async () => {} }).listen(0);
  try {
    for (const path of ['/', '/health']) {
      const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: 'HEAD' });
      assert.equal(res.status, 200, path);
      assert.equal(await res.text(), '');
    }
  } finally { server.close(); }
});
