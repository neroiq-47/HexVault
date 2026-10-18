import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './config.js';

test('defaults to devnet and the allow-listed profit address', () => {
  const c = loadConfig({});
  assert.equal(c.cluster, 'devnet');
  assert.equal(c.profitAddress, '5qmsMSPXoTWDfsEDLoo15ywoPLSiKB7zqRGR9dSVfQTA');
});

test('refuses mainnet and unknown payout addresses', () => {
  assert.throws(() => loadConfig({ SOLANA_CLUSTER: 'mainnet-beta' }), /devnet or testnet/);
  assert.throws(() => loadConfig({ SOLANA_RPC_URL: 'https://mainnet.helius-rpc.com/?api-key=x' }), /mainnet/);
  assert.throws(() => loadConfig({ PROFIT_ADDRESS: '11111111111111111111111111111111' }), /allow-list/);
});
