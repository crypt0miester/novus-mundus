// War Table thread-key providers.
//
// A ThreadKeyProvider hands the high-level WarTableClient the symmetric AEAD
// key for a (thread, version) pair, plus the thread's current key version.
// Two implementations ship: a LocalHmacKeyProvider (server / CLI / tests that
// hold K_master directly) and an HttpKeyProvider (browser, which never sees
// K_master and asks an authenticated key route instead).

import type { PublicKey } from '@solana/web3.js';

export interface ThreadKeyProvider {
  /** Return the 32-byte AEAD key for the given thread and version. */
  getKey(threadPda: PublicKey, version: number): Promise<Uint8Array>;
  /** Return the thread's current key version. */
  getCurrentVersion(threadPda: PublicKey): Promise<number>;
}

/** Thrown when the key route refuses a version the caller may not read. */
export class WtKeyForbiddenError extends Error {
  constructor(public version: number) {
    super(`key forbidden for version ${version}`);
    this.name = 'WtKeyForbiddenError';
  }
}

/** Thrown when the key route needs an authenticated session. */
export class WtAuthRequiredError extends Error {
  constructor() {
    super('war table: authentication required');
    this.name = 'WtAuthRequiredError';
  }
}
