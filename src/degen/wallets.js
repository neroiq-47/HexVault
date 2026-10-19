// Smart-money tracker: reads selected wallets' swaps from public RPC transactions, scores them on
// realized results, and spots accumulation, distribution and wallets that move together.
const WSOL = 'So11111111111111111111111111111111111111112';
const STABLES = new Set(['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB']);
export const MIN_TRADES = 5, BACKFILL = 300;

const keyOf = k => typeof k === 'string' ? k : k?.pubkey;

// One swap per transaction: a single non-quote token moves one way and SOL (or a stable) moves the other.
// Multi-token or transfer-only transactions are skipped rather than guessed at.
export function parseSwap(tx, wallet, solUsd = null) {
  const meta = tx?.meta;
  if (!meta || meta.err) return null;
  const keys = (tx.transaction?.message?.accountKeys || []).map(keyOf);
  const idx = keys.indexOf(wallet);
  const deltas = {};
  for (const [list, sign] of [[meta.preTokenBalances, -1], [meta.postTokenBalances, 1]]) {
    for (const b of list || []) if (b.owner === wallet) deltas[b.mint] = (deltas[b.mint] || 0) + sign * Number(b.uiTokenAmount?.uiAmount ?? b.uiTokenAmount?.uiAmountString ?? 0);
  }
  let sol = idx >= 0 ? (meta.postBalances[idx] - meta.preBalances[idx]) / 1e9 : 0;
  if (idx === 0) sol += (meta.fee || 0) / 1e9;
  sol += deltas[WSOL] || 0; delete deltas[WSOL];
  for (const s of STABLES) if (deltas[s]) { if (solUsd) sol += deltas[s] / solUsd; delete deltas[s]; }
  const moved = Object.entries(deltas).filter(([, d]) => Math.abs(d) > 1e-9);
  if (moved.length !== 1) return null;
  const [mint, amt] = moved[0];
  if (Math.abs(sol) < 1e-4 || Math.sign(sol) === Math.sign(amt)) return null;
  return { sig: tx.transaction?.signatures?.[0] || null, slot: tx.slot, t: (tx.blockTime || 0) * 1000, mint, side: amt > 0 ? 'buy' : 'sell', amount: Math.abs(amt), sol: Math.abs(sol) };
}

// Average-cost realized P&L per token, in SOL. A position counts as closed once 90% of what was bought is sold.
export function walletStats(trades) {
  const pos = {}, closed = [];
  for (const t of [...trades].sort((a, b) => a.t - b.t)) {
    const p = (pos[t.mint] ||= { qty: 0, cost: 0, bought: 0, sold: 0, pnl: 0, opened: t.t });
    if (t.side === 'buy') { p.qty += t.amount; p.cost += t.sol; p.bought += t.amount; }
    else if (p.qty > 0) {
      const q = Math.min(t.amount, p.qty), basis = p.cost * q / p.qty;
      p.pnl += t.sol * (q / t.amount) - basis; p.cost -= basis; p.qty -= q; p.sold += q;
      if (p.sold >= p.bought * 0.9 && !p.done) { p.done = true; closed.push({ mint: t.mint, pnl: p.pnl, holdMs: t.t - p.opened }); }
    }
  }
  const n = closed.length, wins = closed.filter(c => c.pnl > 0).length;
  const gain = closed.filter(c => c.pnl > 0).reduce((a, c) => a + c.pnl, 0), loss = -closed.filter(c => c.pnl < 0).reduce((a, c) => a + c.pnl, 0);
  const realized = Object.values(pos).reduce((a, p) => a + p.pnl, 0);
  const pf = loss ? gain / loss : gain ? 3 : 0;
  // Reliability needs a real sample: under MIN_TRADES closed round trips it stays null rather than a guess.
  const reliability = n < MIN_TRADES ? null : Math.round(100 * Math.min(1, n / 20) ** 0.5 * (0.6 * (wins + 1) / (n + 2) + 0.4 * Math.min(pf, 3) / 3));
  return { trades: trades.length, closed: n, wins, winRate: n ? +(wins / n).toFixed(2) : null, realizedSol: +realized.toFixed(3), profitFactor: n ? +Math.min(pf, 99).toFixed(2) : null,
    avgHoldMin: n ? Math.round(closed.reduce((a, c) => a + c.holdMs, 0) / n / 60000) : null, reliability,
    open: Object.entries(pos).filter(([, p]) => p.qty > 0 && !p.done).map(([mint, p]) => ({ mint, qty: p.qty, costSol: +p.cost.toFixed(3) })) };
}

