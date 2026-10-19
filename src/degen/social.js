// Social sentiment, run locally: a crypto-tuned lexicon scorer, shill and bot detection, token mention
// matching and narrative spotting. X and Telegram have no free public API, so they are always reported unavailable.
const MIN = 60000;

const LEX = {
  moon: 1.5, mooning: 2, bullish: 2, bull: 1, pump: 0.5, pumping: 1.2, send: 0.8, sending: 1.2, gem: 1.2, based: 1, alpha: 1, buy: 0.6, buying: 0.8, bought: 0.6,
  ape: 0.8, aped: 0.8, hold: 0.4, holding: 0.5, strong: 1, love: 1.2, great: 1.2, good: 0.8, nice: 0.8, huge: 1, legit: 1.2, early: 0.8, undervalued: 1.5, breakout: 1.5,
  rocket: 1.5, win: 1, winning: 1.2, profit: 1, gains: 1.2, community: 0.5, safe: 0.6, locked: 0.6, renounced: 0.8, ath: 1, rip: -1, wagmi: 1, lfg: 1.2,
  rug: -3, rugged: -3.5, rugpull: -3.5, scam: -3, scammer: -3, honeypot: -3.5, dump: -1.5, dumping: -2, dumped: -2, rekt: -2, dead: -2, bearish: -2, sell: -0.6, selling: -0.8,
  sold: -0.5, bad: -1, terrible: -2, avoid: -2, fake: -2, bot: -0.8, bots: -1, exit: -0.8, jeet: -1, jeets: -1, bleeding: -1.5, crash: -2, crashing: -2, down: -0.5, loss: -1.2, lost: -1.2,
  drained: -3, insider: -1.5, insiders: -1.5, bundled: -2, bundle: -1.5, cabal: -1.2, careful: -1, warning: -1.5, sus: -1.5, ponzi: -2.5, worthless: -2.5,
};
const EMOJI = { '🚀': 1.5, '🔥': 1, '💎': 1, '🌕': 1.2, '📈': 1.2, '💰': 0.8, '🐂': 1, '📉': -1.2, '💀': -1, '🩸': -1.5, '🚨': -1, '⚠️': -1, '🤡': -1 };
const NEGATORS = new Set(['not', 'no', 'never', "don't", 'dont', "isn't", 'isnt', "wasn't", 'aint', "ain't", 'without']);
const BOOST = { very: 1.4, super: 1.4, so: 1.2, extremely: 1.6, massive: 1.5, insanely: 1.6, totally: 1.3 };

