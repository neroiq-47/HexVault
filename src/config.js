// Runtime configuration. TRADING_MODE decides whether trades are paper, shadow (real quotes, nothing sent) or live.
export const ALLOWED_DESTINATIONS = Object.freeze(['5qmsMSPXoTWDfsEDLoo15ywoPLSiKB7zqRGR9dSVfQTA']);
const CLUSTERS = { devnet: 'https://api.devnet.solana.com', testnet: 'https://api.testnet.solana.com', 'mainnet-beta': 'https://api.mainnet-beta.solana.com' };
export const MODES = Object.freeze(['paper', 'shadow', 'live']);
export const DONATION_MIN_SOL = 0.5, DONATION_MAX_SOL = 10;

export function loadConfig(env = process.env) {
  const mode = (env.TRADING_MODE || 'paper').trim();
  if (!MODES.includes(mode)) throw new Error('TRADING_MODE must be paper, shadow or live');
  const cluster = (env.SOLANA_CLUSTER || (mode === 'paper' ? 'devnet' : 'mainnet-beta')).trim();
  if (!CLUSTERS[cluster]) throw new Error(`SOLANA_CLUSTER must be devnet, testnet or mainnet-beta (got "${cluster}")`);
  if (mode !== 'paper' && cluster !== 'mainnet-beta') throw new Error(`TRADING_MODE=${mode} needs SOLANA_CLUSTER=mainnet-beta; Jupiter only routes on mainnet`);
  const rpcUrl = (env.SOLANA_RPC_URL || '').trim() || CLUSTERS[cluster];
  const profitAddress = (env.PROFIT_ADDRESS || ALLOWED_DESTINATIONS[0]).trim();
  if (!ALLOWED_DESTINATIONS.includes(profitAddress)) throw new Error('PROFIT_ADDRESS is not on the allow-list');
  const riskLevel = (env.RISK_LEVEL || 'med').trim();
  if (!['low', 'med', 'high'].includes(riskLevel)) throw new Error('RISK_LEVEL must be low, med or high');
  const floatSol = Number(env.FLOAT_SOL) || 0;
  const jupiterKey = (env.JUPITER_API_KEY || '').trim();
  const agentWalletSecret = env.AGENT_WALLET_SECRET || '';
  if (mode !== 'paper') {
    if (!jupiterKey) throw new Error(`TRADING_MODE=${mode} needs JUPITER_API_KEY`);
    if (!(floatSol > 0)) throw new Error(`TRADING_MODE=${mode} needs FLOAT_SOL, the starting float in SOL`);
    if (!agentWalletSecret) throw new Error(`TRADING_MODE=${mode} needs AGENT_WALLET_SECRET`);
  }
  return {
    mode, cluster, rpcUrl, profitAddress, riskLevel, floatSol, jupiterKey, agentWalletSecret,
    adminSecret: env.ADMIN_SECRET || '',
    donations: (env.DONATIONS || 'off').trim() === 'on',
    anthropicKey: env.ANTHROPIC_API_KEY || '',
    agentModel: env.AGENT_MODEL || 'claude-haiku-5-5',
    backups: [
      { name: 'gemini', key: (env.GEMINI_API_KEY || '').trim(), model: env.GEMINI_MODEL || undefined },
      { name: 'groq', key: (env.GROQ_API_KEY || '').trim(), model: env.GROQ_MODEL || undefined },
    ].filter(b => b.key),
    roundSeconds: Math.max(60, Number(env.ROUND_SECONDS) || 300),
    startUsd: Number(env.START_USD) || 100,
    maxDrawdown: Math.min(0.5, Math.max(0.05, Number(env.MAX_DRAWDOWN) || 0.2)),
    dataPath: env.DATA_PATH || './data/state.json',
    port: Number(env.PORT) || 3000,
  };
}
