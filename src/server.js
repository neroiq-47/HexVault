import http from 'node:http';
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

export function publicState(desk, config, wallet) {
  const { book, market, lastRound, lastError } = desk.state;
  return {
    mode: config.mode, cluster: config.cluster, riskLevel: config.riskLevel,
    agentWallet: wallet ? wallet.keypair.publicKey.toBase58() : null,
    profitAddress: config.profitAddress,
    brain: config.anthropicKey ? 'claude' : 'rules',
    market, lastRound, lastError, walletValueSol: desk.state.wallet, floatSol: config.floatSol || null,
    book: book && { ...book, equity: market ? equity(book, market) : null },
  };
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
      if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true });
      if (req.method === 'GET' && req.url === '/api/state') return send(200, publicState(desk, config, wallet));
      if (req.method === 'POST' && (req.url === '/api/kill' || req.url === '/api/resume')) {
        if (!authorised(req, config.adminSecret)) return send(401, { error: 'Send Authorization: Bearer <ADMIN_SECRET>' });
        if (req.url === '/api/kill') { const r = await desk.kill(Date.now(), 'manual'); await persist(); log('warn', 'kill switch used', { fills: r.fills.length }); return send(200, r); }
        desk.resume(); await persist(); return send(200, { halted: false });
      }
      send(404, { error: 'not found' });
    } catch (e) { log('error', 'request failed', { message: String(e.message || e) }); send(500, { error: 'internal error' }); }
  });
}

async function main() {
  const config = loadConfig();
  const keypair = loadKeypair(config.agentWalletSecret);
  const wallet = keypair ? { keypair, connection: connect(config.rpcUrl) } : null;
  const brain = makeBrain({ apiKey: config.anthropicKey, model: config.agentModel });
  const executor = config.mode === 'paper' ? null
    : createExecutor({ mode: config.mode, jupiter: createJupiter({ apiKey: config.jupiterKey }), connection: wallet.connection, keypair, log });
  const desk = createDesk({ config, fetchMarket, brain, wallet, executor, log });
  const saved = await loadState(config.dataPath);
  if (saved?.book) desk.state.book = saved.book;
  const persist = () => saveState(config.dataPath, { book: desk.state.book });

  const server = createServer({ desk, config, wallet, persist });
  server.listen(config.port, () => log('info', 'listening', { port: config.port, mode: config.mode, cluster: config.cluster, wallet: wallet ? keypair.publicKey.toBase58() : null, brain: brain ? 'claude' : 'rules' }));

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
