// Pumpflip: posts Degen Radar calls to the Telegram channel with a picture and Buy, Chart, Tip and Donate buttons.
// Tips are Telegram Stars paid to this bot. Stars sit on the bot's balance and only the bot's owner can withdraw them
// (through Fragment, after Telegram's hold), so the bot must belong to the account that should be paid.
// SOL donations go straight to the project wallet: the bot only links to it and never holds a key.
import { readFileSync } from 'node:fs';

const API = 'https://api.telegram.org';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const HOUR = 3600000;
const CARD = readFileSync(new URL('../public/call-card.png', import.meta.url));

// Call voices. All of them follow the brand rules: no promises, no "moon", no rocket emoji.
export const TONES = Object.freeze({
  chill: {
    heads: ['Degen Radar picked one up.', 'Fresh one on the radar.', 'This one passed the rug checks.', 'Worth a look, not a mortgage.'],
    welcome: name => `Welcome in, ${name}. Calls land in the channel, chat lives here. Size small, read the CA twice, and nothing here is financial advice.`,
  },
  spicy: {
    heads: ["Radar's twitching. Have a look.", 'Scout found a live one.', "The Risk Manager didn't say no. Rare.", 'Degens, eyes up.'],
    welcome: name => `${name} has entered the trenches. Calls drop in the channel, cope goes here. Not financial advice, obviously.`,
  },
  dry: {
    heads: ['New call.'],
    welcome: name => `Welcome, ${name}. Calls are posted in the channel. Not financial advice.`,
  },
});

export function telegramConfig(env = process.env, { profitAddress } = {}) {
  const token = (env.TELEGRAM_BOT_TOKEN || '').trim();
  const tips = (env.TG_TIP_STARS || '50,250,1000').split(',').map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 10000).slice(0, 4);
  const domain = (env.RAILWAY_PUBLIC_DOMAIN || '').trim();
  return {
    enabled: Boolean(token) && (env.TG_CALLS || 'on').trim() !== 'off',
    token,
    channel: (env.TG_CHANNEL || '@Pumpflip_fun').trim(),
    chat: (env.TG_CHAT || '@Pumpflip_chat').trim(),
    owner: (env.TG_OWNER || 'Its_neroiq47').trim().replace(/^@/, '').toLowerCase(),
    ownerId: Number(env.TG_OWNER_ID) || null,
    tone: TONES[(env.TG_TONE || '').trim()] ? env.TG_TONE.trim() : 'chill',
    minScore: Number(env.TG_CALL_SCORE) || 0,
    maxPerHour: Math.max(1, Number(env.TG_CALLS_PER_HOUR) || 6),
    tipStars: tips.length ? tips : [50, 250, 1000],
    donateMinUsd: Math.max(1, Number(env.TG_DONATE_MIN_USD) || 25),
    donateMaxSol: Math.min(10, Math.max(0.1, Number(env.TG_DONATE_MAX_SOL) || 10)),
    donateAddress: profitAddress,
    publicUrl: (env.PUBLIC_URL || (domain ? `https://${domain}` : '')).trim().replace(/\/$/, ''),
    dataPath: env.TG_DATA_PATH || './data/telegram.json',
  };
}

export const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function usd(n) {
  if (n == null || !Number.isFinite(n)) return '?';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}
export function price(n) {
  if (n == null || !Number.isFinite(n)) return '?';
  if (n >= 1) return `$${n.toFixed(4)}`;
  return `$${n.toPrecision(3)}`;
}
const age = m => m == null ? '?' : m < 60 ? `${Math.round(m)}m` : m < 1440 ? `${(m / 60).toFixed(1)}h` : `${Math.round(m / 1440)}d`;

// Smallest and largest donation in SOL: at least donateMinUsd at the live SOL price, at most donateMaxSol.
export function donationLimits(solUsd, { donateMinUsd = 25, donateMaxSol = 10 } = {}) {
  if (!(solUsd > 0)) return { solUsd: null, minUsd: donateMinUsd, minSol: null, maxSol: donateMaxSol };
  const minSol = Math.min(donateMaxSol, Math.ceil(donateMinUsd / solUsd * 1000) / 1000);
  return { solUsd, minUsd: donateMinUsd, minSol, maxSol: donateMaxSol };
}

