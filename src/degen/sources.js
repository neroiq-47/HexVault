// Free data sources: GeckoTerminal and DexScreener for pairs, the public Solana RPC for on-chain
// security and wallets, Reddit and 4chan /biz/ for public social posts. Every parser is pure and tested.
const GT = 'https://api.geckoterminal.com/api/v2/networks/solana';
const DS = 'https://api.dexscreener.com';
export const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';
export const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
// Quote and major tokens are never memecoin candidates.
export const MAJORS = new Set([
  'So11111111111111111111111111111111111111112', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh', 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij', 'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB',
]);

const n = v => { if (v == null || v === '') return null; const x = Number(v); return Number.isFinite(x) ? x : null; };
const gtTx = t => t ? { buys: t.buys || 0, sells: t.sells || 0, buyers: t.buyers ?? null, sellers: t.sellers ?? null } : null;

export function parseGeckoPools(body) {
  if (!Array.isArray(body?.data)) throw new Error('GeckoTerminal returned an unexpected shape');
  const meta = {};
  for (const inc of body.included || []) if (inc.type === 'token') meta[inc.id] = inc.attributes || {};
  const out = [];
  for (const p of body.data) {
    const a = p.attributes || {}, baseId = p.relationships?.base_token?.data?.id || '';
    const mint = baseId.replace(/^solana_/, '');
    if (!mint || MAJORS.has(mint)) continue;
    const m = meta[baseId] || {}, pc = a.price_change_percentage || {}, v = a.volume_usd || {}, t = a.transactions || {};
    out.push({
      mint, sym: m.symbol || (a.name || '').split(' / ')[0] || '?', name: m.name || '', image: m.image_url || null,
      pool: a.address, dex: p.relationships?.dex?.data?.id || null,
      createdAt: a.pool_created_at ? Date.parse(a.pool_created_at) : null,
      price: n(a.base_token_price_usd), mcap: n(a.market_cap_usd) ?? n(a.fdv_usd), liq: n(a.reserve_in_usd),
      chg: { m5: n(pc.m5), h1: n(pc.h1), h6: n(pc.h6), h24: n(pc.h24) },
      vol: { m5: n(v.m5), h1: n(v.h1), h6: n(v.h6), h24: n(v.h24) },
      tx: { m5: gtTx(t.m5), h1: gtTx(t.h1), h24: gtTx(t.h24) },
      src: ['gecko'],
    });
  }
  return out;
}

// DexScreener /tokens/v1 returns every pair; keep the deepest (or busiest, for bonding curves with no liquidity field).
export function parseDexPairs(pairs) {
  if (!Array.isArray(pairs)) throw new Error('DexScreener returned an unexpected shape');
  const best = {};
  for (const p of pairs) {
    const mint = p?.baseToken?.address;
    if (!mint || p.chainId !== 'solana' || MAJORS.has(mint)) continue;
    const rank = (p.liquidity?.usd || 0) * 10 + (p.volume?.h24 || 0);
    if (best[mint] && best[mint].rank >= rank) continue;
    const tx = k => p.txns?.[k] ? { buys: p.txns[k].buys || 0, sells: p.txns[k].sells || 0, buyers: null, sellers: null } : null;
    best[mint] = { rank, tok: {
      mint, sym: p.baseToken.symbol || '?', name: p.baseToken.name || '', image: p.info?.imageUrl || null,
      pool: p.pairAddress, dex: p.dexId || null, createdAt: p.pairCreatedAt || null,
      price: n(p.priceUsd), mcap: n(p.marketCap) ?? n(p.fdv), liq: n(p.liquidity?.usd),
      chg: { m5: n(p.priceChange?.m5), h1: n(p.priceChange?.h1), h6: n(p.priceChange?.h6), h24: n(p.priceChange?.h24) },
      vol: { m5: n(p.volume?.m5), h1: n(p.volume?.h1), h6: n(p.volume?.h6), h24: n(p.volume?.h24) },
      tx: { m5: tx('m5'), h1: tx('h1'), h24: tx('h24') },
      socials: [...(p.info?.socials || []).map(s => s.type), ...((p.info?.websites || []).length ? ['website'] : [])],
      boosts: p.boosts?.active || 0, src: ['dex'],
    } };
  }
  return Object.values(best).map(b => b.tok);
}

// Boosts are paid DexScreener promotions; profiles are paid listings. Both are hype signals, not quality signals.
export function parseDexPromos(list) {
  if (!Array.isArray(list)) throw new Error('DexScreener returned an unexpected shape');
  return list.filter(x => x?.chainId === 'solana' && x.tokenAddress && !MAJORS.has(x.tokenAddress))
    .map(x => ({ mint: x.tokenAddress, amount: x.amount || 0, total: x.totalAmount || 0, description: String(x.description || '').slice(0, 400),
      links: (x.links || []).map(l => l.type || 'website') }));
}

