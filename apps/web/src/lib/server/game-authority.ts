import "server-only";
import { Connection, Keypair } from "@solana/web3.js";
import { NovusMundusClient } from "novus-mundus-sdk";
import { getBase58Encoder } from "@solana/codecs-strings";

// v3 base58 codec (replaces bs58). Naming is inverted vs the bs58 package:
//   bs58.decode(b58str) -> bytes  ===  getBase58Encoder().encode(b58str)
const base58Encoder = getBase58Encoder();

/**
 * Server-only configuration + the `game_authority` signing key.
 *
 * This module reads the game_authority secret key. It must NEVER be imported
 * into a client component — it lives under `lib/server/` and is used only by
 * the `/api/cosign/*` route handlers (Node runtime).
 */

const RPC_URL = process.env.RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8899";

export const KINGDOM_ID = Number(process.env.KINGDOM_ID ?? process.env.NEXT_PUBLIC_KINGDOM_ID ?? 0);

/** Accepts either a base58 secret key or a JSON byte array (Solana CLI format). */
function decodeSecretKey(raw: string): Uint8Array {
  const s = raw.trim();
  if (s.startsWith("[")) return Uint8Array.from(JSON.parse(s) as number[]);
  return new Uint8Array(base58Encoder.encode(s));
}

let cachedKeypair: Keypair | null = null;

/**
 * The game_authority keypair. Throws if `GAME_AUTHORITY_SECRET_KEY` is unset.
 *
 * v3: `Keypair.fromSecretKey` is async, so this is async too.
 */
export async function gameAuthorityKeypair(): Promise<Keypair> {
  if (cachedKeypair) return cachedKeypair;
  const raw = process.env.GAME_AUTHORITY_SECRET_KEY;
  if (!raw) {
    throw new Error(
      "GAME_AUTHORITY_SECRET_KEY is not set — the co-sign API cannot operate. " +
        "Set it to the secret key (base58 or JSON byte array) of the keypair " +
        "stored in GameEngine.game_authority for this kingdom.",
    );
  }
  cachedKeypair = await Keypair.fromSecretKey(decodeSecretKey(raw));
  return cachedKeypair;
}

let cachedConnection: Connection | null = null;

export function serverConnection(): Connection {
  if (!cachedConnection) cachedConnection = new Connection(RPC_URL, "confirmed");
  return cachedConnection;
}

let cachedClient: NovusMundusClient | null = null;

export function serverClient(): NovusMundusClient {
  if (!cachedClient) {
    cachedClient = new NovusMundusClient({
      connection: serverConnection(),
      kingdomId: KINGDOM_ID,
    });
  }
  return cachedClient;
}
