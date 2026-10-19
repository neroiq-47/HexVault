// Trading method library: 15-minute candles from GeckoTerminal (free, no key) run through the
// trading-signals indicators, then a regime-aware playbook turns them into one signal per token.
import { ADX, ATR, BollingerBands, EMA, MACD, RSI } from 'trading-signals';

export const METHOD_LIBRARY = `Method library (use these, cite the method name in your reason):
1. Regime first. ADX>25 = trending, ADX<20 = ranging, between = mixed: trade smaller or stand aside.
2. Trend breakout (trending only): EMA9 above EMA21, price above EMA21, RSI 50-70, MACD histogram above 0, volume rising. Buy with the trend.
3. Mean reversion (ranging only): price at or below the lower Bollinger band or RSI under 30, while the 6h trend is not collapsing. Small size, target the middle band.
4. Exits: sell when RSI is above 75, when price closes under EMA21 in a trend trade, or when price falls 2x ATR below entry (ATR stop).
5. Never chase: skip buys after a 5m move larger than 2x ATR, and skip tokens with no indicator data.
6. Smart money: smartMoney24h is what the tracked wallets did in the token over 24h. Accumulating confirms a buy setup; distributing vetoes new buys and is a reason to exit a held position. Quiet or untracked is neutral.`;

const GECKO = 'https://api.geckoterminal.com/api/v2/networks/solana/pools';

export async function fetchCandles(pool, fetchImpl = fetch) {
  const res = await fetchImpl(`${GECKO}/${pool}/ohlcv/minute?aggregate=15&limit=100&currency=usd`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`GeckoTerminal HTTP ${res.status}`);
  const list = (await res.json())?.data?.attributes?.ohlcv_list;
  if (!Array.isArray(list)) throw new Error('GeckoTerminal returned an unexpected shape');
  return list.map(([t, o, h, l, c, v]) => ({ t, o: +o, h: +h, l: +l, c: +c, v: +v })).filter(k => k.c > 0).sort((a, b) => a.t - b.t);
}

export const pct = (a, b) => +((a / b - 1) * 100).toFixed(2);

export function computeSignals(candles) {
  if (candles.length < 35) return null;
  const e9 = new EMA(9), e21 = new EMA(21), rsi = new RSI(14), macd = new MACD(new EMA(12), new EMA(26), new EMA(9));
  const atr = new ATR(14), bb = new BollingerBands(20, 2), adx = new ADX(14);
  for (const k of candles) {
    e9.add(k.c); e21.add(k.c); rsi.add(k.c); macd.add(k.c); bb.add(k.c);
    atr.add({ high: k.h, low: k.l, close: k.c }); adx.add({ high: k.h, low: k.l, close: k.c });
  }
  const close = candles.at(-1).c;
  const vols = candles.map(k => k.v), recent = vols.slice(-4), prior = vols.slice(-20, -4);
  const avg = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);
  const b = bb.getResult(), a = adx.getResult(), m = macd.getResult();
  if (!b || a == null || !m) return null;
  return {
    close, ema9: e9.getResult(), ema21: e21.getResult(), rsi: +rsi.getResult().toFixed(1),
    macdHist: m.histogram, atrPct: +(atr.getResult() / close * 100).toFixed(2), adx: +a.toFixed(1),
    bbLower: b.lower, bbMiddle: b.middle, bbUpper: b.upper,
    volTrend: +(avg(recent) / (avg(prior) || 1)).toFixed(2),
    regime: a > 25 ? 'trending' : a < 20 ? 'ranging' : 'mixed',
  };
}

// The playbook in code, so the rule fallback trades the same methods the AI is told to use.
export function methodSignal(s, token, held) {
  if (!s) return { method: 'none', action: 'hold', reason: 'no indicator data' };
  const dumping = token?.smart?.state === 'distributing';
  if (held && dumping) return { method: 'smart-money', action: 'sell', reason: `${token.smart.sellers} tracked wallets selling` };
  if (held) {
    const atrStop = held.entry * (1 - 2 * s.atrPct / 100);
    if (s.rsi > 75) return { method: 'exit', action: 'sell', reason: `RSI ${s.rsi} overbought` };
    if (s.close < atrStop) return { method: 'exit', action: 'sell', reason: 'hit 2x ATR stop' };
    if (s.regime === 'trending' && s.close < s.ema21) return { method: 'exit', action: 'sell', reason: 'closed under EMA21' };
    return { method: 'hold', action: 'hold', reason: 'position still valid' };
  }
  if (Math.abs(token?.m5 || 0) > 2 * s.atrPct) return { method: 'no-chase', action: 'hold', reason: '5m move over 2x ATR' };
  if (dumping) return { method: 'smart-money', action: 'hold', reason: 'tracked wallets are selling' };
  const up = s.ema9 > s.ema21 && s.close > s.ema21;
  if (s.regime === 'trending' && up && s.rsi >= 50 && s.rsi <= 70 && s.macdHist > 0 && s.volTrend > 1)
    return { method: 'trend-breakout', action: 'buy', size: 1, reason: `ADX ${s.adx}, RSI ${s.rsi}, MACD up, volume ${s.volTrend}x${token?.smart?.state === 'accumulating' ? ', smart money buying' : ''}` };
  if (s.regime === 'ranging' && (s.close <= s.bbLower || s.rsi < 30) && (token?.h6 ?? 0) > -5)
    return { method: 'mean-reversion', action: 'buy', size: 0.5, reason: `ranging, RSI ${s.rsi}, at lower band` };
  return { method: 'wait', action: 'hold', reason: `${s.regime}, no setup` };
}

// Candles change every 15 minutes, so each pool is fetched at most once per 10 minutes.
// Calls are spaced out to stay inside GeckoTerminal's free rate limit.
export function makeSignalSource({ fetchImpl = fetch, ttlMs = 10 * 60 * 1000, gapMs = 2500, now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const cache = {};
  return async function attach(market) {
    let first = true;
    for (const t of market.tokens) {
      if (!t.pool) continue;
      const hit = cache[t.pool];
      if (!hit || now() - hit.at > ttlMs) {
        if (!first) await sleep(gapMs);
        first = false;
        try { cache[t.pool] = { at: now(), sig: computeSignals(await fetchCandles(t.pool, fetchImpl)) }; }
        catch { if (!hit) cache[t.pool] = { at: now() - ttlMs / 2, sig: null }; }
      }
      if (cache[t.pool].sig) t.ind = cache[t.pool].sig;
    }
    return market;
  };
}
