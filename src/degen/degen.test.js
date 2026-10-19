import test from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter, createCache, createNet, BudgetError } from './net.js';
import { parseGeckoPools, parseDexPairs, parseMint, parseTokenInfo, parseReddit, parseBizCatalog, TOKEN_2022, createSources } from './sources.js';
import { mergeTokens, features, matchPreset, DEFAULT_PRESETS, createHistory, toRow, tokenFromRow, validatePresets } from './scanner.js';
import { assessSecurity } from './security.js';
import { sentiment, shillScore, flagPosts, matchMentions, socialMomentum, narratives } from './social.js';
import { parseSwap, walletStats, flows, linkedWallets, smartSignal, smartFlow, MIN_TRADES } from './wallets.js';
import { degenScore, zones } from './score.js';
import { newBook, openTrade, manage, bookStats } from './paper.js';
import { backtest } from './backtest.js';
import { createDegen, degenConfig } from './engine.js';

const GOOD = 'GooD1111111111111111111111111111111111pump', BAD = 'BaD11111111111111111111111111111111111pump';
const NOW = Date.parse('2026-10-19T06:00:00Z');
const gtPool = (mint, sym, o = {}) => ({ id: `solana_P${sym}`, type: 'pool', attributes: { address: `Pool${sym}111111111111111111111111111111`, name: `${sym} / SOL`, pool_created_at: new Date(NOW - (o.ageMin ?? 20) * 60000).toISOString(),
  base_token_price_usd: String(o.price ?? 0.001), fdv_usd: String(o.mcap ?? 200000), market_cap_usd: null, reserve_in_usd: String(o.liq ?? 40000),
  price_change_percentage: { m5: String(o.m5 ?? 8), h1: String(o.h1 ?? 40), h6: '40', h24: '40' },
  transactions: { m5: { buys: 60, sells: 25, buyers: o.buyers ?? 50, sellers: 20 }, h1: { buys: 300, sells: 150, buyers: 200, sellers: 90 }, h24: { buys: 300, sells: 150, buyers: 200, sellers: 90 } },
  volume_usd: { m5: String(o.vol5m ?? 9000), h1: String(o.vol1h ?? 30000), h6: '30000', h24: '30000' } },
  relationships: { base_token: { data: { id: `solana_${mint}` } }, dex: { data: { id: 'pump-fun' } } } });
const GT_BODY = { data: [gtPool(GOOD, 'GOOD'), gtPool(BAD, 'BAD'), gtPool('So11111111111111111111111111111111111111112', 'SOL')],
  included: [{ id: `solana_${GOOD}`, type: 'token', attributes: { symbol: 'GOOD', name: 'Good Dog' } }, { id: `solana_${BAD}`, type: 'token', attributes: { symbol: 'BAD', name: 'Bad Cat' } }] };

test('rate limiter waits briefly, then refuses instead of blowing the budget', async () => {
  let t = 0; const slept = [];
  const l = createLimiter(60, { now: () => t, sleep: async ms => { slept.push(ms); t += ms; }, maxWaitMs: 2000 });
  for (let i = 0; i < 8; i++) await l.take();
  await l.take(); assert.equal(Math.round(slept[0]), 1000);
  l.pause(60000); await assert.rejects(l.take(), BudgetError);
});

test('cache collapses duplicate in-flight requests and expires', async () => {
  let t = 0, calls = 0; const c = createCache({ now: () => t });
  const f = () => new Promise(r => setTimeout(() => r(++calls), 5));
  assert.deepEqual(await Promise.all([c.wrap('k', 100, f), c.wrap('k', 100, f)]), [1, 1]);
  t = 200; assert.equal(await c.wrap('k', 100, f), 2);
});

test('net records source health and backs off on 429', async () => {
  const net = createNet({ fetchImpl: async () => ({ status: 429, ok: false }) });
  await assert.rejects(net.json('dexscreener', 'https://x/1'), /429/);
  assert.equal(net.health.dexscreener.errors, 1);
  await assert.rejects(net.json('dexscreener', 'https://x/2'), BudgetError);
});

