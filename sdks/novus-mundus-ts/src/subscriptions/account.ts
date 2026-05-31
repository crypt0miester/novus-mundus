/**
 * Account Subscription Helpers
 *
 * WebSocket subscriptions for real-time account updates.
 */

import { PublicKey } from '@solana/web3.js';
import type { Connection, AccountInfoWithSpace, Context, Commitment, SignatureResult, KeyedAccountInfo, Logs } from '@solana/web3.js';

// Types

/** Subscription callback for parsed account data */
export type SubscriptionCallback<T> = (
  data: T | null,
  context: Context
) => void;

/**
 * Raw account change callback.
 *
 * v3 delivers a non-nullable `AccountInfoWithSpace<Uint8Array>` (the binary
 * encoding); account data is `Uint8Array`, lamports/rentEpoch/space are bigint.
 */
export type RawSubscriptionCallback = (
  accountInfo: AccountInfoWithSpace<Uint8Array>,
  context: Context
) => void;

/** Subscription handle for cleanup */
export interface SubscriptionHandle {
  /** Subscription ID */
  id: number;
  /** Unsubscribe function */
  unsubscribe: () => Promise<void>;
}

/** Subscription options */
export interface SubscriptionOptions {
  /** Commitment level */
  commitment?: Commitment;
  /** Optional encoding (defaults to 'base64') */
  encoding?: 'base64' | 'base64+zstd' | 'jsonParsed';
}

// Core Subscription Functions

/**
 * Subscribe to raw account changes.
 *
 * @param connection - Solana connection
 * @param address - Account public key
 * @param callback - Callback for account changes
 * @param options - Subscription options
 * @returns Subscription handle for cleanup
 */
export function subscribeToAccount(
  connection: Connection,
  address: PublicKey,
  callback: RawSubscriptionCallback,
  options: SubscriptionOptions = {}
): SubscriptionHandle {
  const commitment = options.commitment ?? 'confirmed';

  const id = connection.onAccountChange(
    address,
    callback,
    commitment
  );

  return {
    id,
    unsubscribe: () => connection.removeAccountChangeListener(id),
  };
}

/**
 * Subscribe to account changes with automatic parsing.
 *
 * @param connection - Solana connection
 * @param address - Account public key
 * @param parser - Function to parse account data
 * @param callback - Callback for parsed account data
 * @param options - Subscription options
 * @returns Subscription handle for cleanup
 */
export function subscribeToAccountWithParser<T>(
  connection: Connection,
  address: PublicKey,
  parser: (data: Uint8Array) => T | null,
  callback: SubscriptionCallback<T>,
  options: SubscriptionOptions = {}
): SubscriptionHandle {
  const rawCallback: RawSubscriptionCallback = (accountInfo, context) => {
    if (!accountInfo.data || accountInfo.data.length === 0) {
      callback(null, context);
      return;
    }

    try {
      const parsed = parser(accountInfo.data);
      callback(parsed, context);
    } catch {
      callback(null, context);
    }
  };

  return subscribeToAccount(connection, address, rawCallback, options);
}

// Multi-Account Subscriptions

/** Multi-subscription handle */
export interface MultiSubscriptionHandle {
  /** All subscription IDs */
  ids: number[];
  /** Unsubscribe from all */
  unsubscribeAll: () => Promise<void>;
  /** Add a new subscription */
  add: (handle: SubscriptionHandle) => void;
  /** Remove a subscription by ID */
  remove: (id: number) => Promise<void>;
}

/**
 * Create a multi-subscription manager.
 *
 * @returns Multi-subscription handle
 */
export function createMultiSubscription(): MultiSubscriptionHandle {
  const handles: Map<number, SubscriptionHandle> = new Map();

  return {
    get ids() {
      return Array.from(handles.keys());
    },
    async unsubscribeAll() {
      const promises = Array.from(handles.values()).map((h) => h.unsubscribe());
      await Promise.all(promises);
      handles.clear();
    },
    add(handle: SubscriptionHandle) {
      handles.set(handle.id, handle);
    },
    async remove(id: number) {
      const handle = handles.get(id);
      if (handle) {
        await handle.unsubscribe();
        handles.delete(id);
      }
    },
  };
}

/**
 * Subscribe to multiple accounts at once.
 *
 * @param connection - Solana connection
 * @param addresses - Account addresses
 * @param callback - Callback for each account change (receives address as first param)
 * @param options - Subscription options
 * @returns Multi-subscription handle
 */
export function subscribeToAccounts(
  connection: Connection,
  addresses: PublicKey[],
  callback: (address: PublicKey, accountInfo: AccountInfoWithSpace<Uint8Array>, context: Context) => void,
  options: SubscriptionOptions = {}
): MultiSubscriptionHandle {
  const multi = createMultiSubscription();

  for (const address of addresses) {
    const handle = subscribeToAccount(
      connection,
      address,
      (accountInfo, context) => callback(address, accountInfo, context),
      options
    );
    multi.add(handle);
  }

  return multi;
}

