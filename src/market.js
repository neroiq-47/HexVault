// Live prices from DexScreener (mainnet market data, read only, no key).
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
      mint, sym: WATCHLIST[mint], price, liq,
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
