import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegram, telegramConfig, callCaption, callButtons, donationLimits, esc } from './telegram.js';

const MINT = 'GooD1111111111111111111111111111111111pump';
const ROW = { mint: MINT, sym: 'GOOD', name: 'Good <Dog>', image: 'https://cdn.example/good.png', score: 82, grade: 'A', presets: ['fresh'], signals: ['volume spike', 'buy pressure'],
  f: { price: 0.00123, mcap: 210000, liq: 40000, vol5m: 9000, ageMin: 20, buyRatio5m: 0.7, holders: 340 },
  zones: { entry: [0.0011, 0.0012], invalidation: 0.0009, targets: [0.0016, 0.002] }, security: { status: 'pass', warnings: ['top 10 hold 30%'] } };

function fakeApi(handlers = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const method = url.split('/').pop();
    const body = init.body instanceof FormData ? Object.fromEntries(init.body) : JSON.parse(init.body);
    calls.push({ method, body });
    const h = handlers[method];
    const result = typeof h === 'function' ? h(body, calls) : h ?? true;
    if (result instanceof Error) return { json: async () => ({ ok: false, description: result.message }) };
    return { json: async () => ({ ok: true, result }) };
  };
  return { calls, fetchImpl };
}
const cfg = (env = {}) => telegramConfig({ TELEGRAM_BOT_TOKEN: '123:abc', ...env }, { profitAddress: '5qmsMSPXoTWDfsEDLoo15ywoPLSiKB7zqRGR9dSVfQTA' });

test('config defaults to the Pumpflip channel, the owner handle and the $25 to 10 SOL donation range', () => {
  const c = cfg();
  assert.equal(c.enabled, true); assert.equal(c.channel, '@Pumpflip_fun'); assert.equal(c.chat, '@Pumpflip_chat'); assert.equal(c.owner, 'its_neroiq47');
  assert.equal(c.donateMinUsd, 25); assert.equal(c.donateMaxSol, 10);
  assert.equal(cfg({ TG_DONATE_MAX_SOL: '50' }).donateMaxSol, 10);
  assert.equal(telegramConfig({}, {}).enabled, false);
  assert.equal(cfg({ RAILWAY_PUBLIC_DOMAIN: 'hexsyndicate.up.railway.app' }).publicUrl, 'https://hexsyndicate.up.railway.app');
});

test('donation limits turn $25 into SOL at the live price and cap at 10 SOL', () => {
  assert.deepEqual(donationLimits(200), { solUsd: 200, minUsd: 25, minSol: 0.125, maxSol: 10 });
  assert.equal(donationLimits(1).minSol, 10);
  assert.equal(donationLimits(null).minSol, null);
});

test('call caption escapes token text and carries the numbers, CA and fine print', () => {
  const c = callCaption(ROW);
  assert.match(c, /\$GOOD<\/b> · Good &lt;Dog&gt;/);
  assert.match(c, /Score <b>82\/100<\/b> · Rug check ✅ passed/);
  assert.match(c, /💰 MC <b>\$210\.0K<\/b>\n💧 Liquidity <b>\$40\.0K<\/b>/);
  assert.match(c, /🎯 Entry <b>\$0\.00110 – \$0\.00120<\/b>\n🛑 Stop <b>\$0\.000900<\/b>\n✅ Target <b>\$0\.00160<\/b>/);
  assert.ok(c.split('\n').every(l => l.replace(/<[^>]+>/g, '').length <= 48), 'every line fits a phone screen');
  assert.match(c, new RegExp(`<code>${MINT}</code>`));
  assert.match(c, /Not financial advice/);
  assert.doesNotMatch(c, /moon|🚀|guarantee/i);
  assert.ok(c.length <= 1024);
});

test('call buttons link to buy, chart and the bot tip and donate flows', () => {
  const kb = callButtons(ROW, { botUsername: 'PumpflipBot' }).inline_keyboard.flat();
  assert.ok(kb.find(b => b.url === `https://jup.ag/swap/SOL-${MINT}`));
  assert.equal(kb.length, 4);
  assert.ok(kb.find(b => b.url === 'https://t.me/PumpflipBot?start=tip'));
  assert.ok(kb.find(b => b.url === 'https://t.me/PumpflipBot?start=donate'));
  assert.ok(kb.every(b => b.url.startsWith('https://')));
});

test('posts a call with the token picture, then falls back to the bundled card', async () => {
  const api = fakeApi({ sendPhoto: (b, calls) => calls.filter(c => c.method === 'sendPhoto').length === 1 ? new Error('wrong file identifier') : { message_id: 7, photo: [{ file_id: 'small' }, { file_id: 'CARD' }] } });
  const tg = createTelegram({ config: cfg(), fetchImpl: api.fetchImpl, sleep: async () => {} });
  assert.equal(tg.postCall({}, ROW), true);
  await tg.drain();
  const photos = api.calls.filter(c => c.method === 'sendPhoto');
  assert.equal(photos[0].body.photo, ROW.image);
  assert.equal(photos[1].body.chat_id, '@Pumpflip_fun');
  assert.ok(photos[1].body.photo instanceof Blob);
  assert.equal(tg.state.cardFileId, 'CARD');
  assert.equal(tg.state.posted[0].mint, MINT);
  assert.equal(tg.postCall({}, ROW), false, 'the same token is not called twice in six hours');
});