test('parses GeckoTerminal pools and drops quote tokens', () => {
  const t = parseGeckoPools(GT_BODY);
  assert.deepEqual(t.map(x => x.sym), ['GOOD', 'BAD']);
  assert.equal(t[0].tx.m5.buyers, 50); assert.equal(t[0].liq, 40000);
  assert.throws(() => parseGeckoPools({}));
});

test('parses DexScreener pairs, keeping the deepest pool and bonding curves with no liquidity', () => {
  const pairs = [
    { chainId: 'solana', pairAddress: 'a', baseToken: { address: GOOD, symbol: 'GOOD' }, priceUsd: '1', liquidity: { usd: 100 }, volume: { h24: 5 }, txns: { m5: { buys: 1, sells: 2 } }, info: { socials: [{ type: 'twitter' }] } },
    { chainId: 'solana', pairAddress: 'b', baseToken: { address: GOOD, symbol: 'GOOD' }, priceUsd: '1', liquidity: { usd: 9000 }, volume: { h24: 5 } },
    { chainId: 'solana', pairAddress: 'c', baseToken: { address: BAD, symbol: 'BAD' }, priceUsd: '2', volume: { h24: 900 }, marketCap: 5000 },
  ];
  const t = parseDexPairs(pairs);
  assert.equal(t.find(x => x.mint === GOOD).pool, 'b');
  assert.equal(t.find(x => x.mint === BAD).liq, null);
});

test('parses mint accounts, token info, Reddit and /biz/', () => {
  const m = parseMint({ value: { owner: TOKEN_2022, data: { parsed: { info: { mintAuthority: null, freezeAuthority: 'F', decimals: 6, supply: '1000000000000', extensions: [{ extension: 'permanentDelegate' }] } } } } });
  assert.equal(m.supply, 1e6); assert.equal(m.freezeAuthority, 'F'); assert.deepEqual(m.extensions, ['permanentDelegate']);
  assert.equal(parseMint({ value: null }), null);
  const i = parseTokenInfo({ data: { attributes: { holders: { count: 812 }, developer_address: 'D', developer_holding_percentage: '4.5', mint_authority: 'no', freeze_authority: 'yes' } } });
  assert.deepEqual([i.holders, i.devPct, i.mintAuthority, i.freezeAuthority], [812, 4.5, false, true]);
  const r = parseReddit({ data: { children: [{ data: { id: 'x', subreddit: 'solana', author: 'u', title: '$GOOD', selftext: '', score: 5, num_comments: 2, created_utc: 1, permalink: '/r/x' } }] } });
  assert.equal(r[0].id, 'reddit:x'); assert.equal(r[0].created, 1000);
  const b = parseBizCatalog([{ threads: [{ no: 1, sub: 'sol thread', com: 'buy &gt; sell<br>now', time: 2, id: 'abc', last_replies: [{ no: 2, com: 'rug', time: 3, id: 'def' }] }] }]);
  assert.equal(b.length, 2); assert.equal(b[0].text, 'buy > sell now');
});

test('features and presets: missing data never matches a preset', () => {
  const [tok] = parseGeckoPools(GT_BODY);
  const f = features(tok, [], NOW);
  assert.equal(f.ageMin, 20); assert.equal(f.volAccel, 3.6); assert.equal(f.buyRatio5m, 2.5);
  assert.deepEqual(matchPreset(f, DEFAULT_PRESETS.fresh).fails, []);
  const r = matchPreset({ ...f, buyers5m: null }, DEFAULT_PRESETS.fresh);
  assert.equal(r.pass, false); assert.match(r.fails[0], /no data/);
  assert.equal(matchPreset(f, DEFAULT_PRESETS.runners).pass, false);
});

test('merges both sources, preferring DexScreener liquidity and GeckoTerminal unique buyers', () => {
  const [g] = parseGeckoPools(GT_BODY);
  const [d] = parseDexPairs([{ chainId: 'solana', pairAddress: 'x', baseToken: { address: GOOD, symbol: 'GOOD' }, priceUsd: '0.001', liquidity: { usd: 55000 }, txns: { m5: { buys: 70, sells: 20 } }, info: { socials: [{ type: 'telegram' }] } }]);
  const [m] = mergeTokens([[g], [d]]);
  assert.equal(m.liq, 55000); assert.equal(m.tx.m5.buyers, 50); assert.equal(m.tx.m5.buys, 70); assert.deepEqual(m.src, ['gecko', 'dex']); assert.deepEqual(m.socials, ['telegram']);
});