// Returns -1..1. Scores tokens with a negation window of three words and caps the result with x/sqrt(x^2+15), like VADER.
export function sentiment(text) {
  const words = String(text || '').toLowerCase().replace(/https?:\/\/\S+/g, ' ').match(/[a-z']+|\p{Extended_Pictographic}/gu) || [];
  let s = 0;
  words.forEach((w, i) => {
    let v = LEX[w] ?? EMOJI[w];
    if (v == null) return;
    const prev = words.slice(Math.max(0, i - 3), i);
    if (prev.some(p => NEGATORS.has(p))) v *= -0.7;
    const b = BOOST[words[i - 1]]; if (b) v *= b;
    s += v;
  });
  if (/!{2,}/.test(text)) s *= 1.1;
  return +(s / Math.sqrt(s * s + 15)).toFixed(3);
}

const SHILL = [/\b\d{2,5}x\b/i, /next (gem|100x|bonk|pepe|wif)/i, /\bpresale\b/i, /\bairdrop\b/i, /join (my|our|the)? ?(tg|telegram|discord|vip|group)/i, /\bdm me\b/i,
  /\bguarantee[d]?\b/i, /don'?t miss/i, /\bape (now|in)\b/i, /stealth launch/i, /\blast chance\b/i, /\b(lambo|millionaire)\b/i, /\bnfa\b.*\bdyor\b/i, /t\.me\//i, /\bpump(ing)? soon\b/i];

export function shillScore(text) {
  const t = String(text || '');
  let s = SHILL.reduce((a, re) => a + (re.test(t) ? 1 : 0), 0) * 0.25;
  const letters = t.replace(/[^a-z]/gi, ''); if (letters.length > 20 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.6) s += 0.25;
  const emojis = (t.match(/\p{Extended_Pictographic}/gu) || []).length; if (emojis >= 6) s += 0.25;
  if (/[1-9A-HJ-NP-Za-km-z]{32,44}/.test(t) && /https?:\/\//.test(t)) s += 0.15;
  return Math.min(1, +s.toFixed(2));
}

const shingles = text => {
  const w = String(text || '').toLowerCase().replace(/[1-9A-HJ-NP-Za-km-z]{32,44}/g, 'CA').match(/[a-z0-9$]+/g) || [];
  const set = new Set(); for (let i = 0; i + 2 < w.length; i++) set.add(w.slice(i, i + 3).join(' '));
  return set;
};
export function jaccard(a, b) { if (!a.size || !b.size) return 0; let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i); }

// Bot probability per post from shill phrasing, near-duplicate copies and authors posting the same thing repeatedly.
export function flagPosts(posts) {
  const uniq = [...new Map(posts.map(p => [p.id, p])).values()];
  const sh = uniq.map(p => shingles(`${p.title} ${p.text}`));
  const dups = uniq.map(() => 0);
  for (let i = 0; i < uniq.length; i++) for (let j = i + 1; j < uniq.length; j++) {
    if (sh[i].size >= 4 && jaccard(sh[i], sh[j]) >= 0.7) { dups[i]++; dups[j]++; }
  }
  const byAuthor = {};
  for (const p of uniq) if (p.author && p.author !== 'anon' && p.author !== '[deleted]') byAuthor[p.author] = (byAuthor[p.author] || 0) + 1;
  return uniq.map((p, i) => {
    const text = `${p.title} ${p.text}`;
    const shill = shillScore(text), spam = (byAuthor[p.author] || 0) >= 4 ? 0.35 : (byAuthor[p.author] || 0) >= 3 ? 0.2 : 0;
    const bot = Math.min(1, +(shill * 0.6 + Math.min(1, dups[i] / 2) * 0.5 + spam).toFixed(2));
    return { ...p, sentiment: sentiment(text), shill, duplicates: dups[i], bot };
  });
}

const COMMON = new Set(['SOL', 'THE', 'AND', 'FOR', 'BUY', 'SELL', 'PUMP', 'MOON', 'CAT', 'DOG', 'AI', 'BTC', 'ETH', 'USD', 'USDC', 'USDT', 'NEW', 'TOP', 'CEO', 'DEV', 'ATH', 'LFG', 'GM', 'WIN', 'FUN', 'APE', 'MEME', 'COIN', 'TOKEN', 'XBT']);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Which posts mention which token: the contract address always counts; a $TICKER counts when the
// ticker is not a common word; a full name counts when it is distinctive enough.
export function matchMentions(posts, tokens) {
  const out = {};
  const matchers = tokens.map(t => {
    const sym = String(t.sym || '').replace(/^\$/, '').toUpperCase();
    const res = [new RegExp(esc(t.mint))];
    if (sym.length >= 3 && !COMMON.has(sym)) res.push(new RegExp(`\\$${esc(sym)}\\b`, 'i'));
    if ((t.name || '').length >= 6 && !COMMON.has(t.name.toUpperCase())) res.push(new RegExp(`\\b${esc(t.name)}\\b`, 'i'));
    return { mint: t.mint, res };
  });
  for (const p of posts) {
    const text = `${p.title} ${p.text}`;
    for (const m of matchers) if (m.res.some(re => re.test(text))) (out[m.mint] ||= []).push(p);
  }
  return out;
}

// Social Momentum Score 0-100. null when no social source answered: missing data is never scored as zero buzz.
export function socialMomentum(mentions = [], { now = Date.now(), available = true } = {}) {
  if (!available) return { score: null, status: 'unavailable' };
  if (!mentions.length) return { score: 0, status: 'no mentions', mentions1h: 0, authors: 0 };
  const recent = mentions.filter(p => p.created >= now - 60 * MIN), prior = mentions.filter(p => p.created < now - 60 * MIN && p.created >= now - 6 * 60 * MIN);
  const organic = mentions.filter(p => p.bot < 0.5), botShare = 1 - organic.length / mentions.length;
  const authors = new Set(organic.map(p => `${p.src}:${p.author}`)).size;
  const engagement = organic.reduce((a, p) => a + Math.max(0, p.score) + p.comments, 0);
  const sent = organic.length ? organic.reduce((a, p) => a + p.sentiment, 0) / organic.length : 0;
  const spike = (recent.length + 1) / (prior.length / 5 + 1);
  const raw = 30 * Math.min(1, Math.log2(1 + authors) / 4) + 25 * Math.min(1, Math.log2(spike) / 3 + 0.2) + 20 * Math.min(1, Math.log10(1 + engagement) / 3) + 25 * (sent + 1) / 2;
  const score = Math.max(0, Math.min(100, Math.round(raw * (1 - botShare * 0.8))));
  return { score, status: 'ok', mentions1h: recent.length, mentions6h: mentions.length, authors, engagement, sentiment: +sent.toFixed(2), spike: +spike.toFixed(2), botShare: +botShare.toFixed(2),
    suspicious: botShare >= 0.5 ? 'Mostly bot-like or repeated promotion' : null };
}

const STOP = new Set('the a an and or of to in on for with is are was be this that it its i you we they my your our new coin token sol solana crypto just get got can will now like what when who how why all any about from at by up out so if not no do does did dont has have had me us them their there here more most less over into than then too very one two first last day today time next pump fun pumpfun launch launched official real'.split(' '));

// Narratives: words that suddenly show up in new token names and posts compared with the previous few hours.
export function narratives({ tokens = [], posts = [], now = Date.now(), windowMin = 60 }) {
  const items = [
    ...tokens.filter(t => t.createdAt).map(t => ({ at: t.createdAt, text: `${t.name} ${t.sym}`, mint: t.mint, sym: t.sym })),
    ...posts.filter(p => p.bot < 0.5).map(p => ({ at: p.created, text: `${p.title} ${p.text}` })),
  ];
  const terms = {};
  for (const it of items) {
    const words = new Set((String(it.text).toLowerCase().match(/[a-z]{3,20}/g) || []).filter(w => !STOP.has(w)));
    for (const w of words) {
      const e = (terms[w] ||= { term: w, recent: 0, prior: 0, tokens: [] });
      if (it.at >= now - windowMin * MIN) { e.recent++; if (it.sym && e.tokens.length < 5) e.tokens.push(it.sym); }
      else if (it.at >= now - 6 * 60 * MIN) e.prior++;
    }
  }
  return Object.values(terms).filter(e => e.recent >= 3)
    .map(e => ({ ...e, lift: +((e.recent + 1) / (e.prior * windowMin / 300 + 1)).toFixed(2) }))
    .filter(e => e.lift >= 1.5).sort((a, b) => b.recent * b.lift - a.recent * a.lift).slice(0, 12);
}

export const CHANNELS = { x: 'X has no free API, so X sentiment is not included', telegram: 'Telegram has no public search API, so Telegram sentiment is not included' };
