import http from 'node:http';
import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { loadConfig } from './config.js';
import { fetchMarket } from './market.js';
import { makeBrain } from './agents.js';
import { loadKeypair, connect } from './wallet.js';
import { createJupiter } from './jupiter.js';
import { createExecutor } from './live.js';
import { createDesk } from './desk.js';
import { equity } from './paper.js';
import { loadState, saveState } from './store.js';
import { log } from './log.js';
import { verifyDonation } from './donations.js';
import { DONATION_MIN_SOL, DONATION_MAX_SOL } from './config.js';

const SITE = readFileSync(new URL('../public/index.html', import.meta.url));

export function publicState(desk, config, wallet) {
  const { book, market, lastRound, lastError } = desk.state;
  return {
    mode: desk.state.mode, armed: config.mode === 'live', cluster: config.cluster, riskLevel: config.riskLevel,
    agentWallet: wallet ? wallet.keypair.publicKey.toBase58() : null,
    donations: { enabled: Boolean(config.donations && wallet), minSol: DONATION_MIN_SOL, maxSol: DONATION_MAX_SOL,
      totalSol: desk.state.deposits.reduce((a, d) => a + d.sol, 0), recent: desk.state.deposits.slice(-10) },
    profitAddress: config.profitAddress,
    brain: [config.anthropicKey && 'claude', ...(config.backups || []).map(b => b.name)].filter(Boolean).join(' > ') || 'rules',
    market, lastRound, lastError, walletValueSol: desk.state.wallet, floatSol: config.floatSol || null,
    book: book && { ...book, equity: market ? equity(book, market) : null },
  };
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 1e4) throw new Error('body too large'); }
  try { return JSON.parse(body || '{}'); } catch { return {}; }
}

function authorised(req, secret) {
  if (!secret || secret.length < 24) return false;
  const got = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, ''));
  const want = Buffer.from(secret);
  return got.length === want.length && timingSafeEqual(got, want);
}

export function createServer({ desk, config, wallet, persist }) {
  return http.createServer(async (req, res) => {
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
    try {
      if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' }); return res.end(SITE); }
      if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true });
      if (req.method === 'GET' && req.url === '/api/state') return send(200, publicState(desk, config, wallet));
      if (req.method === 'POST' && (req.url === '/api/kill' || req.url === '/api/resume')) {
        if (!authorised(req, config.adminSecret)) return send(401, { error: 'Send Authorization: Bearer <ADMIN_SECRET>' });
        if (req.url === '/api/kill') { const r = await desk.kill(Date.now(), 'manual'); await persist(); log('warn', 'kill switch used', { fills: r.fills.length }); return send(200, r); }
        desk.resume(); await persist(); return send(200, { halted: false });
      }
      if (req.url === '/api/blockhash' || req.url === '/api/donation') {
        if (!config.donations || !wallet) return send(404, { error: 'Donations are off' });
        if (req.method === 'GET' && req.url === '/api/blockhash') return send(200, await wallet.connection.getLatestBlockhash('confirmed'));
        if (req.method === 'POST') {
          const { signature } = await readJson(req);
          const r = await verifyDonation(wallet.connection, signature, wallet.keypair.publicKey.toBase58());
          if (r.status === 'pending') return send(202, { status: 'pending' });
          if (r.status !== 'ok') return send(400, { error: r.error });
          if (desk.addDeposit(r.deposit)) await persist();
          return send(200, { status: 'ok', deposit: r.deposit });
        }
      }
      if (req.method === 'POST' && req.url === '/api/live') {
        if (!authorised(req, config.adminSecret)) return send(401, { error: 'Wrong admin secret' });
        const { on } = await readJson(req);
        if (typeof on !== 'boolean') return send(400, { error: 'Send {"on": true} or {"on": false}' });
        try { const r = await desk.setLive(on); await persist(); return send(200, r); }
        catch (e) { return send(409, { error: String(e.message || e) }); }
      }
      send(404, { error: 'not found' });
    } catch (e) { log('error', 'request failed', { message: String(e.message || e) }); send(500, { error: 'internal error' }); }
  });
}

async function main() {
  const config = loadConfig();
  const keypair = loadKeypair(config.agentWalletSecret);
  const wallet = keypair ? { keypair, connection: connect(config.rpcUrl) } : null;
  const brain = makeBrain({ apiKey: config.anthropicKey, model: config.agentModel, backups: config.backups });
  // TRADING_MODE=live arms the Live switch; the bot still starts in shadow unless the switch was left on.
  const saved = await loadState(config.dataPath);
  const armed = config.mode === 'live';
  const executors = {};
  if (config.mode !== 'paper') {
    const jupiter = createJupiter({ apiKey: config.jupiterKey });
    executors.shadow = createExecutor({ mode: 'shadow', jupiter, connection: wallet.connection, keypair, log });
    if (armed) executors.live = createExecutor({ mode: 'live', jupiter, connection: wallet.connection, keypair, log });
  }
  const mode = armed ? (saved?.liveOn ? 'live' : 'shadow') : config.mode;
  const desk = createDesk({ config, fetchMarket, brain, wallet, executors, mode, log });
  if (saved?.book) desk.state.book = saved.book;
  if (saved?.deposits) desk.state.deposits = saved.deposits;
  const persist = () => saveState(config.dataPath, { book: desk.state.book, liveOn: desk.state.mode === 'live', deposits: desk.state.deposits });

  const server = createServer({ desk, config, wallet, persist });
  server.listen(config.port, () => log('info', 'listening', { port: config.port, mode, armed, cluster: config.cluster, wallet: wallet ? keypair.publicKey.toBase58() : null, brain: brain ? brain.providers.join(' > ') : 'rules' }));

  let running = false;
  const tick = async () => {
    if (running) return; running = true;
    try { await desk.cycle(); await persist(); } finally { running = false; }
  };
  tick();
  const timer = setInterval(tick, config.roundSeconds * 1000);
  const stop = () => { clearInterval(timer); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 8000).unref(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { log('error', 'startup failed', { message: String(e.message || e) }); process.exit(1); });
