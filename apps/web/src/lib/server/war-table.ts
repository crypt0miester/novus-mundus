import "server-only";
import { createHmac } from "node:crypto";

/**
 * War-table thread-key derivation (server side).
 *
 * The master secret never leaves the server: the `/api/wt/key/[thread]` route
 * derives a per-thread, per-version key with this KDF and serves only the
 * versions a SIWS-authenticated caller is entitled to (see the join-gate logic
 * in the route). The byte layout below is the single canonical KDF and MUST
 * match the SDK's `deriveThreadKey` (node:crypto and @noble/hashes produce
 * identical HMAC-SHA256 output for identical message bytes).
 *
 * Trust ceiling: there is NO forward secrecy. Ciphertext is permanent on a
 * public ledger, so any future compromise of WT_MASTER_SECRET retroactively
 * decrypts every message ever sent and cannot be revoked. This is a conscious
 * tradeoff for game-strategy chat; see docs/WAR_TABLE_DESIGN.md.
 */

function loadMaster(): Buffer {
  const raw = process.env.WT_MASTER_SECRET;
  if (!raw) {
    throw new Error(
      "WT_MASTER_SECRET is not set. The war-table key API cannot operate. " +
        "Set it to a 32-byte hex secret (64 hex chars). Generate: openssl rand -hex 32",
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      "WT_MASTER_SECRET must be exactly 64 hex characters (32 bytes).",
    );
  }
  return Buffer.from(raw, "hex");
}

// Loaded once at module init. Throws at import time if the secret is absent or
// malformed, so a misconfigured deploy fails fast rather than serving garbage
// keys. Reject at the parse boundary; no fallback secret.
const MASTER: Buffer = loadMaster();

/**
 * K_thread = HMAC-SHA256(K_master, msg)
 *
 * msg (39 bytes, exact order):
 *   bytes 0..3   = b"wt1"  (3 bytes)
 *   bytes 3..35  = thread_pda (32 raw public-key bytes)
 *   bytes 35..39 = version as u32 LE (4 bytes)
 *
 * Output is the full 32-byte HMAC-SHA256 digest.
 */
export function deriveThreadKey(threadPda: Uint8Array, version: number): Uint8Array {
  if (threadPda.length !== 32) {
    throw new Error("threadPda must be exactly 32 bytes");
  }
  const msg = Buffer.alloc(3 + 32 + 4);
  msg.write("wt1", 0, "ascii");
  Buffer.from(threadPda).copy(msg, 3);
  msg.writeUInt32LE(version >>> 0, 35);
  return createHmac("sha256", MASTER).update(msg).digest();
}
