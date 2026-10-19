// Shared HTTP layer for the degen scanner: a per-source rate budget, a TTL cache that also
// collapses duplicate in-flight requests, and per-source health so the dashboard can show what is down.
export class BudgetError extends Error {}

// Token bucket. take() waits up to maxWaitMs for a token, otherwise throws BudgetError so the
// caller skips this call and keeps the last cached value instead of blowing the free tier.
export function createLimiter(perMinute, { now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)), maxWaitMs = 4000 } = {}) {
  const rate = perMinute / 60000;
  let tokens = Math.min(perMinute, 8), at = now(), pausedUntil = 0;
  const refill = () => { const t = now(); tokens = Math.min(perMinute, tokens + (t - at) * rate); at = t; };
  return {
    // reserve keeps that many tokens back for higher-priority calls (discovery before enrichment).
    async take(reserve = 0) {
      if (pausedUntil > now()) throw new BudgetError('backing off after a rate limit');
      refill();
      if (reserve && tokens < reserve + 1) throw new BudgetError('saving budget for discovery');
      if (tokens < 1) {
        const wait = (1 - tokens) / rate;
        if (wait > maxWaitMs) throw new BudgetError('rate budget used up');
        await sleep(wait); refill();
      }
      tokens -= 1;
    },
    pause(ms) { pausedUntil = now() + ms; },
    get tokens() { refill(); return tokens; },
  };
}

export function createCache({ now = Date.now, max = 5000 } = {}) {
  const map = new Map(), inflight = new Map();
  const get = key => { const e = map.get(key); return e && e.exp > now() ? e.val : undefined; };
  const set = (key, val, ttlMs) => {
    map.delete(key); map.set(key, { val, exp: now() + ttlMs });
    if (map.size > max) map.delete(map.keys().next().value);
    return val;
  };
  async function wrap(key, ttlMs, fn) {
    const hit = get(key);
    if (hit !== undefined) return hit;
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => { try { return set(key, await fn(), ttlMs); } finally { inflight.delete(key); } })();
    inflight.set(key, p);
    return p;
  }
  // The last value even if expired, used to keep showing data while a source is down.
  const stale = key => map.get(key)?.val;
  return { get, set, wrap, stale, get size() { return map.size; } };
}

// Free-tier budgets, kept under each provider's published limit.
export const SOURCES = {
  dexscreener: { perMinute: 55, label: 'DexScreener' },
  // The agent desk also pulls GeckoTerminal candles from the same IP, so this stays well under its 30/min.
  geckoterminal: { perMinute: 15, label: 'GeckoTerminal' },
  rpc: { perMinute: 200, label: 'Solana RPC' },
  reddit: { perMinute: 20, label: 'Reddit' },
  fourchan: { perMinute: 20, label: '4chan /biz/' },
  rugcheck: { perMinute: 15, label: 'RugCheck' },
};

export function createNet({ fetchImpl = fetch, now = Date.now, sleep, sources = SOURCES, userAgent = 'HexVault-Degen/0.1 (+https://github.com/neroiq-47/HexVault)' } = {}) {
  const cache = createCache({ now });
  const limiters = {}, health = {};
  for (const [k, s] of Object.entries(sources)) {
    limiters[k] = createLimiter(s.perMinute, { now, sleep });
    health[k] = { label: s.label, ok: 0, errors: 0, cacheHits: 0, lastOk: null, lastError: null };
  }
  // ttlMs caches the parsed body under key (default: the URL). parse turns JSON into what we keep.
  async function json(source, url, { ttlMs = 30000, key = url, init = {}, parse = x => x, timeoutMs = 15000, reserve = 0 } = {}) {
    const h = health[source];
    if (cache.get(key) !== undefined) h.cacheHits++;
    return cache.wrap(key, ttlMs, async () => {
      try {
        await limiters[source].take(reserve);
        const res = await fetchImpl(url, { ...init, headers: { accept: 'application/json', 'user-agent': userAgent, ...(init.headers || {}) }, signal: AbortSignal.timeout(timeoutMs) });
        if (res.status === 429) { limiters[source].pause(60000); throw new Error(`${h.label} rate limited (429)`); }
        if (!res.ok) throw new Error(`${h.label} HTTP ${res.status}`);
        const out = parse(await res.json());
        h.ok++; h.lastOk = now();
        return out;
      } catch (e) {
        if (!(e instanceof BudgetError)) { h.errors++; h.lastError = { at: now(), message: String(e.message || e).slice(0, 160) }; }
        throw e;
      }
    });
  }
  // Solana JSON-RPC over the same budget and cache.
  async function rpc(url, method, params, opts = {}) {
    return json('rpc', url, { ...opts, key: opts.key || `rpc:${method}:${JSON.stringify(params)}`,
      init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) },
      parse: r => { if (r.error) throw new Error(`RPC ${method}: ${r.error.message || r.error.code}`); return (opts.parse || (x => x))(r.result); } });
  }
  return { json, rpc, cache, health, limiters };
}
