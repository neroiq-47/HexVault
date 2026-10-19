// Degen paper trader: opens simulated positions on strong alerts and manages them with the zones
// (stop at invalidation, half off at target 1 with the stop moved to entry, rest at target 2). Never sends a transaction.
export const COSTS = { feePct: 1, maxImpactPct: 10 };
const HOLD_MS = 6 * 3600000;

// Constant-product price impact for a trade of usd into a pool with liq total liquidity, plus a flat 1% for fees and priority tips.
export const cost = (usd, liq) => (COSTS.feePct + Math.min(COSTS.maxImpactPct, liq ? usd / (liq / 2) * 100 : COSTS.maxImpactPct)) / 100;

export const newBook = startUsd => ({ start: startUsd, cash: startUsd, pos: {}, closed: [] });

export function openTrade(book, { mint, sym, price, liq, zones, score, reason }, { sizeUsd, maxPos = 5, now = Date.now() }) {
  if (book.pos[mint] || Object.keys(book.pos).length >= maxPos || !zones || !(price > 0)) return null;
  const usd = Math.min(sizeUsd, book.cash);
  if (usd < 1) return null;
  const fill = price * (1 + cost(usd, liq));
  book.cash -= usd;
  book.pos[mint] = { mint, sym, qty: usd / fill, entry: fill, costUsd: usd, stop: zones.invalidation, targets: zones.targets, half: false, openedAt: now, score, reason, realized: 0 };
  return { side: 'buy', mint, sym, usd, price: fill, at: now, reason };
}

function close(book, p, frac, price, liq, why, now) {
  const qty = p.qty * frac, gross = qty * price, usd = gross * (1 - cost(gross, liq));
  const basis = p.costUsd * frac;
  book.cash += usd; p.qty -= qty; p.costUsd -= basis; p.realized += usd - basis;
  const fill = { side: 'sell', mint: p.mint, sym: p.sym, usd, price, pnl: usd - basis, at: now, reason: why };
  if (frac >= 0.999) {
    delete book.pos[p.mint];
    book.closed.push({ mint: p.mint, sym: p.sym, openedAt: p.openedAt, closedAt: now, pnl: +p.realized.toFixed(2), why, score: p.score });
    if (book.closed.length > 300) book.closed.splice(0, book.closed.length - 300);
  }
  return fill;
}

// quotes: mint -> { price, liq, security } for open positions. A security fail exits at market.
export function manage(book, quotes, now = Date.now()) {
  const fills = [];
  for (const p of Object.values(book.pos)) {
    const q = quotes[p.mint];
    if (!q?.price) { if (now - p.openedAt > HOLD_MS * 2) fills.push(close(book, p, 1, 0, 0, 'no price, written off', now)); continue; }
    if (q.security === 'fail') fills.push(close(book, p, 1, q.price, q.liq, 'rug check failed, exit', now));
    else if (q.price <= p.stop) fills.push(close(book, p, 1, q.price, q.liq, p.half ? 'stop at entry after target 1' : 'invalidation hit', now));
    else if (q.price >= p.targets[1]) fills.push(close(book, p, 1, q.price, q.liq, 'target 2', now));
    else if (!p.half && q.price >= p.targets[0]) { fills.push(close(book, p, 0.5, q.price, q.liq, 'target 1, half off', now)); p.half = true; p.stop = Math.max(p.stop, p.entry); }
    else if (now - p.openedAt > HOLD_MS) fills.push(close(book, p, 1, q.price, q.liq, 'time stop (6h)', now));
  }
  return fills;
}

export function bookStats(book, quotes = {}) {
  const open = Object.values(book.pos).map(p => {
    const px = quotes[p.mint]?.price; const value = px ? p.qty * px : p.costUsd;
    return { mint: p.mint, sym: p.sym, entry: p.entry, price: px ?? null, valueUsd: +value.toFixed(2), pnlPct: +((value / p.costUsd - 1) * 100).toFixed(1), stop: p.stop, targets: p.targets, half: p.half, openedAt: p.openedAt };
  });
  const equity = book.cash + open.reduce((a, p) => a + p.valueUsd, 0);
  const wins = book.closed.filter(c => c.pnl > 0).length;
  return { start: book.start, cash: +book.cash.toFixed(2), equity: +equity.toFixed(2), pnlPct: +((equity / book.start - 1) * 100).toFixed(2), open,
    closed: book.closed.slice(-30).reverse(), trades: book.closed.length, winRate: book.closed.length ? +(wins / book.closed.length).toFixed(2) : null };
}
