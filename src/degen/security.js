// Anti-rug engine. Critical checks are gates: a fail rejects the token, and a critical check with no
// data leaves it UNVERIFIED, which is treated exactly like a fail for alerts and paper trades.
import { H } from './scanner.js';
import { TOKEN_2022 } from './sources.js';

export const LIMITS = { top10Pct: 35, whalePct: 12, minLiq: 3000, clusterTol: 0.01, clusterMin: 4, liqDrainPct: 35, devDumpPct: 50 };
const DANGEROUS_EXT = { transferFeeConfig: 'transfer fee', permanentDelegate: 'permanent delegate (issuer can move your tokens)', transferHook: 'transfer hook', nonTransferable: 'non-transferable', defaultAccountState: 'accounts frozen by default', pausableConfig: 'issuer can pause transfers' };

const check = (id, label, critical, status, detail) => ({ id, label, critical, status, detail });
const pct = x => `${x.toFixed(1)}%`;

// inputs: mint (RPC parseMint or null), holders (sources.holders or null), info (GeckoTerminal token info or null),
// f (scanner features), hist (history rows), devStart (first dev holding % we saw), rug (RugCheck summary or null).
export function assessSecurity({ mint, holders, info, f = {}, hist = [], devStart = null, rug = null, limits = LIMITS }) {
  const out = [];
  // Authorities: the RPC mint account is authoritative; GeckoTerminal's flag is a second source.
  const auth = (key, label, why) => {
    if (mint) out.push(check(key, label, true, mint[key] ? 'fail' : 'pass', mint[key] ? `${why}: ${mint[key]}` : 'Revoked (on-chain)'));
    else if (info && info[key] != null) out.push(check(key, label, true, info[key] ? 'fail' : 'pass', info[key] ? why : 'Revoked (GeckoTerminal)'));
    else out.push(check(key, label, true, 'unknown', 'No mint data yet'));
  };
  auth('mintAuthority', 'Mint authority', 'Dev can print more supply');
  auth('freezeAuthority', 'Freeze authority', 'Dev can freeze your tokens');

  if (!mint) out.push(check('extensions', 'Token program', true, 'unknown', 'No mint data yet'));
  else {
    const bad = mint.program === TOKEN_2022 ? mint.extensions.filter(e => DANGEROUS_EXT[e]) : [];
    out.push(check('extensions', 'Token program', true, bad.length ? 'fail' : 'pass', bad.length ? `Token-2022 with ${bad.map(e => DANGEROUS_EXT[e]).join(', ')}` : mint.program === TOKEN_2022 ? 'Token-2022, no dangerous extensions' : 'Standard SPL token'));
  }
  if (info?.honeypot === true) out.push(check('honeypot', 'Honeypot', true, 'fail', 'GeckoTerminal flags this token as a honeypot'));

  // Holder concentration, excluding program-owned accounts (pool vaults, bonding curves, lockers).
  const wallets = holders?.filter(h => h.program === false && h.pct != null) || null;
  if (!wallets || !holders.length) {
    if (info?.top10Pct != null) out.push(check('top10', 'Top 10 holders', true, info.top10Pct > limits.top10Pct ? 'fail' : 'pass', `${pct(info.top10Pct)} (GeckoTerminal, includes pools)`));
    else out.push(check('top10', 'Top 10 holders', true, 'unknown', 'No holder data yet'));
    out.push(check('whale', 'Largest wallet', true, 'unknown', 'No holder data yet'));
    out.push(check('cluster', 'Insider clusters', false, 'unknown', 'No holder data yet'));
  } else {
    const top10 = wallets.slice(0, 10).reduce((a, h) => a + h.pct, 0), big = wallets[0];
    const progPct = holders.filter(h => h.program).reduce((a, h) => a + (h.pct || 0), 0);
    out.push(check('top10', 'Top 10 holders', true, top10 > limits.top10Pct ? 'fail' : 'pass', `${pct(top10)} in real wallets, ${pct(progPct)} in pools or programs`));
    out.push(check('whale', 'Largest wallet', true, big && big.pct > limits.whalePct ? 'fail' : 'pass', big ? `${pct(big.pct)} in ${big.owner.slice(0, 4)}…${big.owner.slice(-4)}` : 'No single wallet holds much'));
    // Bundled snipers often land the exact same amount in several fresh wallets.
    const sized = wallets.filter(h => h.pct >= 0.8);
    let cluster = 0;
    for (const a of sized) cluster = Math.max(cluster, sized.filter(b => Math.abs(b.amount - a.amount) <= a.amount * limits.clusterTol).length);
    out.push(check('cluster', 'Insider clusters', true, cluster >= limits.clusterMin ? 'fail' : cluster >= 3 ? 'warn' : 'pass',
      cluster >= 3 ? `${cluster} top wallets hold near-identical bags (likely bundled)` : 'No matching-bag wallet groups'));
  }

  if (f.liq == null) out.push(check('liquidity', 'Liquidity', true, 'unknown', 'No liquidity figure'));
  else out.push(check('liquidity', 'Liquidity', true, f.liq < limits.minLiq ? 'fail' : 'pass', `$${Math.round(f.liq).toLocaleString('en-US')}`));

  // History-based checks need a few snapshots; until then they are unknown but not gates.
  const recent = hist.filter(r => r[H.t] >= (hist.at(-1)?.[H.t] || 0) - 20 * 60000);
  if (recent.length < 3) out.push(check('liqDrain', 'Liquidity changes', false, 'unknown', 'Watching, not enough history yet'));
  else {
    const peak = Math.max(...recent.map(r => r[H.liq] || 0)), now = recent.at(-1)[H.liq] || 0;
    const drop = peak ? (1 - now / peak) * 100 : 0;
    out.push(check('liqDrain', 'Liquidity changes', true, drop >= limits.liqDrainPct ? 'fail' : drop >= 20 ? 'warn' : 'pass', drop >= 1 ? `Down ${pct(drop)} from its 20m peak` : 'Stable or growing'));
  }

  if (info?.devPct == null) out.push(check('dev', 'Dev wallet', false, 'unknown', info?.dev ? 'Dev holding unknown' : 'Dev wallet unknown'));
  else {
    const dumped = devStart != null && devStart >= 1 && info.devPct < devStart * (1 - limits.devDumpPct / 100);
    out.push(check('dev', 'Dev wallet', true, dumped ? 'fail' : info.devPct > 5 ? 'warn' : 'pass',
      dumped ? `Dev sold: ${pct(devStart)} to ${pct(info.devPct)} while we watched` : info.devPct === 0 ? 'Dev holds 0% (sold or never bought)' : `Dev holds ${pct(info.devPct)}`));
  }

  // Wash trading: lots of trades from very few unique wallets.
  const trades = (f.buys5m || 0) + (f.sells5m || 0), traders = f.buyers5m != null && f.sellers5m != null ? f.buyers5m + f.sellers5m : null;
  if (traders == null) out.push(check('wash', 'Wash trading', false, 'unknown', 'No unique-trader counts from this source'));
  else {
    const perWallet = traders ? trades / traders : 0;
    const wash = trades >= 30 && perWallet >= 5;
    out.push(check('wash', 'Wash trading', true, wash ? 'fail' : trades >= 20 && perWallet >= 3 ? 'warn' : 'pass', trades ? `${trades} trades from ${traders} wallets in 5m (${perWallet.toFixed(1)} each)` : 'No trades in 5m'));
  }

  // Abnormal activity: heavy dumping right now.
  if (f.sells5m != null && f.m5 != null) {
    const dumping = f.sells5m >= 3 * Math.max(1, f.buys5m || 0) && f.m5 <= -25;
    out.push(check('dump', 'Sell pressure', true, dumping ? 'fail' : f.m5 <= -15 ? 'warn' : 'pass', dumping ? `${f.sells5m} sells vs ${f.buys5m} buys, ${f.m5}% in 5m` : `${f.m5}% in 5m`));
  }

  if (rug) {
    const danger = rug.risks.filter(r => r.level === 'danger');
    out.push(check('rugcheck', 'RugCheck', true, danger.length ? 'fail' : rug.risks.some(r => r.level === 'warn') ? 'warn' : 'pass', danger.length ? danger.map(r => r.name).join(', ') : `Score ${rug.score ?? '?'}`));
    if (rug.lpLockedPct != null) out.push(check('lp', 'LP locked or burned', false, rug.lpLockedPct >= 80 ? 'pass' : 'warn', `${pct(rug.lpLockedPct)}`));
  }

  const crit = out.filter(c => c.critical);
  const status = crit.some(c => c.status === 'fail') ? 'fail' : crit.some(c => c.status === 'unknown') ? 'unverified' : 'pass';
  return { status, checks: out, fails: crit.filter(c => c.status === 'fail').map(c => c.label), warnings: out.filter(c => c.status === 'warn').map(c => c.label) };
}
