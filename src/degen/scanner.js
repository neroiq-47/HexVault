// Memecoin discovery: merges pair data from both sources, derives features, keeps a short history per
// token (for volume acceleration, liquidity drains and holder growth) and checks the scanner presets.
const MIN = 60000;

// Each criterion is [feature, op, value]. A criterion whose feature is missing fails: no data is never a match.
export const DEFAULT_PRESETS = {
  fresh: { label: 'Fresh launches', note: 'Under an hour old, early buyers piling in.', rules: [
    ['ageMin', '<=', 60], ['liq', '>=', 4000], ['mcap', '>=', 8000], ['mcap', '<=', 1500000],
    ['vol5m', '>=', 2000], ['buyers5m', '>=', 12], ['buyRatio5m', '>=', 1.1], ['m5', '>', -20]] },
  momentum: { label: 'Early momentum', note: '1 to 24 hours old with accelerating volume and buy pressure.', rules: [
    ['ageMin', '>=', 60], ['ageMin', '<=', 1440], ['mcap', '>=', 50000], ['mcap', '<=', 20000000], ['liq', '>=', 15000],
    ['volAccel', '>=', 1.5], ['buyRatio1h', '>=', 1.15], ['h1', '>', 5], ['buyers1h', '>=', 40]] },
  runners: { label: 'Established runners', note: 'Over a day old, deep liquidity, trending up or breaking out.', rules: [
    ['ageMin', '>=', 1440], ['mcap', '>=', 3000000], ['liq', '>=', 100000], ['vol24h', '>=', 500000],
    ['h1', '>', 0], ['h6', '>', 0], ['breakout', '==', true]] },
};

const num = v => (v == null || !Number.isFinite(+v)) ? null : +v;

// Prefer GeckoTerminal for unique buyers and pool reserves, DexScreener for liquidity, socials and boosts.
export function mergeTokens(lists) {
  const by = new Map();
  for (const t of lists.flat()) {
    const cur = by.get(t.mint);
    if (!cur) { by.set(t.mint, structuredClone(t)); continue; }
    const pick = (a, b) => a ?? b;
    cur.src = [...new Set([...cur.src, ...t.src])];
    for (const k of ['sym', 'name', 'image', 'pool', 'dex', 'price', 'mcap']) cur[k] = pick(cur[k], t[k]);
    cur.liq = t.src.includes('dex') && t.liq ? t.liq : pick(cur.liq, t.liq);
    cur.createdAt = Math.min(cur.createdAt || Infinity, t.createdAt || Infinity); if (!Number.isFinite(cur.createdAt)) cur.createdAt = null;
    for (const g of ['chg', 'vol']) for (const k of Object.keys(t[g] || {})) cur[g][k] = pick(cur[g]?.[k], t[g][k]);
    for (const k of ['m5', 'h1', 'h24']) {
      const a = cur.tx[k], b = t.tx?.[k];
      if (!a) cur.tx[k] = b; else if (b) cur.tx[k] = { buys: Math.max(a.buys, b.buys), sells: Math.max(a.sells, b.sells), buyers: a.buyers ?? b.buyers, sellers: a.sellers ?? b.sellers };
    }
    if (t.socials) cur.socials = [...new Set([...(cur.socials || []), ...t.socials])];
    if (t.boosts) cur.boosts = Math.max(cur.boosts || 0, t.boosts);
  }
  return [...by.values()];
}

// Compact history rows, one array per snapshot, so hours of history for hundreds of tokens stay small.
const ROW = ['t', 'price', 'liq', 'mcap', 'vol5m', 'vol1h', 'vol24h', 'buys5m', 'sells5m', 'buyers5m', 'sellers5m', 'buys1h', 'sells1h', 'buyers1h', 'sellers1h', 'm5', 'h1', 'h6', 'age', 'holders', 'score', 'sec'];
export const H = Object.fromEntries(ROW.map((k, i) => [k, i]));
const SEC = { pass: 1, fail: -1 };

export function toRow(t, f, { score = null, sec = null } = {}) {
  return ROW.map(k => k === 't' ? t : k === 'age' ? f.ageMin : k === 'score' ? score : k === 'sec' ? (SEC[sec] ?? 0) : (f[k] ?? null));
}

// Rebuilds a token from a history row so features() and the presets run the same way in a backtest.
export function tokenFromRow(r) {
  const tx = (b, s, bu, se) => ({ buys: r[H[b]], sells: r[H[s]], buyers: r[H[bu]], sellers: r[H[se]] });
  return { price: r[H.price], liq: r[H.liq], mcap: r[H.mcap], holders: r[H.holders], createdAt: r[H.age] == null ? null : r[H.t] - r[H.age] * MIN,
    vol: { m5: r[H.vol5m], h1: r[H.vol1h], h24: r[H.vol24h] }, chg: { m5: r[H.m5], h1: r[H.h1], h6: r[H.h6] },
    tx: { m5: r[H.buys5m] == null ? null : tx('buys5m', 'sells5m', 'buyers5m', 'sellers5m'), h1: r[H.buys1h] == null ? null : tx('buys1h', 'sells1h', 'buyers1h', 'sellers1h') } };
}

