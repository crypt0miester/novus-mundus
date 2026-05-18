/**
 * RPC Helpers
 *
 * Thin helpers over `@solana/kit`'s RPC client for account fetching and
 * `getProgramAccounts` filtering. Used by the high-level client and by the
 * external-program helpers so they share one fetch/decoding path.
 */

import {
  type Address,
  type Commitment,
  type Rpc,
  type RpcSubscriptions,
  type SolanaRpcApi,
  type SolanaRpcSubscriptionsApi,
  type GetProgramAccountsMemcmpFilter,
  type GetProgramAccountsDatasizeFilter,
  fetchEncodedAccount,
  fetchEncodedAccounts,
  getBase64Encoder,
} from '@solana/kit';

/** A Solana RPC client as produced by `createSolanaRpc(url)`. */
export type SolanaRpc = Rpc<SolanaRpcApi>;

/** A Solana RPC subscriptions client as produced by `createSolanaRpcSubscriptions(url)`. */
export type SolanaRpcSubscriptions = RpcSubscriptions<SolanaRpcSubscriptionsApi>;

/** Minimal raw-account shape consumed by every `parseX` / `deserializeX`. */
export interface AccountData {
  data: Uint8Array;
}

/** A program account paired with its address. */
export interface ProgramAccount {
  pubkey: Address;
  data: Uint8Array;
}

const base64Encoder = getBase64Encoder();

/** Decode a base64 RPC data response into raw bytes. */
export function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(base64Encoder.encode(b64));
}

/** Fetch a single account's raw data, or `null` if it does not exist. */
export async function fetchAccount(
  rpc: SolanaRpc,
  address: Address,
  commitment?: Commitment
): Promise<AccountData | null> {
  const account = await fetchEncodedAccount(rpc, address, { commitment });
  return account.exists ? { data: new Uint8Array(account.data) } : null;
}

/** Fetch many accounts' raw data in one RPC round-trip, preserving order. */
export async function fetchAccounts(
  rpc: SolanaRpc,
  addresses: Address[],
  commitment?: Commitment
): Promise<(AccountData | null)[]> {
  const accounts = await fetchEncodedAccounts(rpc, addresses, { commitment });
  return accounts.map((a) => (a.exists ? { data: new Uint8Array(a.data) } : null));
}

/** Build a `memcmp` filter for `getProgramAccounts` from base58-encoded bytes. */
export function memcmpFilter(
  offset: number,
  base58Bytes: string
): GetProgramAccountsMemcmpFilter {
  return {
    memcmp: {
      offset: BigInt(offset),
      bytes: base58Bytes,
      encoding: 'base58',
    },
  } as GetProgramAccountsMemcmpFilter;
}

/** Build a `dataSize` filter for `getProgramAccounts`. */
export function dataSizeFilter(size: number): GetProgramAccountsDatasizeFilter {
  return { dataSize: BigInt(size) };
}

/** Fetch all accounts owned by a program, applying optional filters. */
export async function fetchProgramAccounts(
  rpc: SolanaRpc,
  programId: Address,
  filters: (GetProgramAccountsMemcmpFilter | GetProgramAccountsDatasizeFilter)[],
  commitment?: Commitment
): Promise<ProgramAccount[]> {
  const accounts = await rpc
    .getProgramAccounts(programId, { commitment, encoding: 'base64', filters })
    .send();
  return accounts.map(({ pubkey, account }) => ({
    pubkey,
    data: base64ToBytes(account.data[0]),
  }));
}