test('history rows round-trip through tokenFromRow', () => {
  const [tok] = parseGeckoPools(GT_BODY);
  const f = features(tok, [], NOW), back = features(tokenFromRow(toRow(NOW, f, { score: 50, sec: 'pass' })), [], NOW);
  for (const k of ['ageMin', 'price', 'liq', 'vol5m', 'volAccel', 'buyRatio5m', 'buyRatio1h', 'm5', 'h1']) assert.equal(back[k], f[k], k);
  const h = createHistory({ everyMs: 1000 });
  h.record('a', [0]); h.record('a', [500]); h.record('a', [1500]);
  assert.deepEqual(h.get('a'), [[500], [1500]]);
});

const holders = list => list.map(([pct, program = false, amount = pct * 1e4]) => ({ owner: 'Own' + pct + 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', pct, program, amount }));
const CLEAN = { mint: { program: 'Tokenkeg', mintAuthority: null, freezeAuthority: null, extensions: [] }, holders: holders([[60, true], [3], [2.5], [2], [1.5]]), info: { devPct: 1 }, f: { liq: 50000, buys5m: 60, sells5m: 25, buyers5m: 50, sellers5m: 20, m5: 5 } };

test('security passes a clean token and excludes program-owned pools from concentration', () => {
  const s = assessSecurity(CLEAN);
  assert.equal(s.status, 'pass', JSON.stringify(s.checks.filter(c => c.status !== 'pass')));
  assert.match(s.checks.find(c => c.id === 'top10').detail, /60.0% in pools/);
});

test('security never treats missing data as a pass', () => {
  assert.equal(assessSecurity({ f: { liq: 50000 } }).status, 'unverified');
  assert.equal(assessSecurity({ ...CLEAN, holders: null }).status, 'unverified');
  assert.equal(assessSecurity({ ...CLEAN, f: {} }).status, 'unverified');
});

test('security rejects authorities, dangerous Token-2022, whales, bundles, wash trading and dev dumps', () => {
  const fail = (patch, id) => { const s = assessSecurity({ ...CLEAN, ...patch }); assert.equal(s.status, 'fail', id); assert.equal(s.checks.find(c => c.id === id).status, 'fail', id); };
  fail({ mint: { ...CLEAN.mint, mintAuthority: 'Dev' } }, 'mintAuthority');
  fail({ mint: { ...CLEAN.mint, freezeAuthority: 'Dev' } }, 'freezeAuthority');
  fail({ mint: { ...CLEAN.mint, program: TOKEN_2022, extensions: ['transferFeeConfig'] } }, 'extensions');
  fail({ holders: holders([[20], [3]]) }, 'whale');
  fail({ holders: holders([[9], [9], [9], [9], [9]]) }, 'top10');
  fail({ holders: holders([[2, false, 5e6], [2, false, 5e6], [2, false, 5.01e6], [2, false, 4.99e6]]) }, 'cluster');
  fail({ f: { ...CLEAN.f, buys5m: 200, sells5m: 200, buyers5m: 20, sellers5m: 20 } }, 'wash');
  fail({ info: { devPct: 0.5 }, devStart: 8 }, 'dev');
  fail({ f: { ...CLEAN.f, liq: 900 } }, 'liquidity');
  const drain = [[NOW - 600000, 1, 60000], [NOW - 300000, 1, 58000], [NOW, 1, 20000]].map(([t, p, l]) => { const r = toRow(t, {}); r[1] = p; r[2] = l; return r; });
  fail({ hist: drain }, 'liqDrain');
});

test('sentiment handles crypto slang, emojis and negation', () => {
  assert.ok(sentiment('this is so bullish, sending to the moon 🚀') > 0.4);
  assert.ok(sentiment('total rug, dev dumped, scam') < -0.6);
  assert.ok(sentiment('not a scam') > 0);
  assert.equal(sentiment('the weather today'), 0);
});

test('flags shills, copy-paste campaigns and repeat posters as bots', () => {
  assert.ok(shillScore('NEXT 100X GEM!!! JOIN OUR TELEGRAM t.me/x 🚀🚀🚀🚀🚀🚀') >= 0.75);
  const spam = Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, author: 'shill', title: 'Next 100x gem $GOOD join our telegram now ape in fast', text: '', created: NOW }));
  const flagged = flagPosts([...spam, { id: 'o', author: 'alice', title: 'Looked at $GOOD, liquidity seems fine but careful', text: '', created: NOW }]);
  assert.ok(flagged.filter(p => p.author === 'shill').every(p => p.bot >= 0.5));
  assert.ok(flagged.find(p => p.id === 'o').bot < 0.5);
});

