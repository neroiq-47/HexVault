import test from 'node:test';
import assert from 'node:assert/strict';
import { newKeypair, loadKeypair, sendSol } from './wallet.js';

test('a new keypair round-trips through its base58 secret', () => {
  const kp = newKeypair();
  assert.equal(loadKeypair(kp.secret).publicKey.toBase58(), kp.publicKey);
});

test('sendSol refuses any destination off the allow-list', async () => {
  const keypair = loadKeypair(newKeypair().secret);
  let sent = false;
  await assert.rejects(sendSol({ connection: {}, keypair, to: newKeypair().publicKey, sol: 1, send: async () => { sent = true; } }), /allow-list/);
  assert.equal(sent, false);
});

test('sendSol transfers to the profit address', async () => {
  const keypair = loadKeypair(newKeypair().secret);
  let tx;
  const sig = await sendSol({ connection: {}, keypair, to: '5qmsMSPXoTWDfsEDLoo15ywoPLSiKB7zqRGR9dSVfQTA', sol: 0.5, send: async (_c, t) => { tx = t; return 'sig123'; } });
  assert.equal(sig, 'sig123');
  assert.equal(tx.instructions[0].keys[1].pubkey.toBase58(), '5qmsMSPXoTWDfsEDLoo15ywoPLSiKB7zqRGR9dSVfQTA');
});
