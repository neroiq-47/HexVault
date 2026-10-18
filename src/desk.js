// One desk cycle: refresh prices, run the four agents, record history, sweep profit once a day.
import { newBook, equity, priceOf, sweepableUsd, rollDay, closeAll, MIN_SWEEP_USD } from './paper.js';
import { runRound } from './agents.js';
import { sendSol, balanceSol } from './wallet.js';
import { RESERVE_SOL } from './paper.js';

const DAY_MS = 864e5;

export function createDesk({ config, fetchMarket, brain, wallet, log = () => {} }) {
  const state = { book: null, market: null, lastRound: null, lastError: null };

  async function refresh() {
    state.market = await fetchMarket();
    if (!state.book) state.book = newBook(config.startUsd, priceOf(state.market, 'SOL'));
    return state.market;
  }

  async function sweep(now = Date.now(), { force = false } = {}) {
    const { book, market } = state;
    const last = book.sweeps.at(-1);
    if (!force && last && now - last.ts < DAY_MS) return null;
    const usd = sweepableUsd(book, market);
    if (usd < MIN_SWEEP_USD) return null;
    const solPx = priceOf(market, 'SOL');
    const record = { ts: now, usd, sol: usd / solPx, to: config.profitAddress, cluster: config.cluster, signature: null, error: null, status: null };
    book.cash -= usd;
    if (wallet) {
      try {
        const bal = await balanceSol(wallet.connection, wallet.keypair.publicKey.toBase58());
        if (bal - record.sol < RESERVE_SOL) throw new Error(`agent wallet has ${bal.toFixed(4)} SOL, needs ${(record.sol + RESERVE_SOL).toFixed(4)}`);
        record.signature = await sendSol({ connection: wallet.connection, keypair: wallet.keypair, to: config.profitAddress, sol: record.sol, send: wallet.send });
        record.status = 'sent';
      } catch (e) { record.error = String(e.message || e); record.status = 'failed'; book.cash += usd; }
    } else record.status = 'paper';
    book.sweeps.push(record);
    log(record.signature ? 'info' : 'warn', 'sweep', record);
    return record;
  }

  async function cycle(now = Date.now()) {
    try {
      await refresh();
      const { book, market } = state;
      rollDay(book, market, now);
      if (!book.halted) {
        state.lastRound = await runRound({ book, market, brain, level: config.riskLevel, now });
        book.rounds++;
      }
      book.history.push({ ts: now, equity: equity(book, market) });
      if (book.history.length > 2000) book.history.shift();
      await sweep(now);
      state.lastError = null;
    } catch (e) {
      state.lastError = { ts: now, message: String(e.message || e) };
      log('error', 'cycle failed', state.lastError);
    }
    return state;
  }

  // Kill switch: close every position, stop trading, and sweep any profit straight away.
  async function kill(now = Date.now()) {
    if (!state.book || !state.market) return { fills: [], sweep: null };
    const fills = closeAll(state.book, state.market, now);
    state.book.halted = true;
    return { fills, sweep: await sweep(now, { force: true }) };
  }

  function resume() { if (state.book) state.book.halted = false; }

  return { state, refresh, cycle, sweep, kill, resume };
}
