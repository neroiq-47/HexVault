// Hard limits. These run in code after the Risk agent, so no agent output can bypass them.
import { equity, priceOf } from './paper.js';

export const MIN_LIQUIDITY_USD = 100_000;
export const LIMITS = Object.freeze({
  low: { cap: 0.05, maxPos: 2, dayStop: 0.03 },
  med: { cap: 0.10, maxPos: 3, dayStop: 0.05 },
  high: { cap: 0.15, maxPos: 4, dayStop: 0.08 },
});

export function applyLimits({ proposals, decisions = [], book, market, level }) {
  const lim = LIMITS[level];
  const eq = equity(book, market);
  const dayLoss = book.dayStartEquity > 0 ? (book.dayStartEquity - eq) / book.dayStartEquity : 0;
  const approved = [], notes = [];
  let cash = book.cash, open = Object.keys(book.pos).length;
  for (const p of proposals) {
    if (p.action !== 'buy' && p.action !== 'sell') continue;
    const tok = market.tokens.find(t => t.sym === p.token);
    if (!tok) { notes.push(`${p.token} skipped: not on the watchlist`); continue; }
    let size = Math.max(0, Number(p.sizePct) || 0);
    const d = decisions.find(x => x.token === p.token);
    if (d?.verdict === 'reject') { notes.push(`${p.token} rejected: ${d.reason || 'risk review'}`); continue; }
    if (d?.verdict === 'shrink') size = Math.min(size, Number(d.sizePct) || size / 2);
    if (p.action === 'sell') {
      if (!book.pos[p.token]) { notes.push(`${p.token} sell skipped: not held`); continue; }
      approved.push({ action: 'sell', token: p.token, frac: Math.min(1, (size || 100) / 100) });
      notes.push(`${p.token} sell approved`); continue;
    }
    if (book.halted) { notes.push(`${p.token} blocked: trading halted`); continue; }
    if (dayLoss >= lim.dayStop) { notes.push(`${p.token} blocked: daily loss stop`); continue; }
    if (tok.liq < MIN_LIQUIDITY_USD) { notes.push(`${p.token} blocked: liquidity under $100k`); continue; }
    if (book.pos[p.token]) { notes.push(`${p.token} skipped: already held`); continue; }
    if (open >= lim.maxPos) { notes.push(`${p.token} blocked: position limit`); continue; }
    size = Math.min(size, lim.cap * 100);
    const usd = Math.min(eq * size / 100, cash);
    if (usd < 1 || !(priceOf(market, p.token) > 0)) { notes.push(`${p.token} skipped: size too small`); continue; }
    cash -= usd; open++;
    approved.push({ action: 'buy', token: p.token, usd });
    notes.push(`${p.token} buy approved at ${size.toFixed(1)}%`);
  }
  return { approved, notes };
}
