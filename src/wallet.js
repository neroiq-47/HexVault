// Agent wallet on devnet/testnet. The key comes from the environment and is never logged or served.
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import { ALLOWED_DESTINATIONS } from './config.js';

export function loadKeypair(secret) {
  if (!secret) return null;
  const s = secret.trim();
  const bytes = s.startsWith('[') ? Uint8Array.from(JSON.parse(s)) : bs58.decode(s);
  return Keypair.fromSecretKey(bytes);
}

export function newKeypair() {
  const kp = Keypair.generate();
  return { publicKey: kp.publicKey.toBase58(), secret: bs58.encode(kp.secretKey) };
}

export const connect = rpcUrl => new Connection(rpcUrl, 'confirmed');

export async function balanceSol(connection, pubkey) {
  return (await connection.getBalance(new PublicKey(pubkey))) / LAMPORTS_PER_SOL;
}

// The only outbound transfer in the bot. It refuses any destination outside the allow-list.
export async function sendSol({ connection, keypair, to, sol, send = sendAndConfirmTransaction }) {
  if (!ALLOWED_DESTINATIONS.includes(to)) throw new Error('destination is not on the allow-list');
  const lamports = Math.floor(sol * LAMPORTS_PER_SOL);
  if (!(lamports > 0)) throw new Error('nothing to send');
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey: new PublicKey(to), lamports }));
  return send(connection, tx, [keypair]);
}

export async function airdrop(connection, pubkey, sol = 1) {
  const sig = await connection.requestAirdrop(new PublicKey(pubkey), Math.floor(sol * LAMPORTS_PER_SOL));
  await connection.confirmTransaction(sig, 'confirmed');
  return sig;
}
