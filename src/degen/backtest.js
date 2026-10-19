// Backtests a scanner preset on the snapshots this scanner has recorded itself. It enters the first time
// a token matches the preset with a passing security status, then plays the paper trader's exit rules forward.
import { features, matchPreset, tokenFromRow, H } from './scanner.js';
import { zones } from './score.js';
import { cost } from './paper.js';

export function backtest(series, preset, { sizeUsd = 100, maxHoldMs = 6 * 3600000, requireSecurity = true } = {}) {
  const trades = [];
  for (const [mint, rows] of series) {
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (requireSecurity && r[H.sec] !== 1) continue;
      const f = features(tokenFromRow(r), rows.slice(0, i), r[H.t]);
      if (!matchPreset(f, preset).pass) continue;
      const z = zones(f.price, null, f);
      if (!z) continue;
      const liq = f.liq || 0, entry = f.price * (1 + cost(sizeUsd, liq));
      let qty = sizeUsd / entry, stop = z.invalidation, half = false, proceeds = 0, exit = null;
      for (let j = i + 1; j < rows.length && !exit; j++) {
        const px = rows[j][H.price], lq = rows[j][H.liq] || liq, t = rows[j][H.t];
        if (!px) continue;
        const sell = (frac, why) => { const q = qty * frac, g = q * px; proceeds += g * (1 - cost(g, lq)); qty -= q; if (frac >= 0.999) exit = { why, t, j }; };
        if (rows[j][H.sec] === -1) sell(1, 'security fail');
        else if (px <= stop) sell(1, half ? 'stop at entry' : 'invalidation');
        else if (px >= z.targets[1]) sell(1, 'target 2');
        else if (!half && px >= z.targets[0]) { sell(0.5, 'target 1'); half = true; stop = Math.max(stop, entry); }
        else if (t - r[H.t] > maxHoldMs) sell(1, 'time stop');
      }
      // Still open at the end of the data: mark to the last price.
      if (!exit) { const last = rows.at(-1); proceeds += qty * (last[H.price] || 0) * (1 - cost(qty * (last[H.price] || 0), last[H.liq])); exit = { why: 'open at end of data', t: last[H.t], j: rows.length - 1 }; }
      trades.push({ mint, at: r[H.t], ret: +((proceeds / sizeUsd - 1) * 100).toFixed(1), why: exit.why, holdMin: Math.round((exit.t - r[H.t]) / 60000) });
      i = exit.j;
    }
  }
  const n = trades.length, rets = trades.map(t => t.ret);
  let eq = 0, peak = 0, dd = 0;
  for (const t of [...trades].sort((a, b) => a.at - b.at)) { eq += t.ret; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  let from = Infinity, to = -Infinity;
  for (const rows of series.values()) if (rows.length) { from = Math.min(from, rows[0][H.t]); to = Math.max(to, rows.at(-1)[H.t]); }
  return { trades: n, winRate: n ? +(rets.filter(x => x > 0).length / n).toFixed(2) : null, avgRetPct: n ? +(rets.reduce((a, b) => a + b, 0) / n).toFixed(1) : null,
    bestPct: n ? Math.max(...rets) : null, worstPct: n ? Math.min(...rets) : null, maxDrawdownPct: +dd.toFixed(1), tokens: series.size,
    from: Number.isFinite(from) ? from : null, to: Number.isFinite(to) ? to : null,
    recent: trades.sort((a, b) => b.at - a.at).slice(0, 25) };
}