export function parseCandles(body) {
  const list = body?.data?.attributes?.ohlcv_list;
  if (!Array.isArray(list)) throw new Error('GeckoTerminal returned an unexpected shape');
  return list.map(([t, o, h, l, c, v]) => ({ t, o: +o, h: +h, l: +l, c: +c, v: +v })).filter(k => k.c > 0).sort((a, b) => a.t - b.t);
}

export function parseTokenInfo(body) {
  const a = body?.data?.attributes;
  if (!a) throw new Error('GeckoTerminal returned an unexpected shape');
  const yn = v => v === 'no' ? false : v === 'yes' ? true : null;
  return { holders: n(a.holders?.count), top10Pct: n(a.holders?.distribution_percentage?.top_10),
    dev: a.developer_address || null, devPct: n(a.developer_holding_percentage),
    mintAuthority: yn(a.mint_authority), freezeAuthority: yn(a.freeze_authority), honeypot: yn(a.is_honeypot),
    twitter: a.twitter_handle || null, telegram: a.telegram_handle || null, websites: a.websites || [],
    graduation: n(a.launchpad_details?.graduation_percentage), graduated: a.launchpad_details?.completed ?? null,
    description: String(a.description || '').slice(0, 400) };
}

// Mint account (jsonParsed). Token-2022 extensions that let the issuer take or freeze funds are listed by name.
export function parseMint(result) {
  const v = result?.value;
  if (!v) return null;
  const info = v.data?.parsed?.info;
  if (!info) throw new Error('mint account is not a parsed SPL mint');
  return { program: v.owner, mintAuthority: info.mintAuthority || null, freezeAuthority: info.freezeAuthority || null,
    decimals: info.decimals, supply: Number(info.supply) / 10 ** info.decimals,
    extensions: (info.extensions || []).map(e => e.extension) };
}

const chunk = (a, size) => Array.from({ length: Math.ceil(a.length / size) }, (_, i) => a.slice(i * size, i * size + size));

