// Jupiter swap API: quotes and swap transactions. Only watchlist mints, capped slippage and price impact.
import { VersionedTransaction } from '@solana/web3.js';
import { WATCHLIST } from './market.js';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const MINTS = Object.freeze(Object.fromEntries(Object.entries(WATCHLIST).map(([m, s]) => [s, m])));
export const DECIMALS = Object.freeze({ SOL: 9, JUP: 6, BONK: 5, WIF: 6, JTO: 9, RAY: 6 });
export const SLIPPAGE_BPS = 100;
export const MAX_PRICE_IMPACT = 0.005;
const BASE = 'https://api.jup.ag/swap/v1';

export function createJupiter({ apiKey, fetchImpl = fetch }) {
  const headers = { 'x-api-key': apiKey, accept: 'application/json' };
  async function call(url, init = {}) {
    const res = await fetchImpl(url, { ...init, headers: { ...headers, ...(init.headers || {}) }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`Jupiter HTTP ${res.status}`);
    return res.json();
  }
  async function quote({ inputMint, outputMint, amount }) {
    const known = new Set(Object.keys(WATCHLIST));
    if (!known.has(inputMint) || !known.has(outputMint)) throw new Error('mint not on the watchlist');
    if (!(Number.isSafeInteger(amount) && amount > 0)) throw new Error('quote amount must be a positive integer');
    const q = await call(`${BASE}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${SLIPPAGE_BPS}&restrictIntermediateTokens=true`);
    if (q.inputMint !== inputMint || q.outputMint !== outputMint) throw new Error('Jupiter quote mints do not match the request');
    const impact = Math.abs(Number(q.priceImpactPct) || 0);
    if (impact > MAX_PRICE_IMPACT) throw new Error(`price impact ${(impact * 100).toFixed(2)}% is over the ${MAX_PRICE_IMPACT * 100}% limit`);
    if (!(Number(q.outAmount) > 0)) throw new Error('Jupiter quote has no output');
    return q;
  }
  async function swapTransaction({ quoteResponse, userPublicKey }) {
    const r = await call(`${BASE}/swap`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ quoteResponse, userPublicKey, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, prioritizationFeeLamports: 'auto' }),
    });
    if (!r.swapTransaction) throw new Error('Jupiter returned no transaction');
    return VersionedTransaction.deserialize(Buffer.from(r.swapTransaction, 'base64'));
  }
  return { quote, swapTransaction };
}
