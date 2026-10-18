// One desk cycle: refresh prices, run the four agents, record history, enforce the drawdown stop, sweep profit once a day.
import { newBook, equity, priceOf, sweepableUsd, rollDay, closeAll, MIN_SWEEP_USD, RESERVE_SOL } from './paper.js';
import { runRound } from './agents.js';
import { sendSol, balanceSol } from './wallet.js';
import { walletValueSol } from './live.js';

const DAY_MS = 864e5;
const MIN_SWEEP_SOL = 0.005;

export function createDesk({ config, fetchMarket, brain, wallet, executor, log = () => {} }) {
  const state = { book: null, market: null, lastRound: null, lastError: null, wallet: null };
  const live = config.mode === 'live';

  async function refresh() {
    state.market = await fetchMarket();
    const solPx = priceOf(state.market, 'SOL');
    if (!state.book) state.book = newBook(config.mode === 'paper' ? config.startUsd : config.floatSol * solPx, solPx);
    if (live) state.wallet = await walletValueSol(wallet.connection, wallet.keypair.publicKey.toBase58(), state.market);
    return state.market;
  }

  // Equity as a fraction of the start: on-chain wallet value when live, the book otherwise.
  function equityRatio() {
    if (live) return state.wallet.total / config.floatSol;
    return equity(state.book, state.market) / state.book.startUsd;
  }

  async function sendProfit(record) {
    try {
      const bal = await balanceSol(wallet.connection, wallet.keypair.publicKey.toBase58());
      if (bal - record.sol < RESERVE_SOL) throw new Error(`agent wallet has ${bal.toFixed(4)} SOL, needs ${(record.sol + RESERVE_SOL).toFixed(4)}`);
      record.signature = await sendSol({ connection: wallet.connection, keypair: wallet.keypair, to: config.profitAddress, sol: record.sol, send: wallet.send });
      record.status = 'sent';
    } catch (e) { record.error = String(e.message || e); record.status = 'failed'; }
  }

  async function sweep(now = Date.now(), { force = false } = {}) {
    const { book, market } = state;
    const last = book.sweeps.filter(s => s.status !== 'failed').at(-1);
    if (!force && last && now - last.ts < DAY_MS) return null;
    const solPx = priceOf(market, 'SOL');
    const record = { ts: now, usd: 0, sol: 0, to: config.profitAddress, cluster: config.cluster, mode: config.mode, signature: null, error: null, status: null };
    if (live) {
      // Real profit only: free SOL above the float plus reserve, never more than the wallet's gain.
      const w = state.wallet;
      record.sol = Math.max(0, Math.min(w.sol - RESERVE_SOL, w.total - config.floatSol - RESERVE_SOL));
      if (record.sol < MIN_SWEEP_SOL) return null;
      record.usd = record.sol * solPx;
      await sendProfit(record);
      if (record.status === 'sent') { book.cash -= record.usd; state.wallet.sol -= record.sol; state.wallet.total -= record.sol; }
    } else {
      record.usd = sweepableUsd(book, market);
      if (record.usd < MIN_SWEEP_USD) return null;
      record.sol = record.usd / solPx;
      if (wallet && config.mode === 'paper') await sendProfit(record); else record.status = 'paper';
      if (record.status !== 'failed') book.cash -= record.usd;
    }
    book.sweeps.push(record);
    log(record.status === 'failed' ? 'warn' : 'info', 'sweep', record);
    return record;
  }

  async function closePositions(now) {
    const { book, market } = state;
    if (!executor) return closeAll(book, market, now);
    const approved = Object.keys(book.pos).map(token => ({ action: 'sell', token, frac: 1 }));
    return executor({ book, market, approved, now });
  }

  // Kill switch: close every position, stop trading, and sweep any profit straight away.
  async function kill(now = Date.now(), reason = 'manual') {
    if (!state.book || !state.market) return { fills: [], sweep: null };
    const fills = await closePositions(now);
    state.book.halted = true; state.book.haltReason = reason;
    if (live) state.wallet = await walletValueSol(wallet.connection, wallet.keypair.publicKey.toBase58(), state.market);
    log('warn', 'trading halted', { reason, fills: fills.length });
    return { fills, sweep: await sweep(now, { force: true }) };
  }

  async function cycle(now = Date.now()) {
    try {
      await refresh();
      const { book, market } = state;
      rollDay(book, market, now);
      if (!book.halted && equityRatio() <= 1 - config.maxDrawdown) await kill(now, `drawdown over ${config.maxDrawdown * 100}%`);
      if (!book.halted) {
        state.lastRound = await runRound({ book, market, brain, level: config.riskLevel, now, ...(executor ? { execute: executor } : {}) });
        book.rounds++;
        if (live) state.wallet = await walletValueSol(wallet.connection, wallet.keypair.publicKey.toBase58(), market);
      }
      book.history.push({ ts: now, equity: equity(book, market), walletSol: state.wallet?.total ?? null });
      if (book.history.length > 2000) book.history.shift();
      await sweep(now);
      state.lastError = null;
    } catch (e) {
      state.lastError = { ts: now, message: String(e.message || e) };
      log('error', 'cycle failed', state.lastError);
    }
    return state;
  }

  function resume() { if (state.book) { state.book.halted = false; delete state.book.haltReason; } }

  return { state, refresh, cycle, sweep, kill, resume };
}