test('respects pause, minimum score and the hourly cap', async () => {
  const api = fakeApi({ sendPhoto: { message_id: 1, photo: [] } });
  const tg = createTelegram({ config: cfg({ TG_CALL_SCORE: '80', TG_CALLS_PER_HOUR: '2' }), fetchImpl: api.fetchImpl, sleep: async () => {} });
  assert.equal(tg.postCall({}, { ...ROW, score: 75 }), false);
  const mk = i => ({ ...ROW, mint: MINT.replace('GooD', `G${i}oD`) });
  assert.equal(tg.postCall({}, mk(1)), true); assert.equal(tg.postCall({}, mk(2)), true); assert.equal(tg.postCall({}, mk(3)), false);
  await tg.drain();
  tg.state.paused = true; assert.equal(tg.postCall({}, mk(4)), false);
});

test('Stars tips: a tier button sends an XTR invoice, checkout is validated and the payment is recorded', async () => {
  const api = fakeApi({ sendMessage: { message_id: 1 } });
  const tg = createTelegram({ config: cfg(), fetchImpl: api.fetchImpl, sleep: async () => {} });
  await tg.handleUpdate({ callback_query: { id: 'q', from: { id: 42 }, data: 'tip:250' } });
  const inv = api.calls.find(c => c.method === 'sendInvoice').body;
  assert.equal(inv.currency, 'XTR'); assert.deepEqual(inv.prices, [{ label: 'Tip', amount: 250 }]); assert.equal(inv.provider_token, undefined);
  await tg.handleUpdate({ callback_query: { id: 'q2', from: { id: 42 }, data: 'tip:9999' } });
  assert.equal(api.calls.filter(c => c.method === 'sendInvoice').length, 1);
  await tg.handleUpdate({ pre_checkout_query: { id: 'p', currency: 'XTR', total_amount: 250, invoice_payload: 'tip:250' } });
  await tg.handleUpdate({ pre_checkout_query: { id: 'p2', currency: 'XTR', total_amount: 1, invoice_payload: 'tip:250' } });
  const answers = api.calls.filter(c => c.method === 'answerPreCheckoutQuery').map(c => c.body.ok);
  assert.deepEqual(answers, [true, false]);
  await tg.handleUpdate({ message: { chat: { id: 42, type: 'private' }, from: { id: 42, username: 'degen' }, successful_payment: { currency: 'XTR', total_amount: 250, telegram_payment_charge_id: 'ch1' } } });
  assert.equal(tg.state.tips[0].stars, 250);
});

test('owner commands work only for the owner handle', async () => {
  const api = fakeApi({ sendMessage: { message_id: 1 } });
  const tg = createTelegram({ config: cfg(), fetchImpl: api.fetchImpl, sleep: async () => {} });
  const dm = (from, text) => tg.handleUpdate({ message: { chat: { id: from.id, type: 'private' }, from, text } });
  await dm({ id: 9, username: 'stranger' }, '/describe hacked');
  assert.equal(api.calls.some(c => c.method === 'setChatDescription'), false);
  await dm({ id: 5, username: 'Its_neroiq47' }, '/describe Degen Radar calls, rug-checked.');
  assert.deepEqual(api.calls.find(c => c.method === 'setChatDescription').body, { chat_id: '@Pumpflip_fun', description: 'Degen Radar calls, rug-checked.' });
  assert.equal(tg.state.ownerId, 5);
  await dm({ id: 5, username: 'renamed' }, '/tone spicy');
  assert.equal(tg.state.tone, 'spicy');
});

test('donate replies with the wallet and the live range', async () => {
  const api = fakeApi({ sendMessage: { message_id: 1 } });
  const fetchImpl = async (url, init) => url.includes('dexscreener') ? { json: async () => [{ baseToken: { address: 'So11111111111111111111111111111111111111112' }, priceUsd: '200', liquidity: { usd: 1e6 } }] } : api.fetchImpl(url, init);
  const tg = createTelegram({ config: cfg({ PUBLIC_URL: 'https://hex.example' }), fetchImpl, sleep: async () => {} });
  await tg.handleUpdate({ message: { chat: { id: 1, type: 'private' }, from: { id: 1 }, text: '/start donate' } });
  const msg = api.calls.find(c => c.method === 'sendMessage').body;
  assert.match(msg.text, /0\.125 SOL \(about \$25\) up to 10 SOL/);
  assert.match(msg.text, /5qmsMSPXoTWDfsEDLoo15ywoPLSiKB7zqRGR9dSVfQTA/);
  assert.deepEqual(msg.reply_markup.inline_keyboard[0].map(b => b.url), ['https://hex.example/donate?amount=0.125', 'https://hex.example/donate?amount=1', 'https://hex.example/donate?amount=5', 'https://hex.example/donate?amount=10']);
  assert.equal(esc('<b>'), '&lt;b&gt;');
});

test('welcome links new members to the Desk', async () => {
  const api = fakeApi({ sendMessage: { message_id: 1 } });
  const tg = createTelegram({ config: cfg({ RAILWAY_PUBLIC_DOMAIN: 'hexsyndicate.up.railway.app' }), fetchImpl: api.fetchImpl, sleep: async () => {} });
  await tg.handleUpdate({ message: { chat: { id: -1, type: 'supergroup' }, new_chat_members: [{ id: 7, first_name: 'Ana' }] } });
  assert.match(api.calls.find(c => c.method === 'sendMessage').body.text, /Ana[\s\S]*\nThe Desk: https:\/\/hexsyndicate\.up\.railway\.app$/);
});