test('matches mentions by address, uncommon tickers and names, not common words', () => {
  const posts = [{ id: 1, title: `CA ${BAD}`, text: '' }, { id: 2, title: 'love $GOOD', text: '' }, { id: 3, title: 'buy $SOL', text: '' }, { id: 4, title: 'Good Dog is cute', text: '' }];
  const m = matchMentions(posts, [{ mint: GOOD, sym: 'GOOD', name: 'Good Dog' }, { mint: BAD, sym: 'BAD', name: 'x' }, { mint: 'So11111111111111111111111111111111111111112', sym: 'SOL', name: 'Solana' }]);
  assert.deepEqual(m[GOOD].map(p => p.id), [2, 4]); assert.deepEqual(m[BAD].map(p => p.id), [1]); assert.equal(m.So11111111111111111111111111111111111111112, undefined);
});

test('social momentum is null when no source answered and 0 when nobody mentions the token', () => {
  assert.deepEqual(socialMomentum([], { available: false }), { score: null, status: 'unavailable' });
  assert.equal(socialMomentum([], { available: true }).score, 0);
  const organic = Array.from({ length: 8 }, (_, i) => ({ src: 'reddit', author: `u${i}`, created: NOW - i * 60000, score: 20, comments: 5, sentiment: 0.6, bot: 0.1 }));
  const botty = organic.map(p => ({ ...p, bot: 0.9 }));
  const a = socialMomentum(organic, { now: NOW }), b = socialMomentum(botty, { now: NOW });
  assert.ok(a.score > 50, String(a.score)); assert.ok(b.score < a.score / 2); assert.ok(b.suspicious);
});

test('spots narratives from new token names', () => {
  const tokens = ['Ghost Sector', 'Ghost Cat', 'Ghost Dog', 'Ghost Inu'].map((name, i) => ({ mint: `m${i}`, sym: `G${i}`, name, createdAt: NOW - i * 60000 }));
  const n = narratives({ tokens, now: NOW });
  assert.equal(n[0].term, 'ghost'); assert.equal(n[0].recent, 4);
});

const W = 'Wa11et111111111111111111111111111111111111';
const swapTx = ({ sol, tok, mint = GOOD, slot = 1, t = 1, fee = 5000 }) => ({ slot, blockTime: t, transaction: { signatures: [`sig${slot}${t}`], message: { accountKeys: [{ pubkey: W }, { pubkey: 'Pool' }] } },
  meta: { err: null, fee, preBalances: [10e9, 0], postBalances: [10e9 + sol * 1e9 - fee, 0],
    preTokenBalances: [{ owner: W, mint, uiTokenAmount: { uiAmount: 1000 } }], postTokenBalances: [{ owner: W, mint, uiTokenAmount: { uiAmount: 1000 + tok } }] } });

test('parses wallet swaps from SOL and token balance changes', () => {
  assert.deepEqual(parseSwap(swapTx({ sol: -1, tok: 500 }), W), { sig: 'sig11', slot: 1, t: 1000, mint: GOOD, side: 'buy', amount: 500, sol: 1 });
  assert.equal(parseSwap(swapTx({ sol: 2, tok: -500 }), W).side, 'sell');
  assert.equal(parseSwap(swapTx({ sol: 0, tok: 500 }), W), null);
  assert.equal(parseSwap({ meta: { err: {} } }, W), null);
});