export function solanaPayUrl(address, amount, label = 'HexSyndicate', message = 'Pumpflip donation') {
  return `solana:${address}?amount=${amount}&label=${encodeURIComponent(label)}&message=${encodeURIComponent(message)}`;
}

// One fact per line, biggest things first, so a call reads in a couple of seconds on a phone.
export function callCaption(row, { tone = 'chill', pick = 0 } = {}) {
  const heads = (TONES[tone] || TONES.chill).heads;
  const f = row.f || {}, z = row.zones, sec = row.security || {};
  const rug = sec.status === 'pass' ? '✅ passed' : sec.status === 'fail' ? '❌ failed' : '⚠️ partial';
  const lines = [
    `<i>${esc(heads[pick % heads.length])}</i>`,
    '',
    `<b>$${esc(row.sym)}</b>${row.name ? ` · ${esc(row.name)}` : ''}`,
    `Score <b>${row.score}/100</b> · Rug check ${rug}`,
    '',
    `💰 MC <b>${usd(f.mcap)}</b>`,
    `💧 Liquidity <b>${usd(f.liq)}</b>`,
    `⏱ Age <b>${age(f.ageMin)}</b>`,
    '',
    ...(z ? [`🎯 Entry <b>${z.entry.map(price).join(' – ')}</b>`, `🛑 Stop <b>${price(z.invalidation)}</b>`, `✅ Target <b>${price(z.targets[0])}</b>`] : [`💵 Price <b>${price(f.price)}</b>`]),
    '',
    '📋 CA (tap to copy)',
    `<code>${esc(row.mint)}</code>`,
    '',
    '<i>Not financial advice. DYOR.</i>',
  ];
  return lines.join('\n').slice(0, 1024);
}

export function callButtons(row, { botUsername } = {}) {
  const kb = [[{ text: '🟢 Buy', url: `https://jup.ag/swap/SOL-${row.mint}` }, { text: '📈 Chart', url: `https://dexscreener.com/solana/${row.mint}` }]];
  if (botUsername) kb.push([{ text: '⭐ Tip', url: `https://t.me/${botUsername}?start=tip` }, { text: '💜 Donate', url: `https://t.me/${botUsername}?start=donate` }]);
  return { inline_keyboard: kb };
}