export function createSources({ net, rpcUrl = MAINNET_RPC, reddit = {}, isOnCurve = () => true }) {
  const gt = (path, opts) => net.json('geckoterminal', GT + path, opts);
  const rpc = (method, params, opts) => net.rpc(rpcUrl, method, params, opts);
  let redditToken = null;
  return {
    newPools: (page = 1) => gt(`/new_pools?page=${page}&include=base_token`, { ttlMs: 45000, parse: parseGeckoPools }),
    trendingPools: (page = 1) => gt(`/trending_pools?page=${page}&include=base_token&duration=1h`, { ttlMs: 90000, parse: parseGeckoPools }),
    // When the budget or a rate limit refuses a call, the last candles fetched for the pool are still a usable chart.
    async candles(pool, agg = 5, reserve = 3) {
      const url = `${GT}/pools/${pool}/ohlcv/minute?aggregate=${agg}&limit=120&currency=usd`;
      try { return await net.json('geckoterminal', url, { ttlMs: 120000, parse: parseCandles, reserve }); }
      catch (e) { const old = net.cache.stale(url); if (old) return old; throw e; }
    },
    tokenInfo: mint => gt(`/tokens/${mint}/info`, { ttlMs: 180000, parse: parseTokenInfo, reserve: 2 }),
    async dexTokens(mints) {
      const out = [], parts = chunk([...new Set(mints)], 30);
      let failed = 0, last;
      for (const part of parts) {
        try { out.push(...await net.json('dexscreener', `${DS}/tokens/v1/solana/${part.join(',')}`, { ttlMs: 25000, parse: parseDexPairs })); }
        catch (e) { failed++; last = e; }
      }
      if (parts.length && failed === parts.length) throw last;
      return out;
    },
    boosts: () => Promise.all([`${DS}/token-boosts/latest/v1`, `${DS}/token-boosts/top/v1`].map(u => net.json('dexscreener', u, { ttlMs: 120000, parse: parseDexPromos }))).then(([a, b]) => [...a, ...b]),
    profiles: () => net.json('dexscreener', `${DS}/token-profiles/latest/v1`, { ttlMs: 120000, parse: parseDexPromos }),

    // A null authority can never be set again, so a clean mint is cached for hours; a set one is rechecked.
    async mint(mint) {
      const key = `mint:${mint}`, hit = net.cache.get(key);
      if (hit) return hit;
      const m = await rpc('getAccountInfo', [mint, { encoding: 'jsonParsed', commitment: 'confirmed' }], { key: `${key}:raw`, ttlMs: 1000, parse: parseMint });
      if (m) net.cache.set(key, m, m.mintAuthority || m.freezeAuthority ? 600000 : 6 * 3600000);
      return m;
    },
    // Top 20 token accounts with their owners. Owners that are off the ed25519 curve are program accounts
    // (AMM vaults, bonding curves, lockers), so they are reported separately from real wallets.
    async holders(mint, supply) {
      const largest = await rpc('getTokenLargestAccounts', [mint, { commitment: 'confirmed' }], { ttlMs: 180000, parse: r => r?.value || [] });
      if (!largest.length) return [];
      const owners = await rpc('getMultipleAccounts', [largest.map(a => a.address), { encoding: 'jsonParsed' }], { ttlMs: 180000, parse: r => (r?.value || []).map(a => a?.data?.parsed?.info?.owner || null) });
      return largest.map((a, i) => {
        const owner = owners[i], amt = Number(a.uiAmount ?? a.uiAmountString ?? 0);
        return { account: a.address, owner, amount: amt, pct: supply ? amt / supply * 100 : null, program: owner ? !isOnCurve(owner) : null };
      });
    },
    signatures: (address, limit = 40, before) => rpc('getSignaturesForAddress', [address, { limit, commitment: 'confirmed', ...(before ? { before } : {}) }], { ttlMs: 60000, parse: r => r || [] }),
    transaction: sig => rpc('getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }], { ttlMs: 24 * 3600000 }),
    rugcheck: mint => net.json('rugcheck', `https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`, { ttlMs: 900000,
      parse: r => ({ score: n(r?.score_normalised ?? r?.score), risks: (r?.risks || []).map(x => ({ name: x.name, level: x.level, description: x.description })), lpLockedPct: n(r?.lpLockedPct) }) }),

    // Reddit's public JSON works from many hosts; with free REDDIT_CLIENT_ID/SECRET it uses app-only OAuth, which cloud IPs need.
    async reddit(sub) {
      let base = 'https://www.reddit.com', headers = {};
      if (reddit.clientId && reddit.clientSecret) {
        if (!redditToken || redditToken.exp < Date.now()) {
          const res = await fetch('https://www.reddit.com/api/v1/access_token', { method: 'POST', body: 'grant_type=client_credentials', signal: AbortSignal.timeout(15000),
            headers: { authorization: 'Basic ' + Buffer.from(`${reddit.clientId}:${reddit.clientSecret}`).toString('base64'), 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'HexVault-Degen/0.1' } });
          if (!res.ok) throw new Error(`Reddit OAuth HTTP ${res.status}`);
          const t = await res.json(); redditToken = { value: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 };
        }
        base = 'https://oauth.reddit.com'; headers = { authorization: `Bearer ${redditToken.value}` };
      }
      return net.json('reddit', `${base}/r/${sub}/new.json?limit=100&raw_json=1`, { ttlMs: 240000, key: `reddit:${sub}`, init: { headers }, parse: parseReddit });
    },
    biz: () => net.json('fourchan', 'https://a.4cdn.org/biz/catalog.json', { ttlMs: 300000, parse: parseBizCatalog }),
  };
}

export function parseReddit(body) {
  const kids = body?.data?.children;
  if (!Array.isArray(kids)) throw new Error('Reddit returned an unexpected shape');
  return kids.map(k => k.data).filter(Boolean).map(d => ({
    id: `reddit:${d.id}`, src: 'reddit', where: `r/${d.subreddit}`, author: d.author || '?', title: d.title || '', text: String(d.selftext || '').slice(0, 2000),
    score: d.score || 0, comments: d.num_comments || 0, created: (d.created_utc || 0) * 1000, url: `https://www.reddit.com${d.permalink || ''}`,
  }));
}

const unhtml = s => String(s || '').replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&');

// The /biz/ catalog: thread openers plus their latest replies. Posts are anonymous, so the poster id stands in for the author.
export function parseBizCatalog(pages) {
  if (!Array.isArray(pages)) throw new Error('4chan returned an unexpected shape');
  const out = [];
  for (const pg of pages) for (const t of pg.threads || []) {
    out.push({ id: `biz:${t.no}`, src: 'biz', where: '/biz/', author: t.id || t.name || 'anon', title: unhtml(t.sub), text: unhtml(t.com).slice(0, 2000),
      score: 0, comments: t.replies || 0, created: (t.time || 0) * 1000, url: `https://boards.4chan.org/biz/thread/${t.no}` });
    for (const r of t.last_replies || []) out.push({ id: `biz:${r.no}`, src: 'biz', where: '/biz/', author: r.id || 'anon', title: '', text: unhtml(r.com).slice(0, 1000),
      score: 0, comments: 0, created: (r.time || 0) * 1000, url: `https://boards.4chan.org/biz/thread/${t.no}#p${r.no}` });
  }
  return out;
}
