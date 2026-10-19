import test from 'node:test';
import assert from 'node:assert/strict';
import { coingeckoConfig, coingeckoUrl, rpcBackups, jupiterPrices } from './backups.js';
import { createMarketFeed, fromJupiter, WATCHLIST } from './market.js';
import { fetchCandles } from './methods.js';
import { createNet } from './degen/net.js';
import { createSources } from './degen/sources.js';
import { degenConfig } from './degen/engine.js';
import { loadConfig } from './config.js';
import { makeBrain } from './agents.js';
import { PAIRS } from './fixtures.js';

const ok = body => ({ ok: true, status: 200, json: async () => body });
const fail = status => ({ ok: false, status, json: async () => ({}) });
const SOL = 'So11111111111111111111111111111111111111112', JUP = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
const GT_URL = 'https://api.geckoterminal.com/api/v2/networks/solana/pools/P/ohlcv/minute?aggregate=15';

test('CoinGecko mirror is off without a key and maps GeckoTerminal paths with the plan header', () => {
  assert.equal(coingeckoConfig({}), null);
  const demo = coingeckoConfig({ COINGECKO_API_KEY: ' k ' });
  assert.deepEqual(demo, { key: 'k', base: 'https://api.coingecko.com/api/v3/onchain/networks/solana', header: 'x-cg-demo-api-key' });
  assert.equal(coingeckoUrl(GT_URL, demo), 'https://api.coingecko.com/api/v3/onchain/networks/solana/pools/P/ohlcv/minute?aggregate=15');
  assert.equal(coingeckoConfig({ COINGECKO_API_KEY: 'k', COINGECKO_PLAN: 'pro' }).header, 'x-cg-pro-api-key');
});

test('RPC backups default to public endpoints, never repeat the primary, and can be turned off', () => {
  assert.deepEqual(rpcBackups('', 'https://a'), ['https://solana-rpc.publicnode.com']);
  assert.deepEqual(rpcBackups('https://b, junk, https://a', 'https://a'), ['https://b']);
  assert.deepEqual(rpcBackups('off', 'https://a'), []);
  const c = degenConfig({}, {});
  assert.deepEqual(c.rpcBackups, ['https://solana-rpc.publicnode.com']);
  assert.equal(c.coingecko, null);
});

test('net.rpc moves to the backup RPC when the primary fails', async () => {
  const hits = [];
  const net = createNet({ sleep: async () => {}, fetchImpl: async url => { hits.push(url); return url === 'https://main' ? fail(503) : ok({ result: 42 }); } });
  assert.equal(await net.rpc(['https://main', 'https://backup'], 'getSlot', []), 42);
  assert.deepEqual(hits, ['https://main', 'https://backup']);
  assert.equal(net.health.rpc.errors, 1);
  assert.equal(net.health.rpcBackup.ok, 1);
  await assert.rejects(net.rpc(['https://main'], 'getBlockHeight', []), /503/);
});

test('degen GeckoTerminal calls fall back to CoinGecko with the key header', async () => {
  const seen = [];
  const body = { data: { attributes: { ohlcv_list: [[1, 1, 1, 1, 2, 5]] } } };
  const net = createNet({ sleep: async () => {}, fetchImpl: async (url, init) => { seen.push([url, init.headers['x-cg-demo-api-key']]); return url.includes('geckoterminal') ? fail(429) : ok(body); } });
  const src = createSources({ net, coingecko: coingeckoConfig({ COINGECKO_API_KEY: 'k' }) });
  const k = await src.candles('POOL', 5, 0);
  assert.equal(k[0].c, 2);
  assert.match(seen[1][0], /^https:\/\/api\.coingecko\.com\/api\/v3\/onchain\/networks\/solana\/pools\/POOL\/ohlcv/);
  assert.equal(seen[1][1], 'k');
  // Without a key the GeckoTerminal error still surfaces.
  const bare = createSources({ net: createNet({ sleep: async () => {}, fetchImpl: async () => fail(500) }) });
  await assert.rejects(bare.tokenInfo('M'), /500/);
});

test('desk candles fall back to CoinGecko when GeckoTerminal is blocked', async () => {
  const body = { data: { attributes: { ohlcv_list: [[1, '1', '1', '1', '3', '1']] } } };
  const fetchImpl = async url => url.includes('geckoterminal') ? fail(429) : ok(body);
  await assert.rejects(fetchCandles('P', fetchImpl), /429/);
  const k = await fetchCandles('P', fetchImpl, coingeckoConfig({ COINGECKO_API_KEY: 'k' }));
  assert.equal(k[0].c, 3);
});

test('Jupiter prices parse and fill the desk market with the last pools', async () => {
  const body = { [SOL]: { usdPrice: 150, liquidity: 1e9, priceChange24h: -2 }, [JUP]: { usdPrice: 0 } };
  let url;
  const p = await jupiterPrices([SOL, JUP], { fetchImpl: async u => { url = u; return ok(body); } });
  assert.match(url, /^https:\/\/lite-api\.jup\.ag\/price\/v3\?ids=/);
  assert.deepEqual(Object.keys(p), [SOL]);
  const toks = fromJupiter(p, { tokens: [{ mint: SOL, pool: 'POOL', vol: 7 }] });
  assert.deepEqual(toks, [{ mint: SOL, sym: 'SOL', pool: 'POOL', price: 150, liq: 1e9, m5: 0, h1: 0, h6: 0, h24: -2, vol: 7, b1: 0, s1: 0 }]);
  assert.throws(() => fromJupiter({}), /No watchlist/);
});

test('market feed uses DexScreener, then Jupiter when DexScreener is down', async () => {
  let dexDown = false;
  const pairs = structuredClone(PAIRS).map((p, i) => ({ ...p, pairAddress: `POOL${i}` }));
  const fetchImpl = async url => url.includes('dexscreener') ? (dexDown ? fail(503) : ok(pairs)) : ok({ [SOL]: { usdPrice: 140, liquidity: 5, priceChange24h: 1 } });
  const feed = createMarketFeed({ fetchImpl });
  const a = await feed();
  assert.equal(a.source, 'dexscreener');
  dexDown = true;
  const b = await feed();
  assert.equal(b.source, 'jupiter');
  assert.equal(b.tokens[0].price, 140);
  assert.match(b.tokens[0].pool, /^POOL\d$/);
  assert.equal(b.tokens[0].pool, a.tokens.find(t => t.mint === SOL).pool);
  const dead = createMarketFeed({ fetchImpl: async () => fail(500) });
  await assert.rejects(dead(), /DexScreener HTTP 500; backup Jupiter Price HTTP 500/);
  assert.ok(Object.keys(WATCHLIST).includes(SOL));
});

test('OpenRouter and Cerebras join the AI backups when their keys are set', async () => {
  const c = loadConfig({ OPENROUTER_API_KEY: 'o', CEREBRAS_API_KEY: 'c', GROQ_API_KEY: 'g' });
  assert.deepEqual(c.backups.map(b => b.name), ['groq', 'openrouter', 'cerebras']);
  const urls = [];
  const brain = makeBrain({ backups: c.backups, fetchFn: async url => { urls.push(url); return url.includes('cerebras') ? ok({ choices: [{ message: { content: '{"x":1}' } }] }) : fail(429); } });
  assert.deepEqual(brain.providers, ['groq', 'openrouter', 'cerebras']);
  const out = await brain('hi');
  assert.equal(out.via, 'cerebras');
  assert.equal(urls[1], 'https://openrouter.ai/api/v1/chat/completions');
});