export function createTelegram({ config, fetchImpl = fetch, now = Date.now, log = () => {}, saved = null, persist = async () => {}, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  const s = {
    tone: config.tone, paused: false, welcome: null, offset: 0, posted: [], tips: [], cardFileId: null, ownerId: config.ownerId, me: null,
    lastError: null, lastWelcomeAt: 0, solUsd: null, solAt: 0, ...(saved || {}),
  };
  s.posted = (s.posted || []).filter(p => p.at > now() - 24 * HOUR);
  let degen = null, stopped = false;

  async function call(method, body, { multipart = false } = {}) {
    const init = multipart ? { method: 'POST', body } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) };
    const res = await fetchImpl(`${API}/bot${config.token}/${method}`, { ...init, signal: AbortSignal.timeout(method === 'getUpdates' ? 40000 : 15000) });
    const out = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
    if (!out.ok) { const e = new Error(`${method}: ${out.description || 'failed'}`); e.code = out.error_code; e.retryAfter = out.parameters?.retry_after; throw e; }
    return out.result;
  }
  const save = () => persist({ tone: s.tone, paused: s.paused, welcome: s.welcome, offset: s.offset, posted: s.posted.slice(-100), tips: s.tips.slice(-500), cardFileId: s.cardFileId, ownerId: s.ownerId });

  async function solPrice() {
    if (s.solUsd && now() - s.solAt < 5 * 60000) return s.solUsd;
    try {
      const res = await fetchImpl(`https://api.dexscreener.com/tokens/v1/solana/${SOL_MINT}`, { signal: AbortSignal.timeout(10000) });
      const pairs = await res.json();
      const best = (Array.isArray(pairs) ? pairs : []).filter(p => p?.baseToken?.address === SOL_MINT && Number(p.priceUsd) > 0).sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
      if (best) { s.solUsd = Number(best.priceUsd); s.solAt = now(); }
    } catch (e) { log('warn', 'sol price failed', { message: String(e.message || e) }); }
    return s.solUsd;
  }
  const limits = async () => donationLimits(await solPrice(), config);

  // Channel posts go out one at a time, a few seconds apart, under an hourly cap so the channel never floods.
  const queue = [];
  let draining = false, pending = 0;
  function postCall(alert, row) {
    if (s.paused || !row || !MINT.test(row.mint) || row.score < config.minScore) return false;
    if (s.posted.some(p => p.mint === row.mint && p.at > now() - 6 * HOUR)) return false;
    if (s.posted.filter(p => p.at > now() - HOUR).length + pending >= config.maxPerHour || queue.some(r => r.mint === row.mint)) return false;
    queue.push(row); pending++; drain();
    return true;
  }
  async function drain() {
    if (draining) return; draining = true;
    try {
      while (queue.length) {
        const row = queue.shift();
        try { await sendCall(row); } catch (e) { s.lastError = String(e.message || e); log('warn', 'telegram call failed', { sym: row.sym, message: s.lastError }); if (e.retryAfter) await sleep(e.retryAfter * 1000); }
        pending--;
        if (queue.length) await sleep(4000);
      }
    } finally { draining = false; }
  }

  async function sendCall(row, chatId = config.channel) {
    const caption = callCaption(row, { tone: s.tone, pick: s.posted.length });
    const reply_markup = callButtons(row, { botUsername: s.me?.username });
    let msg = null;
    if (/^https:\/\//.test(row.image || '')) {
      try { msg = await call('sendPhoto', { chat_id: chatId, photo: row.image, caption, parse_mode: 'HTML', reply_markup }); }
      catch (e) { log('warn', 'token image refused, using the call card', { sym: row.sym, message: String(e.message || e) }); }
    }
    if (!msg && s.cardFileId) {
      try { msg = await call('sendPhoto', { chat_id: chatId, photo: s.cardFileId, caption, parse_mode: 'HTML', reply_markup }); } catch { s.cardFileId = null; }
    }
    if (!msg) {
      const form = new FormData();
      form.append('chat_id', String(chatId)); form.append('caption', caption); form.append('parse_mode', 'HTML'); form.append('reply_markup', JSON.stringify(reply_markup));
      form.append('photo', new Blob([CARD], { type: 'image/png' }), 'pumpflip-call.png');
      msg = await call('sendPhoto', form, { multipart: true });
      s.cardFileId = msg.photo?.at(-1)?.file_id || null;
    }
    if (chatId === config.channel) { s.posted.push({ mint: row.mint, sym: row.sym, score: row.score, at: now(), messageId: msg.message_id }); await save(); }
    return msg;
  }

  const isOwner = from => from && ((s.ownerId && from.id === s.ownerId) || (from.username || '').toLowerCase() === config.owner);
  const send = (chat_id, text, extra = {}) => call('sendMessage', { chat_id, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra });

  async function tipMenu(chatId) {
    return send(chatId, 'Tips go to the HexSyndicate crew in Telegram Stars. They buy nothing back and are not refunded once the call is posted. Pick an amount:',
      { reply_markup: { inline_keyboard: [config.tipStars.map(n => ({ text: `⭐ ${n}`, callback_data: `tip:${n}` }))] } });
  }
  async function donateInfo(chatId) {
    const l = await limits();
    const range = l.minSol ? `${l.minSol} SOL (about $${l.minUsd}) up to ${l.maxSol} SOL` : `$${l.minUsd} worth of SOL up to ${l.maxSol} SOL`;
    const amounts = [...new Set([l.minSol, 1, 5, l.maxSol].filter(a => a && (!l.minSol || a >= l.minSol) && a <= l.maxSol))];
    const kb = config.publicUrl ? { inline_keyboard: [amounts.map(a => ({ text: `${a} SOL`, url: `${config.publicUrl}/donate?amount=${a}` }))] } : undefined;
    return send(chatId, [
      '<b>Donate SOL to HexSyndicate</b>',
      `Send ${range} to the project wallet:`,
      `<code>${esc(config.donateAddress)}</code>`,
      kb ? 'Or tap an amount to open it in your wallet.' : null,
      '<i>Donations are gifts. They buy no token, no share and nothing back.</i>',
    ].filter(Boolean).join('\n'), kb ? { reply_markup: kb } : {});
  }

  async function onMessage(m) {
    const text = (m.text || '').trim();
    if (m.successful_payment) return onPaid(m);
    if (m.new_chat_members?.length && m.chat.type !== 'private') {
      if (now() - s.lastWelcomeAt < 60000) return;
      s.lastWelcomeAt = now();
      const names = m.new_chat_members.filter(u => !u.is_bot).map(u => esc(u.first_name || u.username || 'degen')).slice(0, 5).join(', ');
      if (names) await send(m.chat.id, s.welcome ? esc(s.welcome).replaceAll('{name}', names) : TONES[s.tone].welcome(names));
      return;
    }
    if (m.chat.type !== 'private' || !text.startsWith('/')) return;
    const [cmd0, ...rest] = text.split(/\s+/); const cmd = cmd0.split('@')[0].toLowerCase(); const arg = rest.join(' ');
    if (cmd === '/start' && arg === 'tip' || cmd === '/tip') return tipMenu(m.chat.id);
    if (cmd === '/start' && arg === 'donate' || cmd === '/donate') return donateInfo(m.chat.id);
    if (cmd === '/paysupport') return send(m.chat.id, `Payment problem? Message @${esc(config.owner)} with the time of your tip. Stars tips are refunded only when a payment went wrong.`);
    if (cmd === '/terms') return send(m.chat.id, 'Calls are information from an automated scanner, not financial advice. Tips in Stars and SOL donations are voluntary gifts and buy nothing back.');
    if (cmd === '/start' || cmd === '/help') {
      if (isOwner(m.from) && !s.ownerId) { s.ownerId = m.from.id; await save(); }
      return send(m.chat.id, `I post Degen Radar calls in ${esc(config.channel)}. /tip sends Stars to the crew, /donate shows the SOL wallet.${isOwner(m.from) ? '\n\nOwner: /status /pause /resume /tone chill|spicy|dry /describe text /chatdesc text /botdesc text /welcome text /stars /test /refund user_id charge_id' : ''}`);
    }
    if (!isOwner(m.from)) return;
    if (!s.ownerId) { s.ownerId = m.from.id; await save(); }
    const done = t => send(m.chat.id, t);
    try {
      if (cmd === '/status') {
        const hour = s.posted.filter(p => p.at > now() - HOUR).length, stars = s.tips.reduce((a, t) => a + t.stars, 0);
        return done(`Posting: ${s.paused ? 'paused' : 'on'} · tone ${s.tone}\nCalls this hour: ${hour}/${config.maxPerHour} · last 24h: ${s.posted.length}\nTips: ${s.tips.length} for ⭐ ${stars}${s.lastError ? `\nLast error: ${esc(s.lastError)}` : ''}`);
      }
      if (cmd === '/pause' || cmd === '/resume') { s.paused = cmd === '/pause'; await save(); return done(s.paused ? 'Calls paused.' : 'Calls back on.'); }
      if (cmd === '/tone') { if (!TONES[arg]) return done(`Tones: ${Object.keys(TONES).join(', ')}`); s.tone = arg; await save(); return done(`Tone set to ${arg}.`); }
      if (cmd === '/describe' || cmd === '/chatdesc') {
        if (!arg) return done('Add the text after the command.');
        await call('setChatDescription', { chat_id: cmd === '/describe' ? config.channel : config.chat, description: arg.slice(0, 255) });
        return done('Description updated.');
      }
      if (cmd === '/botdesc') { if (!arg) return done('Add the text after the command.'); await call('setMyDescription', { description: arg.slice(0, 512) }); await call('setMyShortDescription', { short_description: arg.slice(0, 120) }); return done('Bot description updated.'); }
      if (cmd === '/welcome') { s.welcome = arg || null; await save(); return done(arg ? 'Welcome message set. {name} becomes the new members\' names.' : `Welcome reset to the ${s.tone} tone.`); }
      if (cmd === '/stars') { const b = await call('getMyStarBalance'); return done(`Bot balance: ⭐ ${b.amount}. Withdraw from the bot's profile in Telegram (Stars → Withdraw via Fragment) once Telegram's hold has passed.`); }
      if (cmd === '/test') {
        const top = degen?.view().opportunities?.[0];
        if (!top) return done('Degen Radar has no tradable setup right now.');
        await sendCall(top, m.chat.id); return;
      }
      if (cmd === '/refund') {
        const [uid, charge] = rest;
        await call('refundStarPayment', { user_id: Number(uid), telegram_payment_charge_id: charge });
        s.tips = s.tips.map(t => t.chargeId === charge ? { ...t, refunded: true } : t); await save();
        return done('Refunded.');
      }
    } catch (e) { return done(`Telegram said no: ${esc(String(e.message || e))}`); }
  }

  async function onCallback(q) {
    const m = /^tip:(\d+)$/.exec(q.data || '');
    const stars = m && Number(m[1]);
    if (!stars || !config.tipStars.includes(stars)) return call('answerCallbackQuery', { callback_query_id: q.id, text: 'That amount is not offered.' });
    await call('answerCallbackQuery', { callback_query_id: q.id });
    return call('sendInvoice', { chat_id: q.from.id, title: `Tip the crew ⭐ ${stars}`, description: 'A thank-you for the Pumpflip calls. Buys nothing back.',
      payload: `tip:${stars}`, currency: 'XTR', prices: [{ label: 'Tip', amount: stars }] });
  }

  async function onPreCheckout(q) {
    const m = /^tip:(\d+)$/.exec(q.invoice_payload || '');
    const ok = q.currency === 'XTR' && m && Number(m[1]) === q.total_amount && config.tipStars.includes(q.total_amount);
    return call('answerPreCheckoutQuery', ok ? { pre_checkout_query_id: q.id, ok: true } : { pre_checkout_query_id: q.id, ok: false, error_message: 'This tip amount is no longer offered.' });
  }

  async function onPaid(m) {
    const p = m.successful_payment;
    if (p.currency !== 'XTR') return;
    s.tips.push({ at: now(), userId: m.from.id, username: m.from.username || null, stars: p.total_amount, chargeId: p.telegram_payment_charge_id });
    await save();
    await send(m.chat.id, `Got it, ⭐ ${p.total_amount}. Thank you, the crew noticed.`);
    if (s.ownerId) await send(s.ownerId, `⭐ ${p.total_amount} tip from ${esc(m.from.username ? '@' + m.from.username : m.from.first_name || m.from.id)}.`).catch(() => {});
  }

  async function handleUpdate(u) {
    if (u.message) return onMessage(u.message);
    if (u.callback_query) return onCallback(u.callback_query);
    if (u.pre_checkout_query) return onPreCheckout(u.pre_checkout_query);
  }

  async function poll() {
    while (!stopped) {
      try {
        const updates = await call('getUpdates', { offset: s.offset, timeout: 30, allowed_updates: ['message', 'callback_query', 'pre_checkout_query'] });
        for (const u of updates) {
          s.offset = u.update_id + 1;
          try { await handleUpdate(u); } catch (e) { log('warn', 'telegram update failed', { message: String(e.message || e) }); }
        }
        if (updates.length) await save();
      } catch (e) { s.lastError = String(e.message || e); log('warn', 'telegram poll failed', { message: s.lastError }); await sleep(e.retryAfter ? e.retryAfter * 1000 : 5000); }
    }
  }

  async function start() {
    s.me = await call('getMe');
    await call('deleteWebhook', {}).catch(() => {});
    await call('setMyCommands', { commands: [{ command: 'tip', description: 'Tip the crew in Stars' }, { command: 'donate', description: 'Donate SOL' }, { command: 'paysupport', description: 'Help with a payment' }, { command: 'terms', description: 'Terms' }] }).catch(() => {});
    log('info', 'telegram bot ready', { bot: s.me.username, channel: config.channel, chat: config.chat });
    poll();
  }

  return {
    state: s, call, start, stop: () => { stopped = true; }, attach: d => { degen = d; }, postCall, sendCall, handleUpdate, limits, drain: async () => { while (draining || queue.length) await sleep(10); },
    publicView: async () => ({ ...(await limits()), address: config.donateAddress, bot: s.me?.username || null, channel: config.channel }),
  };
}