// Program Account Subscriptions

/** Program account change callback */
export type ProgramSubscriptionCallback = (
  keyedAccountInfo: KeyedAccountInfo,
  context: Context
) => void;

/**
 * Subscribe to all accounts owned by a program.
 *
 * @param connection - Solana connection
 * @param programId - Program public key
 * @param callback - Callback for program account changes
 * @param options - Subscription options with optional filters
 * @returns Subscription handle
 */
export function subscribeToProgramAccounts(
  connection: Connection,
  programId: PublicKey,
  callback: ProgramSubscriptionCallback,
  options: SubscriptionOptions & {
    filters?: Array<{ memcmp: { offset: number; bytes: string } } | { dataSize: number }>;
  } = {}
): SubscriptionHandle {
  const commitment = options.commitment ?? 'confirmed';

  const id = connection.onProgramAccountChange(
    programId,
    callback,
    commitment,
    options.filters
  );

  return {
    id,
    unsubscribe: () => connection.removeProgramAccountChangeListener(id),
  };
}

// Slot and Root Subscriptions

/** Slot change callback (v3 SlotInfo fields are bigint) */
export type SlotChangeCallback = (slotInfo: { slot: bigint; parent: bigint; root: bigint }) => void;

/**
 * Subscribe to slot changes.
 *
 * @param connection - Solana connection
 * @param callback - Callback for slot changes
 * @returns Subscription handle
 */
export function subscribeToSlotChanges(
  connection: Connection,
  callback: SlotChangeCallback
): SubscriptionHandle {
  const id = connection.onSlotChange(callback);

  return {
    id,
    unsubscribe: () => connection.removeSlotChangeListener(id),
  };
}

/**
 * Subscribe to root changes (finalized slots).
 *
 * @param connection - Solana connection
 * @param callback - Callback for root changes
 * @returns Subscription handle
 */
export function subscribeToRootChanges(
  connection: Connection,
  callback: (root: bigint) => void
): SubscriptionHandle {
  const id = connection.onRootChange(callback);

  return {
    id,
    unsubscribe: () => connection.removeRootChangeListener(id),
  };
}

// Signature Subscriptions

/** Signature status callback */
export type SignatureStatusCallback = (
  result: SignatureResult,
  context: Context
) => void;

/**
 * Subscribe to transaction signature status.
 *
 * @param connection - Solana connection
 * @param signature - Transaction signature
 * @param callback - Callback for signature status
 * @param options - Subscription options
 * @returns Subscription handle
 */
export function subscribeToSignature(
  connection: Connection,
  signature: string,
  callback: SignatureStatusCallback,
  options: SubscriptionOptions = {}
): SubscriptionHandle {
  const commitment = options.commitment ?? 'confirmed';

  const id = connection.onSignature(
    signature,
    callback,
    commitment
  );

  return {
    id,
    unsubscribe: () => connection.removeSignatureListener(id),
  };
}

/**
 * Wait for transaction confirmation.
 *
 * @param connection - Solana connection
 * @param signature - Transaction signature
 * @param commitment - Commitment level
 * @param timeout - Timeout in milliseconds
 * @returns Promise that resolves when confirmed or rejects on timeout/error
 */
export function waitForSignature(
  connection: Connection,
  signature: string,
  commitment: Commitment = 'confirmed',
  timeout: number = 60000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      handle.unsubscribe();
      reject(new Error('Transaction confirmation timeout'));
    }, timeout);

    const handle = subscribeToSignature(
      connection,
      signature,
      (result) => {
        clearTimeout(timeoutId);
        handle.unsubscribe();

        if (result.err) {
          reject(new Error(`Transaction failed: ${JSON.stringify(result.err)}`));
        } else {
          resolve();
        }
      },
      { commitment }
    );
  });
}

// Logs Subscriptions

/** Log callback */
export type LogsCallback = (
  logs: Logs,
  context: Context
) => void;

/**
 * Subscribe to transaction logs for a program.
 *
 * @param connection - Solana connection
 * @param programIdOrAll - Program ID or 'all' or 'allWithVotes'
 * @param callback - Callback for logs
 * @param options - Subscription options
 * @returns Subscription handle
 */
export function subscribeToLogs(
  connection: Connection,
  programIdOrAll: PublicKey | 'all' | 'allWithVotes',
  callback: LogsCallback,
  options: SubscriptionOptions = {}
): SubscriptionHandle {
  const commitment = options.commitment ?? 'confirmed';

  // web3.js onLogs accepts PublicKey | 'all' | 'allWithVotes' directly
  const id = connection.onLogs(programIdOrAll, callback, commitment);

  return {
    id,
    unsubscribe: () => connection.removeOnLogsListener(id),
  };
}
