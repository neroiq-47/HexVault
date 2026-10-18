// Runtime configuration. This version trades on paper and only touches devnet or testnet on-chain.
export const ALLOWED_DESTINATIONS = Object.freeze(['5qmsMSPXoTWDfsEDLoo15ywoPLSiKB7zqRGR9dSVfQTA']);
const CLUSTERS = { devnet: 'https://api.devnet.solana.com', testnet: 'https://api.testnet.solana.com' };

export function loadConfig(env = process.env) {
  const cluster = (env.SOLANA_CLUSTER || 'devnet').trim();
  if (!CLUSTERS[cluster]) throw new Error(`SOLANA_CLUSTER must be devnet or testnet (got "${cluster}"); mainnet is not enabled in this version`);
  const rpcUrl = (env.SOLANA_RPC_URL || '').trim() || CLUSTERS[cluster];
  if (/mainnet/i.test(rpcUrl)) throw new Error('SOLANA_RPC_URL points at mainnet; this version only runs on devnet or testnet');
  const profitAddress = (env.PROFIT_ADDRESS || ALLOWED_DESTINATIONS[0]).trim();
  if (!ALLOWED_DESTINATIONS.includes(profitAddress)) throw new Error('PROFIT_ADDRESS is not on the allow-list');
  const riskLevel = (env.RISK_LEVEL || 'med').trim();
  if (!['low', 'med', 'high'].includes(riskLevel)) throw new Error('RISK_LEVEL must be low, med or high');
  const adminSecret = env.ADMIN_SECRET || '';
  return {
    cluster, rpcUrl, profitAddress, riskLevel, adminSecret,
    agentWalletSecret: env.AGENT_WALLET_SECRET || '',
    anthropicKey: env.ANTHROPIC_API_KEY || '',
    agentModel: env.AGENT_MODEL || 'claude-haiku-5-5',
    roundSeconds: Math.max(60, Number(env.ROUND_SECONDS) || 300),
    startUsd: Number(env.START_USD) || 100,
    dataPath: env.DATA_PATH || './data/state.json',
    port: Number(env.PORT) || 3000,
  };
}
