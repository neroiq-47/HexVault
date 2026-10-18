// Shadow and live execution. Shadow gets real Jupiter quotes and fills the paper book at the quoted amounts without sending.
// Live signs Jupiter's transaction with the agent wallet, sends it, and books the fill only once it is confirmed.
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { MINTS, DECIMALS, SOL_MINT } from './jupiter.js';
import { priceOf } from './paper.js';

export async function tokenBalanceRaw(connection, owner, mint) {
  const { value } = await connection.getParsedTokenAccountsByOwner(new PublicKey(owner), { mint: new PublicKey(mint) });
  return value.reduce((a, acc) => a + BigInt(acc.account.data.parsed.info.tokenAmount.amount), 0n);
}

// Agent wallet value in SOL: native SOL plus every watchlist token at the current price.
export async function walletValueSol(connection, owner, market) {
  const solPx = priceOf(market, 'SOL');
  const sol = (await connection.getBalance(new PublicKey(owner))) / LAMPORTS_PER_SOL;
  let tokensSol = 0;
  for (const [sym, mint] of Object.entries(MINTS)) {
    if (sym === 'SOL') continue;
    const raw = await tokenBalanceRaw(connection, owner, mint);
    if (raw > 0n) tokensSol += Number(raw) / 10 ** DECIMALS[sym] * priceOf(market, sym) / solPx;
  }
  return { sol, tokensSol, total: sol + tokensSol };
}

async function sendSigned({ connection, keypair, tx }) {
  tx.sign([keypair]);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const signature = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  const res = await connection.confirmTransaction({ signature, blockhash: tx.message.recentBlockhash || blockhash, lastValidBlockHeight }, 'confirmed');
  if (res.value?.err) throw new Error(`swap failed on chain: ${JSON.stringify(res.value.err)}`);
  return signature;
}

export function createExecutor({ mode, jupiter, connection, keypair, log = () => {}, send = sendSigned }) {
  const owner = keypair.publicKey.toBase58();
  return async function execute({ book, market, approved, now = Date.now() }) {
    const fills = [];
    const solPx = priceOf(market, 'SOL');
    for (const a of approved) {
      const sym = a.token;
      if (sym === 'SOL' || !MINTS[sym]) continue; // the float is SOL, so SOL itself is never traded
      try {
        if (a.action === 'buy') {
          const lamports = Math.floor(a.usd / solPx * LAMPORTS_PER_SOL);
          const q = await jupiter.quote({ inputMint: SOL_MINT, outputMint: MINTS[sym], amount: lamports });
          const qty = Number(q.outAmount) / 10 ** DECIMALS[sym];
          let signature = null;
          if (mode === 'live') signature = await send({ connection, keypair, tx: await jupiter.swapTransaction({ quoteResponse: q, userPublicKey: owner }) });
          book.cash -= a.usd;
          const p = book.pos[sym] || { qty: 0, cost: 0 };
          p.qty += qty; p.cost += a.usd; book.pos[sym] = p;
          const fill = { ts: now, side: 'buy', sym, usd: a.usd, price: a.usd / qty, realised: null, mode, signature, impact: Number(q.priceImpactPct) || 0 };
          book.trades.push(fill); fills.push(fill);
        } else {
          const p = book.pos[sym]; if (!p) continue;
          let raw = BigInt(Math.floor(p.qty * a.frac * 10 ** DECIMALS[sym]));
          if (mode === 'live') { const held = await tokenBalanceRaw(connection, owner, MINTS[sym]); if (held < raw) raw = held; }
          if (raw <= 0n) continue;
          const q = await jupiter.quote({ inputMint: MINTS[sym], outputMint: SOL_MINT, amount: Number(raw) });
          let signature = null;
          if (mode === 'live') signature = await send({ connection, keypair, tx: await jupiter.swapTransaction({ quoteResponse: q, userPublicKey: owner }) });
          const usd = Number(q.outAmount) / LAMPORTS_PER_SOL * solPx;
          const qty = Number(raw) / 10 ** DECIMALS[sym], frac = Math.min(1, qty / p.qty), cost = p.cost * frac;
          book.cash += usd; p.qty -= qty; p.cost -= cost;
          if (p.qty * priceOf(market, sym) < 0.01) delete book.pos[sym];
          const fill = { ts: now, side: 'sell', sym, usd, price: usd / qty, realised: usd - cost, mode, signature, impact: Number(q.priceImpactPct) || 0 };
          book.trades.push(fill); fills.push(fill);
        }
      } catch (e) {
        log('warn', 'trade skipped', { mode, action: a.action, token: sym, reason: String(e.message || e) });
      }
    }
    return fills;
  };
}
