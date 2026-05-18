/**
 * Account Subscription Helpers
 *
 * WebSocket subscriptions for real-time account updates.
 *
 * Migrated to `@solana/kit`: kit replaces web3.js's callback model
 * (`onAccountChange` → numeric id, `removeAccountChangeListener(id)`) with an
 * `RpcSubscriptions` client that yields async iterables. Each `subscribeToX`
 * here opens an iterable in a detached async task and pumps notifications into
 * the supplied callback; the returned handle's `unsubscribe()` aborts it.
 */

import { getBase64Encoder } from '@solana/kit';
import type { Address, Commitment } from '@solana/kit';
import type { SolanaRpcSubscriptions } from '../rpc';

const base64Encoder = getBase64Encoder();

/** Decode a base64 RPC data response into raw bytes. */
function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(base64Encoder.encode(b64));
}

// Types

/**
 * Notification context — the slot at which the change was observed.
 *
 * kit has no single `Context` type; this captures the field that callers
 * relied on from web3.js's `Context`.
 */
export interface Context {
  /** Slot at which the update was observed. */
  slot: number;
}

/** Raw account payload delivered to subscription callbacks. */
export interface RawAccountInfo {
  /** Raw account data bytes. */
  data: Uint8Array;
  /** Address of the program that owns the account. */
  owner: Address;
  /** Lamports held by the account. */
  lamports: bigint;
  /** Whether the account contains an executable program. */
  executable: boolean;
}

/** Subscription callback for parsed account data */
export type SubscriptionCallback<T> = (
  data: T | null,
  context: Context
) => void;

/** Raw account change callback */
export type RawSubscriptionCallback = (
  accountInfo: RawAccountInfo | null,
  context: Context
) => void;

