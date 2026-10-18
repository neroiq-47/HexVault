// Donations: anyone can send 0.5 to 10 SOL to the agent wallet from the site. The server checks each one on chain
// before counting it, so a made-up signature or an out-of-range amount is never recorded.
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { DONATION_MIN_SOL, DONATION_MAX_SOL } from './config.js';

export async function verifyDonation(connection, signature, agentWallet) {
  if (typeof signature !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signature)) return { status: 'invalid', error: 'Not a transaction signature' };
  const tx = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
  if (!tx) return { status: 'pending' };
  if (tx.meta?.err) return { status: 'invalid', error: 'The transaction failed on chain' };
  const transfers = tx.transaction.message.instructions
    .filter(i => i.program === 'system' && i.parsed?.type === 'transfer' && i.parsed.info.destination === agentWallet);
  const lamports = transfers.reduce((a, i) => a + Number(i.parsed.info.lamports), 0);
  const sol = lamports / LAMPORTS_PER_SOL;
  if (!transfers.length) return { status: 'invalid', error: 'No SOL transfer to the agent wallet' };
  if (sol < DONATION_MIN_SOL - 1e-9 || sol > DONATION_MAX_SOL + 1e-9) return { status: 'invalid', error: `Donations count from ${DONATION_MIN_SOL} to ${DONATION_MAX_SOL} SOL` };
  return { status: 'ok', deposit: { ts: (tx.blockTime || 0) * 1000 || Date.now(), sol, from: transfers[0].parsed.info.source, signature } };
}
