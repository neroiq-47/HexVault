import { loadConfig } from './config.js';
import { newKeypair, loadKeypair, connect, airdrop, balanceSol } from './wallet.js';
import { fetchMarket as fetchDex } from './market.js';
import { makeSignalSource } from './methods.js';
import { makeBrain } from './agents.js';
import { createDesk } from './desk.js';

const cmd = process.argv[2];
if (cmd === 'wallet-new') {
  const kp = newKeypair();
  console.log(`Agent wallet public key: ${kp.publicKey}`);
  console.log(`Secret key (set as AGENT_WALLET_SECRET in Railway, never commit or share it):\n${kp.secret}`);
} else if (cmd === 'airdrop') {
  const config = loadConfig();
  const kp = loadKeypair(config.agentWalletSecret);
  if (!kp) throw new Error('Set AGENT_WALLET_SECRET first');
  const conn = connect(config.rpcUrl);
  console.log('airdrop signature', await airdrop(conn, kp.publicKey.toBase58(), 1));
  console.log('balance', await balanceSol(conn, kp.publicKey.toBase58()), 'SOL on', config.cluster);
} else if (cmd === 'round') {
  const config = loadConfig();
  const attachSignals = makeSignalSource();
  const fetchMarket = async () => attachSignals(await fetchDex());
  const desk = createDesk({ config, fetchMarket, brain: makeBrain({ apiKey: config.anthropicKey, model: config.agentModel, backups: config.backups }), wallet: null, log: (...a) => console.log(...a) });
  const s = await desk.cycle();
  console.log(JSON.stringify(s.lastRound ?? s.lastError, null, 2));
} else {
  console.log('Usage: node src/cli.js wallet-new | airdrop | round');
}
