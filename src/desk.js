// One desk cycle: refresh prices, run the four agents, record history, enforce the drawdown stop, sweep profit once a day.
// The desk's mode can move between shadow and live at runtime (the Live switch), but only when TRADING_MODE=live armed it.
import { newBook, equity, priceOf, sweepableUsd, rollDay, closeAll, MIN_SWEEP_USD, RESERVE_SOL } from './paper.js';
import { runRound } from './agents.js';
import { sendSol, balanceSol } from './wallet.js';
import { walletValueSol } from './live.js';

const DAY_MS = 864e5;
const MIN_SWEEP_SOL = 0.005;

export function createDesk({ config, fetchMarket, brain, wallet, executor, executors, mode = config.mode, log = () => {} }) {
  const state = { mode, book: null, market: null, lastRound: null, lastError: null, wallet: null, deposits: [] };
  // Donations raise the live baseline, so they are traded as float rather than swept as profit.
  const baseSol = () => config.floatSol + state.deposits.reduce((a, d) => a + d.sol, 0);
  const execs = executors || (executor ? { [mode]: executor } : {});
  const isLive = () => state.mode === 'live';
  const exec = () => execs[state.mode] || null;

  // One thing at a time: a cycle, the kill switch and the Live switch never interleave.
  let queue = Promise.resolve();
  const serial = fn => (...args) => { const run = queue.then(() => fn(...args)); queue = run.catch(() => {}); return run; };

  async function refresh() {
    state.market = await fetchMarket();
    const solPx = priceOf(state.market, 'SOL');
    if (!state.book) state.book = newBook(state.mode === 'paper' ? config.startUsd : config.floatSol * solPx, solPx);
    // The real on-chain balance, shown on the site in every mode except paper.
    if (wallet && state.mode !== 'paper') {
      const read = walletValueSol(wallet.connection, wallet.keypair.publicKey.toBase58(), state.market);
      state.wallet = isLive() ? await read : await read.catch(() => state.wallet); // a failed read only matters when live
    }
    return state.market;
  }

  // Equity as a fraction of the start: on-chain wallet value when live, the book otherwise.
  function equityRatio() {
    if (isLive()) return state.wallet.total / baseSol();
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
    const record = { ts: now, usd: 0, sol: 0, to: config.profitAddress, cluster: config.cluster, mode: state.mode, signature: null, error: null, status: null };
    if (isLive()) {
      // Real profit only: free SOL above the float plus reserve, never more than the wallet's gain.
      const w = state.wallet;
      record.sol = Math.max(0, Math.min(w.sol - RESERVE_SOL, w.total - baseSol() - RESERVE_SOL));
      if (record.sol < MIN_SWEEP_SOL) return null;
      record.usd = record.sol * solPx;
      await sendProfit(record);
      if (record.status === 'sent') { book.cash -= record.usd; state.wallet.sol -= record.sol; state.wallet.total -= record.sol; }
    } else {
      record.usd = sweepableUsd(book, market);
      if (record.usd < MIN_SWEEP_USD) return null;
      record.sol = record.usd / solPx;
      if (wallet && state.mode === 'paper') await sendProfit(record); else record.status = 'paper';
      if (record.status !== 'failed') book.cash -= record.usd;
    }
    book.sweeps.push(record);
    log(record.status === 'failed' ? 'warn' : 'info', 'sweep', record);
    return record;
  }

  async function closePositions(now) {
    const { book, market } = state;
    const executor = exec();
    if (!executor) return closeAll(book, market, now);
    const approved = Object.keys(book.pos).map(token => ({ action: 'sell', token, frac: 1 }));
    return executor({ book, market, approved, now });
  }

  // Kill switch: close every position, stop trading, and sweep any profit straight away.
  async function killNow(now = Date.now(), reason = 'manual') {
    if (!state.book || !state.market) return { fills: [], sweep: null };
    const fills = await closePositions(now);
    state.book.halted = true; state.book.haltReason = reason;
    if (isLive()) state.wallet = await walletValueSol(wallet.connection, wallet.keypair.publicKey.toBase58(), state.market);
    log('warn', 'trading halted', { reason, fills: fills.length });
    return { fills, sweep: await sweep(now, { force: true }) };
  }

  async function cycleNow(now = Date.now()) {
    try {
      await refresh();
      const { book, market } = state;
      rollDay(book, market, now);
      if (!book.halted && equityRatio() <= 1 - config.maxDrawdown) await killNow(now, `drawdown over ${config.maxDrawdown * 100}%`);
      if (!book.halted) {
        state.lastRound = await runRound({ book, market, brain, level: config.riskLevel, now, ...(exec() ? { execute: exec() } : {}) });
        book.rounds++;
        if (isLive()) state.wallet = await walletValueSol(wallet.connection, wallet.keypair.publicKey.toBase58(), market);
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

  // The Live switch. On: start a fresh book from the funded wallet and sign real swaps.
  // Off: sell every live position back to SOL, then carry on in shadow mode from a fresh book.
  async function setLiveNow(on, now = Date.now()) {
    if (on === isLive()) return { mode: state.mode, fills: [] };
    if (on && (config.mode !== 'live' || !execs.live)) throw new Error('Live trading is locked. Set TRADING_MODE=live in Railway to arm the switch.');
    if (on && state.book?.halted) throw new Error('Trading is halted. Resume it before going live.');
    const fills = !on && state.book && state.market ? await closePositions(now) : [];
    const prev = state.mode;
    state.mode = on ? 'live' : 'shadow';
    state.book = null; state.wallet = null;
    try {
      await refresh();
      if (on && state.wallet.total < baseSol() * (1 - config.maxDrawdown)) {
        throw new Error(`The agent wallet holds ${state.wallet.total.toFixed(4)} SOL. Fund it with FLOAT_SOL (${config.floatSol} SOL) or lower FLOAT_SOL.`);
      }
    } catch (e) {
      state.mode = prev; state.book = null; state.wallet = null;
      await refresh().catch(() => {});
      throw e;
    }
    log('warn', on ? 'live trading switched on' : 'live trading switched off', { fills: fills.length });
    return { mode: state.mode, fills };
  }

  // A donation the server has verified on chain. Duplicates are ignored.
  function addDeposit(d) {
    if (state.deposits.some(x => x.signature === d.signature)) return false;
    state.deposits.push(d);
    log('info', 'donation received', d);
    return true;
  }

  const cycle = serial(cycleNow), kill = serial(killNow), setLive = serial(setLiveNow);
  return { state, refresh, cycle, sweep, kill, resume, setLive, addDeposit };
}