test('wallet reliability needs enough closed trades, then rewards winners', () => {
  const round = (i, win) => [{ t: i * 10, mint: `m${i}`, side: 'buy', amount: 100, sol: 1, slot: i }, { t: i * 10 + 5, mint: `m${i}`, side: 'sell', amount: 100, sol: win ? 2 : 0.5, slot: i }];
  assert.equal(walletStats(Array.from({ length: MIN_TRADES - 1 }, (_, i) => round(i, true)).flat()).reliability, null);
  const good = walletStats(Array.from({ length: 12 }, (_, i) => round(i, i % 4 !== 0)).flat());
  const bad = walletStats(Array.from({ length: 12 }, (_, i) => round(i, i % 4 === 0)).flat());
  assert.equal(good.closed, 12); assert.equal(good.winRate, 0.75); assert.ok(good.reliability > bad.reliability);
  assert.equal(good.realizedSol, 9 * 1 - 3 * 0.5);
});

test('flows, linked wallets and the smart-money signal', () => {
  const tr = [{ t: 10, mint: GOOD, side: 'buy', sol: 1, slot: 5 }, { t: 20, mint: GOOD, side: 'buy', sol: 1, slot: 9 }, { t: 30, mint: BAD, side: 'sell', sol: 1, slot: 9 }];
  const f = flows(tr, 0);
  assert.equal(f.find(x => x.mint === GOOD).state, 'accumulating'); assert.equal(f.find(x => x.mint === BAD).state, 'distributing');
  const other = [{ mint: GOOD, side: 'buy', slot: 6 }, { mint: BAD, side: 'buy', slot: 100 }], a = [{ mint: GOOD, side: 'buy', slot: 5 }, { mint: BAD, side: 'buy', slot: 101 }];
  assert.deepEqual(linkedWallets({ a, b: other }), [{ wallets: ['a', 'b'], sharedEarlyBuys: 2 }]);
  assert.equal(smartSignal(GOOD, {}, 0), null);
  const s = smartSignal(GOOD, { w: { address: 'w', label: 'w', trades: tr, stats: { reliability: 80 } } }, 0);
  assert.equal(s.value, 0.8); assert.equal(s.wallets[0].state, 'accumulating');
});

test('degen score gates on security and drops missing components instead of zeroing them', () => {
  const f = features(parseGeckoPools(GT_BODY)[0], [], NOW);
  const pass = degenScore(f, { security: { status: 'pass' }, social: { score: null }, smart: null });
  const unv = degenScore(f, { security: { status: 'unverified' } });
  assert.equal(pass.tradable, true); assert.equal(pass.components.social, null); assert.equal(pass.coverage, 0.65);
  assert.equal(unv.tradable, false); assert.equal(unv.grade, 'UNVERIFIED');
  assert.equal(degenScore(f, { security: { status: 'fail' } }).grade, 'REJECTED');
  assert.ok(pass.signals.includes('volume accelerating'));
});

test('zones put invalidation below entry and targets above', () => {
  const candles = Array.from({ length: 30 }, (_, i) => ({ t: i, o: 1, h: 1.05, l: 0.95, c: 1 }));
  const z = zones(1, candles);
  assert.ok(z.invalidation < z.entry[0] && z.entry[1] === 1 && z.targets[0] > 1 && z.targets[1] > z.targets[0]);
  assert.equal(z.basis, '5m ATR and swing low');
  assert.match(zones(1, null, { m5: 10 }).basis, /estimate/);
  assert.equal(zones(0), null);
});

test('paper trader takes half at target 1, stops at entry, and exits on a rug flag', () => {
  const book = newBook(1000), z = { invalidation: 0.8, targets: [1.3, 1.6] };
  openTrade(book, { mint: 'a', sym: 'A', price: 1, liq: 1e6, zones: z }, { sizeUsd: 100, now: 0 });
  openTrade(book, { mint: 'b', sym: 'B', price: 1, liq: 1e6, zones: z }, { sizeUsd: 100, now: 0 });
  assert.equal(book.cash, 800);
  manage(book, { a: { price: 1.35, liq: 1e6 }, b: { price: 1, liq: 1e6, security: 'fail' } }, 1);
  assert.equal(book.pos.a.half, true); assert.ok(book.pos.a.stop >= book.pos.a.entry); assert.equal(book.pos.b, undefined);
  manage(book, { a: { price: 1, liq: 1e6 } }, 2);
  assert.equal(book.pos.a, undefined);
  const st = bookStats(book);
  assert.equal(st.trades, 2); assert.equal(st.closed[0].why, 'stop at entry after target 1');
});