// Net flow per token over a window: accumulation is repeated net buying, distribution is net selling.
export function flows(trades, since) {
  const by = {};
  for (const t of trades) if (t.t >= since) {
    const f = (by[t.mint] ||= { mint: t.mint, buys: 0, sells: 0, netSol: 0 });
    if (t.side === 'buy') { f.buys++; f.netSol += t.sol; } else { f.sells++; f.netSol -= t.sol; }
  }
  return Object.values(by).map(f => ({ ...f, netSol: +f.netSol.toFixed(3), state: f.netSol > 0 && f.buys >= 2 && !f.sells ? 'accumulating' : f.netSol > 0 ? 'buying' : f.sells > f.buys ? 'distributing' : 'mixed' }));
}

// Wallets that bought the same token within a couple of slots, on two or more tokens, are probably one operator.
export function linkedWallets(byWallet, slotGap = 2) {
  const firstBuy = {};
  for (const [w, trades] of Object.entries(byWallet)) for (const t of trades) if (t.side === 'buy') {
    const k = `${w}|${t.mint}`; if (!firstBuy[k] || firstBuy[k].slot > t.slot) firstBuy[k] = { w, mint: t.mint, slot: t.slot };
  }
  const byMint = {};
  for (const b of Object.values(firstBuy)) (byMint[b.mint] ||= []).push(b);
  const pairs = {};
  for (const list of Object.values(byMint)) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    if (Math.abs(list[i].slot - list[j].slot) <= slotGap) { const k = [list[i].w, list[j].w].sort().join('|'); pairs[k] = (pairs[k] || 0) + 1; }
  }
  return Object.entries(pairs).filter(([, c]) => c >= 2).map(([k, c]) => ({ wallets: k.split('|'), sharedEarlyBuys: c }));
}

// Smart-money signal for one token, 0..1, weighted by each wallet's verified reliability. null when no wallets are tracked.
export function smartSignal(mint, wallets, since) {
  const list = Object.values(wallets);
  if (!list.length) return null;
  let s = 0; const who = [];
  for (const w of list) {
    const f = flows(w.trades || [], since).find(x => x.mint === mint);
    if (!f || f.netSol <= 0) continue;
    const rel = w.stats?.reliability ?? 25;
    s += rel / 100 * Math.min(1, f.netSol / 2);
    who.push({ address: w.address, label: w.label, state: f.state, netSol: f.netSol, reliability: w.stats?.reliability ?? null });
  }
  return { value: +Math.min(1, s).toFixed(2), wallets: who };
}

// Pulls new signatures for each wallet and parses up to maxTx transactions per refresh, oldest first.
export async function refreshWallets({ sources, wallets, maxTx = 30, solUsd, now = Date.now(), log = () => {} }) {
  let budget = maxTx;
  for (const w of Object.values(wallets)) {
    try {
      const seen = new Set(w.seen || []);
      let fresh = (await sources.signatures(w.address, 40)).filter(s => !s.err && !seen.has(s.signature)).reverse();
      // Once caught up, walk further back (up to BACKFILL signatures) so reliability has history to work with.
      if (!fresh.length && !w.backfilled && w.oldest) {
        const older = await sources.signatures(w.address, 40, w.oldest);
        if (!older.length || (w.scanned || 0) >= BACKFILL) w.backfilled = true;
        fresh = older.filter(s => !s.err && !seen.has(s.signature));
        if (older.length) w.oldest = older.at(-1).signature;
      }
      for (const s of fresh) {
        if (budget <= 0) break;
        budget--;
        const tx = await sources.transaction(s.signature);
        seen.add(s.signature); w.scanned = (w.scanned || 0) + 1;
        if (!w.oldest || (tx?.blockTime && tx.blockTime * 1000 < (w.oldestAt ?? Infinity))) { w.oldest = s.signature; w.oldestAt = (tx?.blockTime || 0) * 1000; }
        const swap = tx && parseSwap(tx, w.address, solUsd);
        if (swap) w.trades.push(swap);
      }
      w.seen = [...seen].slice(-1000);
      w.trades = w.trades.sort((a, b) => a.t - b.t).slice(-600);
      w.stats = walletStats(w.trades); w.updatedAt = now; w.error = null;
    } catch (e) { w.error = String(e.message || e).slice(0, 160); log('warn', 'wallet refresh failed', { wallet: w.address, error: w.error }); }
  }
}
