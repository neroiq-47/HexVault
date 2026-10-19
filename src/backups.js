// Backup data providers, used when a primary free API is down, blocked or out of budget.
// CoinGecko's onchain API serves the same paths and JSON as GeckoTerminal, so it is a drop-in mirror with a key.
// Jupiter's Price API covers the desk's prices when DexScreener fails.
export const PUBLIC_RPC_BACKUPS = Object.freeze(['https://solana-rpc.publicnode.com']);

export function coingeckoConfig(env = process.env) {
  const key = (env.COINGECKO_API_KEY || '').trim();
  if (!key) return null;
  const pro = (env.COINGECKO_PLAN || 'demo').trim() === 'pro';
  return { key, base: `https://${pro ? 'pro-api' : 'api'}.coingecko.com/api/v3/onchain/networks/solana`, header: pro ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key' };
}

// Same request on the CoinGecko mirror: GeckoTerminal paths start after /networks/solana.
export function coingeckoUrl(gtUrl, cg) {
  const i = gtUrl.indexOf('/networks/solana');
  if (i < 0) throw new Error('not a GeckoTerminal Solana URL');
  return cg.base + gtUrl.slice(i + '/networks/solana'.length);
}

// Backup RPCs in the order given ("off" disables them), then the public ones; the primary is never repeated.
export function rpcBackups(list, primary, defaults = PUBLIC_RPC_BACKUPS) {
  const raw = (list || '').trim();
  if (raw === 'off') return [];
  const urls = raw ? raw.split(',').map(s => s.trim()).filter(s => /^https?:\/\//.test(s)) : [...defaults];
  return [...new Set(urls)].filter(u => u !== primary);
}

// Jupiter Price API v3: { mint: { usdPrice, liquidity, priceChange24h } }. The keyless lite host needs no account.
export async function jupiterPrices(mints, { fetchImpl = fetch, key = '' } = {}) {
  const url = `https://${key ? 'api' : 'lite-api'}.jup.ag/price/v3?ids=${mints.slice(0, 50).join(',')}`;
  const res = await fetchImpl(url, { headers: { accept: 'application/json', ...(key ? { 'x-api-key': key } : {}) }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Jupiter Price HTTP ${res.status}`);
  const body = await res.json();
  if (!body || typeof body !== 'object') throw new Error('Jupiter Price returned an unexpected shape');
  const out = {};
  for (const m of mints) {
    const p = body[m], price = Number(p?.usdPrice);
    if (price > 0) out[m] = { price, liq: Number(p.liquidity) || 0, h24: Number(p.priceChange24h) || 0 };
  }
  return out;
}
