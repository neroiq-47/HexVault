import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './config.js';

const LIVE = { TRADING_MODE: 'live', JUPITER_API_KEY: 'k', FLOAT_SOL: '0.5', AGENT_WALLET_SECRET: 's' };

test('paper mode defaults to devnet and the allow-listed profit address', () => {
  const c = loadConfig({});
  assert.equal(c.mode, 'paper');
  assert.equal(c.cluster, 'devnet');
  assert.equal(c.profitAddress, '5qmsMSPXoTWDfsEDLoo15ywoPLSiKB7zqRGR9dSVfQTA');
});

test('live mode defaults to mainnet and needs a Jupiter key, a float and a wallet', () => {
  assert.equal(loadConfig(LIVE).cluster, 'mainnet-beta');
  assert.throws(() => loadConfig({ ...LIVE, JUPITER_API_KEY: '' }), /JUPITER_API_KEY/);
  assert.throws(() => loadConfig({ ...LIVE, FLOAT_SOL: '' }), /FLOAT_SOL/);
  assert.throws(() => loadConfig({ ...LIVE, AGENT_WALLET_SECRET: '' }), /AGENT_WALLET_SECRET/);
  assert.throws(() => loadConfig({ ...LIVE, SOLANA_CLUSTER: 'devnet' }), /mainnet-beta/);
});

test('refuses unknown modes and payout addresses, and bounds the drawdown stop', () => {
  assert.throws(() => loadConfig({ TRADING_MODE: 'yolo' }), /TRADING_MODE/);
  assert.throws(() => loadConfig({ PROFIT_ADDRESS: '11111111111111111111111111111111' }), /allow-list/);
  assert.equal(loadConfig({ MAX_DRAWDOWN: '0.9' }).maxDrawdown, 0.5);
  assert.equal(loadConfig({}).maxDrawdown, 0.2);
});