/** Subscription handle for cleanup */
export interface SubscriptionHandle {
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
 * @param rpcSubscriptions - Solana RPC subscriptions client
 * @param address - Account address
 * @param callback - Callback for account changes
 * @param options - Subscription options
 * @returns Subscription handle for cleanup
 */
export function subscribeToAccount(
  rpcSubscriptions: SolanaRpcSubscriptions,
  address: Address,
  callback: RawSubscriptionCallback,
  options: SubscriptionOptions = {}
): SubscriptionHandle {
  const commitment = options.commitment ?? 'confirmed';
  const abortController = new AbortController();

  (async () => {
    try {
      const notifications = await rpcSubscriptions
        .accountNotifications(address, { commitment, encoding: 'base64' })
        .subscribe({ abortSignal: abortController.signal });

      for await (const notification of notifications) {
        const context: Context = { slot: Number(notification.context.slot) };
        const value = notification.value;
        if (!value) {
          callback(null, context);
          continue;
        }
        callback(
          {
            data: base64ToBytes(value.data[0]),
            owner: value.owner,
            lamports: BigInt(value.lamports),
            executable: value.executable,
          },
          context
        );
      }
    } catch (e) {
      if (!abortController.signal.aborted) {
        // Surface unexpected subscription failures.
        console.error('Account subscription error:', e);
      }
    }
  })();

  return {
    unsubscribe: async () => {
      abortController.abort();
    },
  };
}

/**
 * Subscribe to account changes with automatic parsing.
 *
 * @param rpcSubscriptions - Solana RPC subscriptions client
 * @param address - Account address
 * @param parser - Function to parse account data
 * @param callback - Callback for parsed account data
 * @param options - Subscription options
 * @returns Subscription handle for cleanup
 */
export function subscribeToAccountWithParser<T>(
  rpcSubscriptions: SolanaRpcSubscriptions,
  address: Address,
  parser: (data: Uint8Array) => T | null,
  callback: SubscriptionCallback<T>,
  options: SubscriptionOptions = {}
): SubscriptionHandle {
  const rawCallback: RawSubscriptionCallback = (accountInfo, context) => {
    if (!accountInfo || !accountInfo.data) {
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

  return subscribeToAccount(rpcSubscriptions, address, rawCallback, options);
}

// Multi-Account Subscriptions

/** Multi-subscription handle */
export interface MultiSubscriptionHandle {
  /** All subscription keys */
  ids: number[];
  /** Unsubscribe from all */
  unsubscribeAll: () => Promise<void>;
  /** Add a new subscription, returns its key */
  add: (handle: SubscriptionHandle) => number;
  /** Remove a subscription by key */
  remove: (id: number) => Promise<void>;
}

/**
 * Create a multi-subscription manager.
 *
 * @returns Multi-subscription handle
 */
export function createMultiSubscription(): MultiSubscriptionHandle {
  const handles: Map<number, SubscriptionHandle> = new Map();
  let nextId = 0;

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
      const id = nextId++;
      handles.set(id, handle);
      return id;
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
 * @param rpcSubscriptions - Solana RPC subscriptions client
 * @param addresses - Account addresses
 * @param callback - Callback for each account change (receives address as first param)
 * @param options - Subscription options
 * @returns Multi-subscription handle
 */
export function subscribeToAccounts(
  rpcSubscriptions: SolanaRpcSubscriptions,
  addresses: Address[],
  callback: (address: Address, accountInfo: RawAccountInfo | null, context: Context) => void,
  options: SubscriptionOptions = {}
): MultiSubscriptionHandle {
  const multi = createMultiSubscription();

  for (const address of addresses) {
    const handle = subscribeToAccount(
      rpcSubscriptions,
      address,
      (accountInfo, context) => callback(address, accountInfo, context),
      options
    );
    multi.add(handle);
  }

  return multi;
}

// Program Account Subscriptions

/** Keyed account payload delivered to program-account callbacks. */
export interface KeyedAccountInfo {
  /** Address of the changed account. */
  accountId: Address;
  /** Raw account contents. */
  accountInfo: RawAccountInfo;
}

/** Program account change callback */
export type ProgramSubscriptionCallback = (
  keyedAccountInfo: KeyedAccountInfo,
  context: Context
) => void;

/**
 * Subscribe to all accounts owned by a program.
 *
 * @param rpcSubscriptions - Solana RPC subscriptions client
 * @param programId - Program address
 * @param callback - Callback for program account changes
 * @param options - Subscription options with optional filters
 * @returns Subscription handle
 */
export function subscribeToProgramAccounts(
  rpcSubscriptions: SolanaRpcSubscriptions,
  programId: Address,
  callback: ProgramSubscriptionCallback,
  options: SubscriptionOptions & {
    filters?: Array<{ memcmp: { offset: number; bytes: string } } | { dataSize: number }>;
  } = {}
): SubscriptionHandle {
  const commitment = options.commitment ?? 'confirmed';
  const abortController = new AbortController();

  (async () => {
    try {
      const notifications = await rpcSubscriptions
        .programNotifications(programId, { commitment, encoding: 'base64' })
        .subscribe({ abortSignal: abortController.signal });

      for await (const notification of notifications) {
        const context: Context = { slot: Number(notification.context.slot) };
        const { pubkey, account } = notification.value;
        callback(
          {
            accountId: pubkey,
            accountInfo: {
              data: base64ToBytes(account.data[0]),
              owner: account.owner,
              lamports: BigInt(account.lamports),
              executable: account.executable,
            },
          },
          context
        );
      }
    } catch (e) {
      if (!abortController.signal.aborted) {
        console.error('Program account subscription error:', e);
      }
    }
  })();

  return {
    unsubscribe: async () => {
      abortController.abort();
    },
  };
}

// Slot and Root Subscriptions

/** Slot change callback */
export type SlotChangeCallback = (slotInfo: { slot: number; parent: number; root: number }) => void;

/**
 * Subscribe to slot changes.
 *
 * @param rpcSubscriptions - Solana RPC subscriptions client
 * @param callback - Callback for slot changes
 * @returns Subscription handle
 */
export function subscribeToSlotChanges(
  rpcSubscriptions: SolanaRpcSubscriptions,
  callback: SlotChangeCallback
): SubscriptionHandle {
  const abortController = new AbortController();

  (async () => {
    try {
      const notifications = await rpcSubscriptions
        .slotNotifications()
        .subscribe({ abortSignal: abortController.signal });

      for await (const notification of notifications) {
        callback({
          slot: Number(notification.slot),
          parent: Number(notification.parent),
          root: Number(notification.root),
        });
      }
    } catch (e) {
      if (!abortController.signal.aborted) {
        console.error('Slot subscription error:', e);
      }
    }
  })();

  return {
    unsubscribe: async () => {
      abortController.abort();
    },
  };
}

/**
 * Subscribe to root changes (finalized slots).
 *
 * @param rpcSubscriptions - Solana RPC subscriptions client
 * @param callback - Callback for root changes
 * @returns Subscription handle
 */
export function subscribeToRootChanges(
  rpcSubscriptions: SolanaRpcSubscriptions,
  callback: (root: number) => void
): SubscriptionHandle {
  const abortController = new AbortController();

  (async () => {
    try {
      const notifications = await rpcSubscriptions
        .rootNotifications()
        .subscribe({ abortSignal: abortController.signal });

      for await (const notification of notifications) {
        callback(Number(notification));
      }
    } catch (e) {
      if (!abortController.signal.aborted) {
        console.error('Root subscription error:', e);
      }
    }
  })();

  return {
    unsubscribe: async () => {
      abortController.abort();
    },
  };
}

// Signature Subscriptions

/** Transaction error, or `null` if the transaction succeeded. */
export interface SignatureResult {
  /** Error if the transaction failed, `null` otherwise. */
  err: unknown;
}

/** Signature status callback */
export type SignatureStatusCallback = (
  result: SignatureResult,
  context: Context
) => void;

/**
 * Subscribe to transaction signature status.
 *
 * @param rpcSubscriptions - Solana RPC subscriptions client
 * @param signature - Transaction signature (base58-encoded)
 * @param callback - Callback for signature status
 * @param options - Subscription options
 * @returns Subscription handle
 */
export function subscribeToSignature(
  rpcSubscriptions: SolanaRpcSubscriptions,
  signature: string,
  callback: SignatureStatusCallback,
  options: SubscriptionOptions = {}
): SubscriptionHandle {
  const commitment = options.commitment ?? 'confirmed';
  const abortController = new AbortController();

  (async () => {
    try {
      const notifications = await rpcSubscriptions
        // `signatureNotifications` expects a base58 `Signature`; a plain string
        // is accepted at runtime, so we widen via `as never` for the typed API.
        .signatureNotifications(signature as never, { commitment })
        .subscribe({ abortSignal: abortController.signal });

      for await (const notification of notifications) {
        const context: Context = { slot: Number(notification.context.slot) };
        const value = notification.value;
        const err =
          value && typeof value === 'object' && 'err' in value
            ? (value as { err: unknown }).err
            : null;
        callback({ err }, context);
      }
    } catch (e) {
      if (!abortController.signal.aborted) {
        console.error('Signature subscription error:', e);
      }
    }
  })();

  return {
    unsubscribe: async () => {
      abortController.abort();
    },
  };
}

/**
 * Wait for transaction confirmation.
 *
 * @param rpcSubscriptions - Solana RPC subscriptions client
 * @param signature - Transaction signature
 * @param commitment - Commitment level
 * @param timeout - Timeout in milliseconds
 * @returns Promise that resolves when confirmed or rejects on timeout/error
 */
export function waitForSignature(
  rpcSubscriptions: SolanaRpcSubscriptions,
  signature: string,
  commitment: Commitment = 'confirmed',
  timeout: number = 60000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      void handle.unsubscribe();
      reject(new Error('Transaction confirmation timeout'));
    }, timeout);

    const handle = subscribeToSignature(
      rpcSubscriptions,
      signature,
      (result) => {
        clearTimeout(timeoutId);
        void handle.unsubscribe();

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

/** Transaction logs payload delivered to log callbacks. */
export interface Logs {
  /** Transaction signature (base58-encoded). */
  signature: string;
  /** Error if the transaction failed, `null` otherwise. */
  err: unknown;
  /** Log messages emitted by the transaction. */
  logs: string[];
}

/** Log callback */
export type LogsCallback = (
  logs: Logs,
  context: Context
) => void;

/**
 * Subscribe to transaction logs for a program.
 *
 * @param rpcSubscriptions - Solana RPC subscriptions client
 * @param programIdOrAll - Program address or 'all' or 'allWithVotes'
 * @param callback - Callback for logs
 * @param options - Subscription options
 * @returns Subscription handle
 */
export function subscribeToLogs(
  rpcSubscriptions: SolanaRpcSubscriptions,
  programIdOrAll: Address | 'all' | 'allWithVotes',
  callback: LogsCallback,
  options: SubscriptionOptions = {}
): SubscriptionHandle {
  const commitment = options.commitment ?? 'confirmed';
  const abortController = new AbortController();

  (async () => {
    try {
      // kit's `logsNotifications` takes either `'all'`/`'allWithVotes'` or a
      // `{ mentions: [Address] }` filter; web3.js accepted the address directly.
      const notifications =
        programIdOrAll === 'all'
          ? await rpcSubscriptions
              .logsNotifications('all', { commitment })
              .subscribe({ abortSignal: abortController.signal })
          : programIdOrAll === 'allWithVotes'
            ? await rpcSubscriptions
                .logsNotifications('allWithVotes', { commitment })
                .subscribe({ abortSignal: abortController.signal })
            : await rpcSubscriptions
                .logsNotifications(
                  { mentions: [programIdOrAll as Address] },
                  { commitment }
                )
                .subscribe({ abortSignal: abortController.signal });

      for await (const notification of notifications) {
        const context: Context = { slot: Number(notification.context.slot) };
        const value = notification.value;
        callback(
          {
            signature: value.signature,
            err: value.err,
            logs: [...value.logs],
          },
          context
        );
      }
    } catch (e) {
      if (!abortController.signal.aborted) {
        console.error('Logs subscription error:', e);
      }
    }
  })();

  return {
    unsubscribe: async () => {
      abortController.abort();
    },
  };
}