test('backtest replays recorded snapshots through a preset and the exit rules', () => {
  const preset = { rules: [['m5', '>', 5]] };
  const mk = (t, price, m5, sec = 1) => { const r = toRow(t, { price, liq: 1e6, m5 }); r[r.length - 1] = sec; return r; };
  const rows = [mk(0, 1, 0), mk(1, 1, 10), mk(2, 1.1, 2), mk(3, 2, 2), mk(4, 2, 10, 0)];
  const r = backtest(new Map([['a', rows]]), preset);
  assert.equal(r.trades, 1); assert.ok(r.avgRetPct > 0); assert.equal(r.recent[0].why, 'target 2');
});

test('validates preset edits', () => {
  assert.throws(() => validatePresets({ 'bad name!': { rules: [] } }));
  assert.throws(() => validatePresets({ x: { rules: [['liq', '~', 1]] } }));
  assert.deepEqual(validatePresets({ x: { rules: [['liq', '>=', '5000']] } }).x.rules, [['liq', '>=', 5000]]);
});

// End to end: one scan against fake free APIs.
function fakeApis({ redditDown = false } = {}) {
  const rpcMint = { value: { owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', data: { parsed: { info: { mintAuthority: null, freezeAuthority: null, decimals: 6, supply: '1000000000000000', extensions: [] } } } } };
  const badMint = structuredClone(rpcMint); badMint.value.data.parsed.info.mintAuthority = 'DevDevDevDevDevDevDevDevDevDevDevDevDevDev';
  return async (url, init = {}) => {
    const ok = body => ({ ok: true, status: 200, json: async () => body });
    if (url.includes('geckoterminal') && url.includes('new_pools')) return ok(GT_BODY);
    if (url.includes('geckoterminal') && url.includes('trending_pools')) return ok({ data: [] });
    if (url.includes('geckoterminal') && url.includes('/info')) return ok({ data: { attributes: { holders: { count: 500 }, developer_holding_percentage: '1.0' } } });
    if (url.includes('geckoterminal') && url.includes('ohlcv')) return ok({ data: { attributes: { ohlcv_list: Array.from({ length: 40 }, (_, i) => [i, 0.001, 0.00105, 0.00095, 0.001, 100]) } } });
    if (url.includes('dexscreener.com/tokens')) return ok([]);
    if (url.includes('dexscreener')) return ok([]);
    if (url.includes('reddit')) return redditDown ? { ok: false, status: 403 } : ok({ data: { children: [{ data: { id: '1', subreddit: 'solana', author: 'a', title: 'Is $GOOD legit? Looks bullish', selftext: '', score: 30, num_comments: 12, created_utc: NOW / 1000 - 60 } }] } });
    if (url.includes('4cdn')) return { ok: false, status: 503 };
    if (url.includes('rugcheck')) return { ok: false, status: 404 };
    if (init.method === 'POST') {
      const { method, params } = JSON.parse(init.body);
      if (method === 'getAccountInfo') return ok({ result: params[0] === BAD ? badMint : rpcMint });
      if (method === 'getTokenLargestAccounts') return ok({ result: { value: [{ address: 'acc1', uiAmount: 6e8 }, { address: 'acc2', uiAmount: 2e7 }, { address: 'acc3', uiAmount: 1e7 }] } });
      if (method === 'getMultipleAccounts') return ok({ result: { value: ['curve', 'w1', 'w2'].map(o => ({ data: { parsed: { info: { owner: o } } } })) } });
    }
    return { ok: false, status: 404 };
  };
}

test('one scan discovers, gates, scores, alerts and paper-trades only the token that passes', async () => {
  const cfg = { ...degenConfig({ DEGEN_ALERT_SCORE: '40' }), rugcheck: true };
  const d = createDegen({ config: cfg, fetchImpl: fakeApis(), now: () => NOW, isOnCurve: a => a !== 'curve', sleep: async () => {} });
  const c = await d.cycle();
  assert.equal(c.tokens, 2);
  const v = d.view();
  assert.deepEqual(v.opportunities.map(r => r.sym), ['GOOD']);
  assert.equal(v.rejected[0].sym, 'BAD'); assert.deepEqual(v.rejected[0].security.fails, ['Mint authority']);
  const good = d.token(GOOD);
  assert.equal(good.security.status, 'pass'); assert.ok(good.social.score > 0); assert.equal(good.zones.basis, '5m ATR and swing low');
  assert.equal(v.social.channels['/biz/'].ok, false); assert.equal(v.social.channels.X.ok, false);
  assert.equal(v.alerts[0].sym, 'GOOD'); assert.equal(v.paper.open[0].sym, 'GOOD');
  assert.ok(v.paper.open[0].stop < v.paper.open[0].entry);
  // A second scan in the same minute does not re-alert or double up.
  await d.cycle();
  assert.equal(d.view().alerts.length, 1); assert.equal(d.view().paper.open.length, 1);
  const saved = JSON.parse(JSON.stringify(d.toJSON()));
  const d2 = createDegen({ config: cfg, fetchImpl: fakeApis(), now: () => NOW, isOnCurve: a => a !== 'curve', saved });
  assert.equal(d2.view().paper.open.length, 1); assert.ok(d2.history.get(GOOD).length >= 1);
});

test('when every social source is down, sentiment is unavailable rather than zero', async () => {
  const d = createDegen({ config: degenConfig({}), fetchImpl: fakeApis({ redditDown: true }), now: () => NOW, isOnCurve: a => a !== 'curve', sleep: async () => {} });
  const c = await d.cycle();
  assert.ok(c.errors.some(e => /social/.test(e)));
  const t = d.token(GOOD);
  assert.equal(t.social.status, 'unavailable'); assert.equal(t.components.social, null);
});

test('degen config reads tracked wallets and defaults to the mainnet RPC on a devnet bot', () => {
  const c = degenConfig({ DEGEN_WALLETS: `${W}:whale, junk` }, { cluster: 'devnet', rpcUrl: 'https://api.devnet.solana.com' });
  assert.deepEqual(c.wallets, [{ address: W, label: 'whale' }]);
  assert.equal(c.rpcUrl, 'https://api.mainnet-beta.solana.com');
  assert.equal(degenConfig({ DEGEN: 'off' }).enabled, false);
});

test('a chart falls back to the last candles when GeckoTerminal is rate limited', async () => {
  let t = 0, calls = 0;
  const body = { data: { attributes: { ohlcv_list: [[60, 1, 2, 0.5, 1.5, 10], [0, 1, 1, 1, 1, 5]] } } };
  const fetchImpl = async () => { calls++; return calls === 1 ? { ok: true, status: 200, json: async () => body } : { ok: false, status: 429, json: async () => ({}) }; };
  const net = createNet({ fetchImpl, now: () => t, sleep: async () => {} });
  const sources = createSources({ net });
  const first = await sources.candles('POOL', 5, 0);
  assert.deepEqual(first.map(k => k.t), [0, 60]);
  t = 10 * 60000; // the cache has expired and the next call is refused
  assert.deepEqual(await sources.candles('POOL', 5, 0), first);
  assert.equal(calls, 2);
});

test('smart flow summarises both directions for the desk agents', () => {
  const w = (trades, rel = 60) => ({ address: 'x', label: 'x', trades, stats: { reliability: rel } });
  assert.equal(smartFlow(GOOD, {}, 0), null);
  const wallets = { a: w([{ t: 10, mint: GOOD, side: 'buy', sol: 2 }]), b: w([{ t: 10, mint: GOOD, side: 'sell', sol: 1 }]), c: w([{ t: 10, mint: GOOD, side: 'sell', sol: 1 }]) };
  const f = smartFlow(GOOD, wallets, 0);
  assert.deepEqual({ buyers: f.buyers, sellers: f.sellers, netSol: f.netSol, state: f.state }, { buyers: 1, sellers: 2, netSol: 0, state: 'distributing' });
  assert.equal(smartFlow(BAD, wallets, 0).state, 'quiet');
});
