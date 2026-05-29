// Local HMAC thread-key provider.
//
// Holds K_master directly and derives keys via the section 4 KDF. Suitable for
// the web server, the CLI, and LiteSVM tests. The current version is resolved
// through an injected callback so the provider does not depend on a Connection
// type; `makeEpochResolver` is the standard resolver that reads the thread
// account's discriminator and routes to the right membership_epoch field.

import type { Connection, PublicKey } from '@solana/web3.js';
import { AccountKey } from '../types/enums';
import { deserializeTeam } from '../state/team';
import { deserializeRally } from '../state/rally';
import { deserializeCastle } from '../state/castle';
import { deriveThreadKey, WtScope } from '../crypto/wartable';
import type { ThreadKeyProvider } from './index';

export class LocalHmacKeyProvider implements ThreadKeyProvider {
  // Derived keys are deterministic in (thread, version), so reading a thread of
  // N same-version messages recomputes the identical HMAC N times without this.
  private readonly cache = new Map<string, Uint8Array>();

  constructor(
    private readonly masterSecret: Uint8Array,
    private readonly resolveEpoch: (threadPda: PublicKey) => Promise<number>,
  ) {}

  async getKey(threadPda: PublicKey, version: number): Promise<Uint8Array> {
    const cacheKey = `${threadPda.toBase58()}:${version}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    const key = deriveThreadKey(this.masterSecret, threadPda, version);
    this.cache.set(cacheKey, key);
    return key;
  }

  async getCurrentVersion(threadPda: PublicKey): Promise<number> {
    return this.resolveEpoch(threadPda);
  }
}

/**
 * Build the standard epoch resolver. Reads the thread account, dispatches on
 * its first (discriminator) byte, and returns the matching membership_epoch.
 * DM threads have no on-chain account; their version is the constant 1.
 *
 * A scope hint is required for DM threads (no account exists to read), so when
 * the account is absent the resolver returns 1 only if the hint is Dm. For
 * Encounter threads the version is always 0.
 */
export function makeEpochResolver(
  connection: Connection,
  scopeHint?: WtScope,
): (threadPda: PublicKey) => Promise<number> {
  return async (threadPda: PublicKey): Promise<number> => {
    if (scopeHint === WtScope.Dm) return 1;
    if (scopeHint === WtScope.Encounter) return 0;

    const info = await connection.getAccountInfo(threadPda);
    if (!info || info.data.length === 0) {
      // No on-chain account and the scope hint is not DM (handled above):
      // there is nothing to read an epoch from.
      throw new Error(`thread account ${threadPda.toBase58()} not found and scope hint is not DM`);
    }

    const discriminator = info.data[0]!;
    switch (discriminator) {
      case AccountKey.Team:
        return deserializeTeam(info.data).membershipEpoch;
      case AccountKey.Rally:
        return deserializeRally(info.data).membershipEpoch;
      case AccountKey.Castle:
        return deserializeCastle(info.data).membershipEpoch;
      case AccountKey.Encounter:
        return 0;
      default:
        throw new Error(`unsupported war-table thread discriminator ${discriminator}`);
    }
  };
}
