// Paper portfolio. Fills at the market price plus COST in the trade's direction, so results are not flattered.
export const COST = 0.003;
export const RESERVE_SOL = 0.02;
export const MIN_SWEEP_USD = 0.5;

export const priceOf = (market, sym) => market.tokens.find(t => t.sym === sym)?.price || 0;

export function newBook(startUsd, solPrice) {
  return { startUsd, cash: startUsd, pos: {}, trades: [], sweeps: [], history: [], rounds: 0,
    startSol: solPrice ? startUsd / solPrice : 0, halted: false, day: '', dayStartEquity: startUsd };
}

export function equity(book, market) {
  let v = book.cash;
  for (const [sym, p] of Object.entries(book.pos)) v += p.qty * priceOf(market, sym);
  return v;
}

export function buy(book, market, sym, usd, now = Date.now()) {
  const px = priceOf(market, sym) * (1 + COST);
  if (!(px > 0) || !(usd > 0) || usd > book.cash + 1e-9) return null;
  book.cash -= usd;
  const p = book.pos[sym] || { qty: 0, cost: 0 };
  p.qty += usd / px; p.cost += usd; book.pos[sym] = p;
  const fill = { ts: now, side: 'buy', sym, usd, price: px, realised: null };
  book.trades.push(fill); return fill;
}

export function sell(book, market, sym, frac = 1, now = Date.now()) {
  const p = book.pos[sym]; if (!p) return null;
  frac = Math.min(1, Math.max(0, frac));
  const mid = priceOf(market, sym), px = mid * (1 - COST);
  const qty = p.qty * frac, usd = qty * px, cost = p.cost * frac;
  book.cash += usd; p.qty -= qty; p.cost -= cost;
  if (p.qty * mid < 0.01) delete book.pos[sym];
  const fill = { ts: now, side: 'sell', sym, usd, price: px, realised: usd - cost };
  book.trades.push(fill); return fill;
}

export function closeAll(book, market, now = Date.now()) {
  return Object.keys(book.pos).map(sym => sell(book, market, sym, 1, now)).filter(Boolean);
}

// Only cash above the starting float plus a fee reserve can leave. Open positions are never sold to fund a sweep.
export function sweepableUsd(book, market) {
  const reserveUsd = RESERVE_SOL * priceOf(market, 'SOL');
  return Math.max(0, Math.min(book.cash, equity(book, market) - book.startUsd - reserveUsd));
}

export function rollDay(book, market, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  if (book.day !== day) { book.day = day; book.dayStartEquity = equity(book, market); }
}
