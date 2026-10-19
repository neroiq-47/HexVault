// Live prices from DexScreener (mainnet market data, read only, no key), with Jupiter's Price API as the backup.
import { jupiterPrices } from './backups.js';

export const WATCHLIST = Object.freeze({
  So11111111111111111111111111111111111111112: 'SOL',
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: 'JUP',
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: 'BONK',
  EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm: 'WIF',
  jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL: 'JTO',
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R': 'RAY',
});
const URL = 'https://api.dexscreener.com/tokens/v1/solana/' + Object.keys(WATCHLIST).join(',');

// Keeps the deepest pool per token so thin pools can't set the price.
export function parsePairs(pairs) {
  if (!Array.isArray(pairs)) throw new Error('DexScreener returned an unexpected shape');
  const best = {};
  for (const p of pairs) {
    const mint = p?.baseToken?.address;
    if (!WATCHLIST[mint]) continue;
    const liq = p.liquidity?.usd || 0;
    const price = Number(p.priceUsd);
    if (!(price > 0)) continue;
    if (best[mint] && best[mint].liq >= liq) continue;
    best[mint] = {
      mint, sym: WATCHLIST[mint], pool: p.pairAddress, price, liq,
      m5: p.priceChange?.m5 || 0, h1: p.priceChange?.h1 || 0, h6: p.priceChange?.h6 || 0, h24: p.priceChange?.h24 || 0,
      vol: p.volume?.h24 || 0, b1: p.txns?.h1?.buys || 0, s1: p.txns?.h1?.sells || 0,
    };
  }
  const tokens = Object.keys(WATCHLIST).map(m => best[m]).filter(Boolean);
  if (!tokens.length) throw new Error('No watchlist tokens in DexScreener response');
  return tokens;
}

export async function fetchMarket(fetchImpl = fetch) {
  const res = await fetchImpl(URL, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`DexScreener HTTP ${res.status}`);
  return { at: Date.now(), tokens: parsePairs(await res.json()) };
}

// Jupiter has price, liquidity and the 24h change but no pools or short-term changes, so the last
// DexScreener pools are carried over (indicators keep working) and the missing changes read as flat.
export function fromJupiter(prices, last = null) {
  const prev = Object.fromEntries((last?.tokens || []).map(t => [t.mint, t]));
  const tokens = Object.keys(WATCHLIST).filter(m => prices[m]).map(m => ({
    mint: m, sym: WATCHLIST[m], pool: prev[m]?.pool || null, price: prices[m].price, liq: prices[m].liq || prev[m]?.liq || 0,
    m5: 0, h1: 0, h6: 0, h24: prices[m].h24, vol: prev[m]?.vol || 0, b1: 0, s1: 0,
  }));
  if (!tokens.length) throw new Error('No watchlist tokens in Jupiter response');
  return tokens;
}

// The desk's market feed: DexScreener, then Jupiter. source says which one answered.
export function createMarketFeed({ fetchImpl = fetch, jupiterKey = '', log = () => {} } = {}) {
  let last = null;
  return async function market() {
    try { last = { ...await fetchMarket(fetchImpl), source: 'dexscreener' }; }
    catch (e) {
      try { last = { at: Date.now(), tokens: fromJupiter(await jupiterPrices(Object.keys(WATCHLIST), { fetchImpl, key: jupiterKey }), last), source: 'jupiter' }; }
      catch (e2) { throw new Error(`${e.message}; backup ${e2.message}`); }
      log('warn', 'market data from Jupiter backup', { message: String(e.message || e) });
    }
    return last;
  };
}
