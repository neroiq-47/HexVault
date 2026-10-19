// AI Degen Score: blends on-chain momentum, liquidity quality, price action, smart money and social
// momentum into 0-100. Security is a gate on top: only a full pass can be tradable.
import { ATR } from 'trading-signals';

export const WEIGHTS = { momentum: 0.3, liquidity: 0.15, price: 0.2, wallets: 0.2, social: 0.15 };
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const logScale = (x, full) => x > 0 ? clamp(Math.log10(1 + x) / Math.log10(1 + full)) : 0;

export function components(f, { social = null, smart = null } = {}) {
  const c = {};
  const parts = [];
  if (f.volAccel != null) parts.push(clamp((Math.log2(f.volAccel) + 1) / 3));
  if (f.buyRatio5m != null) parts.push(clamp((f.buyRatio5m - 0.7) / 1.3));
  if (f.buyers5m != null) parts.push(logScale(f.buyers5m, 150));
  if (f.holderGrowth1h != null) parts.push(clamp(f.holderGrowth1h / 40));
  c.momentum = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;

  if (f.liq != null) {
    const depth = logScale(f.liq, 500000);
    const ratio = f.liqToMcap == null ? 0.5 : f.liqToMcap < 0.03 ? 0.1 : f.liqToMcap > 0.6 ? 0.4 : clamp(f.liqToMcap / 0.2);
    c.liquidity = 0.6 * depth + 0.4 * ratio;
  } else c.liquidity = null;

  if (f.m5 != null || f.h1 != null) {
    const h1 = f.h1 ?? 0, m5 = f.m5 ?? 0;
    // Rewards steady climbs and punishes parabolic candles you would be chasing.
    let p = clamp(0.5 + h1 / 100) * 0.5 + clamp(0.5 + m5 / 40) * 0.3 + (f.breakout ? 0.2 : 0);
    if (m5 > 60 || h1 > 400) p *= 0.6;
    if (h1 < -30) p *= 0.5;
    c.price = clamp(p);
  } else c.price = null;

  c.wallets = smart == null ? null : smart.value;
  c.social = social?.score == null ? null : social.score / 100;
  return c;
}

export function degenScore(f, { security, social, smart } = {}) {
  const c = components(f, { social, smart });
  let sum = 0, w = 0;
  for (const [k, wt] of Object.entries(WEIGHTS)) if (c[k] != null) { sum += c[k] * wt; w += wt; }
  const coverage = +w.toFixed(2);
  // Missing components drop out of the average, and lower coverage shaves the score so thin data can't rank first.
  const score = w ? Math.round(100 * (sum / w) * (0.75 + 0.25 * coverage)) : 0;
  const signals = [];
  if ((f.volAccel ?? 0) >= 2) signals.push('volume accelerating');
  if ((f.buyRatio5m ?? 0) >= 1.5) signals.push('buyers outnumber sellers');
  if (f.breakout) signals.push('breakout');
  if ((smart?.value ?? 0) >= 0.3) signals.push('smart money buying');
  if ((social?.score ?? 0) >= 60) signals.push('social spike');
  if ((f.holderGrowth1h ?? 0) >= 15) signals.push('holders growing');
  const status = security?.status || 'unverified';
  const tradable = status === 'pass';
  const grade = !tradable ? (status === 'fail' ? 'REJECTED' : 'UNVERIFIED') : score >= 80 ? 'A+' : score >= 65 ? 'STRONG' : score >= 50 ? 'WATCH' : 'WEAK';
  return { score, grade, tradable, coverage, components: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v == null ? null : Math.round(v * 100)])), signals };
}

// Potential entry, invalidation and exit zones from 5m ATR and the recent swing low.
// Without candles it falls back to a volatility estimate from the 5m and 1h moves and says so.
export function zones(price, candles = null, f = {}) {
  if (!(price > 0)) return null;
  let atr = null, swingLow = null, basis = 'estimate from 5m/1h moves';
  if (candles?.length >= 16) {
    const a = new ATR(14);
    for (const k of candles) a.add({ high: k.h, low: k.l, close: k.c });
    try { atr = Number(a.getResult()); } catch { atr = null; }
    swingLow = Math.min(...candles.slice(-12).map(k => k.l)); basis = '5m ATR and swing low';
  }
  if (!(atr > 0)) atr = price * clamp(Math.max(Math.abs(f.m5 || 0), Math.abs(f.h1 || 0) / 3.5, 4) / 100, 0.02, 0.25);
  const entryLow = price - 0.5 * atr, entryMid = (price + entryLow) / 2;
  let stop = Math.min(price - 2 * atr, swingLow ?? Infinity);
  stop = Math.max(stop, price * 0.6);
  const r = entryMid - stop;
  const sig = x => +x.toPrecision(4);
  return { basis, atrPct: +(atr / price * 100).toFixed(1), entry: [sig(entryLow), sig(price)], invalidation: sig(stop),
    targets: [sig(entryMid + 1.5 * r), sig(entryMid + 3 * r)], riskPct: +(r / entryMid * 100).toFixed(1) };
}