export function createHistory({ maxPoints = 240, maxTokens = 400, everyMs = 2 * MIN } = {}) {
  const series = new Map();
  return {
    series,
    record(mint, row) {
      let s = series.get(mint);
      if (!s) { s = []; series.set(mint, s); if (series.size > maxTokens) series.delete(series.keys().next().value); }
      else { series.delete(mint); series.set(mint, s); }
      if (s.length && row[H.t] - s.at(-1)[H.t] < everyMs) s[s.length - 1] = row; else s.push(row);
      if (s.length > maxPoints) s.splice(0, s.length - maxPoints);
    },
    get: mint => series.get(mint) || [],
    toJSON: () => Object.fromEntries(series),
    load(obj) { for (const [k, v] of Object.entries(obj || {})) if (Array.isArray(v)) series.set(k, v); },
  };
}

const ratio = (a, b) => (a == null || b == null) ? null : b === 0 ? (a > 0 ? 10 : 1) : +(a / b).toFixed(2);

// hist is the token's earlier snapshots, not including this one.
export function features(t, hist = [], now = Date.now()) {
  const m5 = t.tx?.m5, h1 = t.tx?.h1;
  const vol5m = num(t.vol?.m5), vol1h = num(t.vol?.h1);
  // 5m volume against the average 5m slice of the last hour. Uses history when the source gives no 1h figure.
  let volAccel = vol5m != null && vol1h ? +(vol5m / (vol1h / 12)).toFixed(2) : null;
  if (volAccel == null && hist.length >= 4 && vol5m != null) {
    const prior = hist.slice(-6).map(r => r[H.vol5m]).filter(v => v != null);
    if (prior.length) volAccel = +(vol5m / (prior.reduce((a, b) => a + b, 0) / prior.length || 1)).toFixed(2);
  }
  const prices = hist.slice(-30).map(r => r[H.price]).filter(Boolean);
  const holdersThen = hist.find(r => r[H.t] >= now - 60 * MIN && r[H.holders])?.[H.holders];
  const price = num(t.price);
  return {
    ageMin: t.createdAt ? Math.max(0, Math.round((now - t.createdAt) / MIN)) : null,
    price, mcap: num(t.mcap), liq: num(t.liq), liqToMcap: t.liq && t.mcap ? +(t.liq / t.mcap).toFixed(3) : null,
    vol5m, vol1h, vol24h: num(t.vol?.h24), volAccel,
    buys5m: m5?.buys ?? null, sells5m: m5?.sells ?? null, buyers5m: m5?.buyers ?? null, sellers5m: m5?.sellers ?? null,
    buyers1h: h1?.buyers ?? null, sellers1h: h1?.sellers ?? null, buys1h: h1?.buys ?? null, sells1h: h1?.sells ?? null,
    buyRatio5m: ratio(m5?.buyers ?? m5?.buys, m5?.sellers ?? m5?.sells), buyRatio1h: ratio(h1?.buyers ?? h1?.buys, h1?.sellers ?? h1?.sells),
    m5: num(t.chg?.m5), h1: num(t.chg?.h1), h6: num(t.chg?.h6), h24: num(t.chg?.h24),
    // A breakout is a new high over the recorded window (at least 10 points) on rising volume.
    breakout: prices.length >= 10 && price != null ? price > Math.max(...prices) && (volAccel == null || volAccel >= 1) : null,
    holders: t.holders ?? null, holderGrowth1h: t.holders && holdersThen ? +((t.holders / holdersThen - 1) * 100).toFixed(1) : null,
    boosts: t.boosts || 0, socials: t.socials || [],
  };
}

const OPS = { '>=': (a, b) => a >= b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '<': (a, b) => a < b, '==': (a, b) => a === b };

export function matchPreset(f, preset) {
  const fails = [];
  for (const [k, op, v] of preset.rules) {
    const x = f[k];
    if (x == null) fails.push(`${k}: no data`);
    else if (!OPS[op](x, v)) fails.push(`${k} ${x} not ${op} ${v}`);
  }
  return { pass: !fails.length, fails };
}

export function validatePresets(p) {
  const out = {};
  for (const [name, def] of Object.entries(p || {})) {
    if (!/^[a-z0-9_-]{1,24}$/.test(name) || !Array.isArray(def?.rules)) throw new Error(`preset ${name} is invalid`);
    const rules = def.rules.map(r => {
      if (!Array.isArray(r) || r.length !== 3 || !OPS[r[1]] || typeof r[0] !== 'string') throw new Error(`preset ${name} has a bad rule`);
      return [r[0], r[1], typeof r[2] === 'boolean' ? r[2] : Number(r[2])];
    });
    out[name] = { label: String(def.label || name).slice(0, 40), note: String(def.note || '').slice(0, 140), rules };
  }
  if (!Object.keys(out).length) throw new Error('need at least one preset');
  return out;
}
