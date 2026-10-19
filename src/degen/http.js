// HTTP routes for the degen dashboard. Reads are public; changing the watchlist, wallets or presets needs the admin secret.
import { readFileSync } from 'node:fs';

const PAGE = readFileSync(new URL('../../public/degen.html', import.meta.url));
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function createDegenRoutes({ degen, authorised, readJson, persist }) {
  const clients = new Set();
  // Server-sent events: one small message per scan so open dashboards refresh and new alerts pop immediately.
  function broadcast(cycle) {
    const alerts = degen.state.alerts.filter(a => a.at >= cycle.at);
    const msg = `data: ${JSON.stringify({ at: cycle.at, tradable: cycle.tradable, alerts })}\n\n`;
    for (const res of clients) res.write(msg);
  }
  setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000).unref();

  async function handle(req, res, send) {
    const url = new URL(req.url, 'http://x'), path = url.pathname;
    if (!path.startsWith('/degen') && !path.startsWith('/api/degen')) return false;
    if (req.method === 'GET' && (path === '/degen' || path === '/degen/')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' });
      res.end(PAGE); return true;
    }
    if (req.method === 'GET' && path === '/api/degen/state') { send(200, degen.view()); return true; }
    if (req.method === 'GET' && path === '/api/degen/stream') {
      if (clients.size >= 100) { send(503, { error: 'too many listeners' }); return true; }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(': hello\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return true;
    }
    let m;
    if (req.method === 'GET' && (m = path.match(/^\/api\/degen\/token\/([^/]+)$/))) {
      if (!MINT.test(m[1])) { send(400, { error: 'bad address' }); return true; }
      const t = degen.token(m[1]); send(t ? 200 : 404, t || { error: 'Not in the current scan. Add it to the watchlist to track it.' }); return true;
    }
    if (req.method === 'GET' && (m = path.match(/^\/api\/degen\/chart\/([^/]+)$/))) {
      if (!MINT.test(m[1])) { send(400, { error: 'bad address' }); return true; }
      try { const c = await degen.candles(m[1]); send(c ? 200 : 404, c ? { candles: c } : { error: 'no pool for this token' }); }
      catch (e) { send(503, { error: `Chart data unavailable: ${String(e.message || e).slice(0, 100)}` }); }
      return true;
    }
    if (req.method === 'GET' && path === '/api/degen/backtest') {
      const r = degen.backtest(url.searchParams.get('preset') || 'fresh'); send(r ? 200 : 404, r || { error: 'unknown preset' }); return true;
    }
    if (req.method === 'POST' && path.startsWith('/api/degen/')) {
      if (!authorised(req)) { send(401, { error: 'Send Authorization: Bearer <ADMIN_SECRET>' }); return true; }
      const body = await readJson(req);
      try {
        if (path === '/api/degen/watch') send(200, { watchlist: degen.watch(body.mint, body.on !== false) });
        else if (path === '/api/degen/wallets') send(200, { wallets: degen.trackWallet(body.address, body.label, body.on !== false) });
        else if (path === '/api/degen/presets') send(200, { presets: degen.setPresets(body.presets) });
        else if (path === '/api/degen/paper/reset') send(200, degen.resetPaper());
        else { send(404, { error: 'not found' }); return true; }
        await persist();
      } catch (e) { send(400, { error: String(e.message || e) }); }
      return true;
    }
    send(404, { error: 'not found' }); return true;
  }
  return { handle, broadcast };
}
