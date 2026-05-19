/**
 * Game Account Subscription Helpers
 *
 * Specialized subscriptions for Novus Mundus game accounts.
 * Includes per-account subscriptions and a unified GameSubscriptionManager
 * that uses a single onProgramAccountChange with the AccountKey router.
 */

import type { Address } from '@solana/kit';
import type { SolanaRpcSubscriptions } from '../rpc';

import { PROGRAM_ID } from '../program';
import {
  derivePlayerPda,
  deriveUserPda,
  deriveTeamPda,
  deriveRallyPda,
  deriveReinforcementPda,
  deriveEncounterPda,
  deriveExpeditionPda,
  deriveArenaSeasonPda,
  deriveArenaParticipantPda,
  deriveLootPda,
  deriveGameEnginePda,
} from '../pda';

import { parsePlayer, type PlayerCore } from '../state/player';
import { parseUser, type UserAccount } from '../state/user';
import { parseTeam, type TeamAccount } from '../state/team';
import { parseRally, type RallyAccount } from '../state/rally';
import { parseReinforcement, type ReinforcementAccount } from '../state/reinforcement';
import { parseEncounter, type EncounterAccount } from '../state/encounter';
import { parseExpedition, type ExpeditionAccount } from '../state/expedition';
import { parseArenaSeason, parseArenaParticipant, type ArenaSeasonAccount, type ArenaParticipantAccount } from '../state/arena';
import { parseLoot, type LootAccount } from '../state/loot';
import { parseGameEngine, type GameEngine } from '../state/game-engine';
import { AccountKey } from '../types/enums';
import { tryDeserializeAnyAccount, type RoutedAccount } from '../state/router';

import {
  subscribeToAccountWithParser,
  subscribeToProgramAccounts,
  subscribeToLogs,
  type SubscriptionHandle,
  type SubscriptionCallback,
  type SubscriptionOptions,
  type LogsCallback,
  type Context,
  type RawAccountInfo,
} from './account';

// Game Account Subscriptions

/**
 * Subscribe to player account changes.
 *
 * @param connection - Solana connection
 * @param gameEngine - GameEngine PDA
 * @param owner - Player wallet pubkey
 * @param callback - Callback for player account changes
 * @param options - Subscription options
 * @returns Subscription handle
 */
export async function subscribeToPlayer(
  rpcSubscriptions: SolanaRpcSubscriptions,
  gameEngine: Address,
  owner: Address,
  callback: SubscriptionCallback<PlayerCore>,
  options: SubscriptionOptions = {}
): Promise<SubscriptionHandle> {
  const [playerPda] = await derivePlayerPda(gameEngine, owner);
  return subscribeToAccountWithParser(
    rpcSubscriptions,
    playerPda,
    (data) => parsePlayer({ data }),
    callback,
    options
  );
}

/**
 * Subscribe to user account changes.
 *
 * @param connection - Solana connection
 * @param owner - User wallet pubkey
 * @param callback - Callback for user account changes
 * @param options - Subscription options
 * @returns Subscription handle
 */
export async function subscribeToUser(
  rpcSubscriptions: SolanaRpcSubscriptions,
  owner: Address,
  callback: SubscriptionCallback<UserAccount>,
  options: SubscriptionOptions = {}
): Promise<SubscriptionHandle> {
  const [userPda] = await deriveUserPda(owner);
  return subscribeToAccountWithParser(
    rpcSubscriptions,
    userPda,
    (data) => parseUser({ data }),
    callback,
    options
  );
}

/**
 * Subscribe to team account changes.
 *
 * @param connection - Solana connection
 * @param gameEngine - GameEngine PDA
 * @param teamId - Team ID
 * @param callback - Callback for team account changes
 * @param options - Subscription options
 * @returns Subscription handle
 */
export async function subscribeToTeam(
  rpcSubscriptions: SolanaRpcSubscriptions,
  gameEngine: Address,
  teamId: number,
  callback: SubscriptionCallback<TeamAccount>,
  options: SubscriptionOptions = {}
): Promise<SubscriptionHandle> {
  const [teamPda] = await deriveTeamPda(gameEngine, teamId);
  return subscribeToAccountWithParser(
    rpcSubscriptions,
    teamPda,
    (data) => parseTeam({ data }),
    callback,
    options
  );
}

/**
 * Subscribe to rally account changes.
 *
 * @param connection - Solana connection
 * @param gameEngine - GameEngine PDA
 * @param creator - Rally creator pubkey
 * @param rallyId - Rally ID for this creator
 * @param callback - Callback for rally account changes
 * @param options - Subscription options
 * @returns Subscription handle
 */
export async function subscribeToRally(
  rpcSubscriptions: SolanaRpcSubscriptions,
  gameEngine: Address,
  creator: Address,
  rallyId: number,
  callback: SubscriptionCallback<RallyAccount>,
  options: SubscriptionOptions = {}
): Promise<SubscriptionHandle> {
  const [rallyPda] = await deriveRallyPda(gameEngine, creator, rallyId);
  return subscribeToAccountWithParser(
    rpcSubscriptions,
    rallyPda,
    (data) => parseRally({ data }),
    callback,
    options
  );
}

/**
 * Subscribe to reinforcement account changes.
 *
 * @param connection - Solana connection
 * @param gameEngine - GameEngine PDA
 * @param sender - Sender pubkey
 * @param receiver - Receiver pubkey
 * @param callback - Callback for reinforcement account changes
 * @param options - Subscription options
 * @returns Subscription handle
 */
export async function subscribeToReinforcement(
  rpcSubscriptions: SolanaRpcSubscriptions,
  gameEngine: Address,
  sender: Address,
  receiver: Address,
  callback: SubscriptionCallback<ReinforcementAccount>,
  options: SubscriptionOptions = {}
): Promise<SubscriptionHandle> {
  const [reinforcementPda] = await deriveReinforcementPda(gameEngine, sender, receiver);
  return subscribeToAccountWithParser(
    rpcSubscriptions,
    reinforcementPda,
    (data) => parseReinforcement({ data }),
    callback,
    options
  );
}

/**
 * Subscribe to encounter account changes.
 *
 * @param connection - Solana connection
 * @param gameEngine - GameEngine PDA
 * @param cityId - City ID
 * @param encounterId - Encounter ID
 * @param callback - Callback for encounter account changes
 * @param options - Subscription options
 * @returns Subscription handle
 */
export async function subscribeToEncounter(
  rpcSubscriptions: SolanaRpcSubscriptions,
  gameEngine: Address,
  cityId: number,
  encounterId: number,
  callback: SubscriptionCallback<EncounterAccount>,
  options: SubscriptionOptions = {}
): Promise<SubscriptionHandle> {
  const [encounterPda] = await deriveEncounterPda(gameEngine, cityId, encounterId);
  return subscribeToAccountWithParser(
    rpcSubscriptions,
    encounterPda,
    (data) => parseEncounter({ data }),
    callback,
    options
  );
}

/**
 * Subscribe to expedition account changes.
 *
 * @param connection - Solana connection
 * @param owner - Player pubkey (owner of the expedition)
 * @param callback - Callback for expedition account changes
 * @param options - Subscription options
 * @returns Subscription handle
 */
export async function subscribeToExpedition(
  rpcSubscriptions: SolanaRpcSubscriptions,
  owner: Address,
  callback: SubscriptionCallback<ExpeditionAccount>,
  options: SubscriptionOptions = {}
): Promise<SubscriptionHandle> {
  const [expeditionPda] = await deriveExpeditionPda(owner);
  return subscribeToAccountWithParser(
    rpcSubscriptions,
    expeditionPda,
    (data) => parseExpedition({ data }),
    callback,
    options
  );
}

/**
 * Subscribe to arena season account changes.
 *
 * @param connection - Solana connection
 * @param gameEngine - GameEngine PDA
 * @param seasonId - Season ID
 * @param callback - Callback for arena season account changes
 * @param options - Subscription options
 * @returns Subscription handle
 */
export async function subscribeToArenaSeason(
  rpcSubscriptions: SolanaRpcSubscriptions,
  gameEngine: Address,
  seasonId: number,
  callback: SubscriptionCallback<ArenaSeasonAccount>,
  options: SubscriptionOptions = {}
): Promise<SubscriptionHandle> {
  const [seasonPda] = await deriveArenaSeasonPda(gameEngine, seasonId);
  return subscribeToAccountWithParser(
    rpcSubscriptions,
    seasonPda,
    (data) => parseArenaSeason({ data }),
    callback,
    options
  );
}

/**
 * Subscribe to arena participant account changes.
 *
 * @param connection - Solana connection
 * @param gameEngine - GameEngine PDA
 * @param seasonId - Season ID
 * @param player - Player pubkey
 * @param callback - Callback for arena participant account changes
 * @param options - Subscription options
 * @returns Subscription handle
 */
export async function subscribeToArenaParticipant(
  rpcSubscriptions: SolanaRpcSubscriptions,
  gameEngine: Address,
  seasonId: number,
  player: Address,
  callback: SubscriptionCallback<ArenaParticipantAccount>,
  options: SubscriptionOptions = {}
): Promise<SubscriptionHandle> {
  const [arenaParticipantPda] = await deriveArenaParticipantPda(gameEngine, seasonId, player);
  return subscribeToAccountWithParser(
    rpcSubscriptions,
    arenaParticipantPda,
    (data) => parseArenaParticipant({ data }),
    callback,
    options
  );
}

/**
 * Subscribe to loot account changes.
 *
 * @param connection - Solana connection
 * @param playerPda - Player PDA pubkey
 * @param lootId - Loot ID (from player.lootCounter)
 * @param callback - Callback for loot account changes
 * @param options - Subscription options
 * @returns Subscription handle
 */
export async function subscribeToLoot(
  rpcSubscriptions: SolanaRpcSubscriptions,
  playerPda: Address,
  lootId: number | bigint,
  callback: SubscriptionCallback<LootAccount>,
  options: SubscriptionOptions = {}
): Promise<SubscriptionHandle> {
  const [lootPda] = await deriveLootPda(playerPda, lootId);
  return subscribeToAccountWithParser(
    rpcSubscriptions,
    lootPda,
    (data) => parseLoot({ data }),
    callback,
    options
  );
}

/**
 * Subscribe to game engine account changes.
 *
 * @param connection - Solana connection
 * @param kingdomId - Kingdom ID
 * @param callback - Callback for game engine account changes
 * @param options - Subscription options
 * @returns Subscription handle
 */
export async function subscribeToGameEngine(
  rpcSubscriptions: SolanaRpcSubscriptions,
  kingdomId: number,
  callback: SubscriptionCallback<GameEngine>,
  options: SubscriptionOptions = {}
): Promise<SubscriptionHandle> {
  const [gameEnginePda] = await deriveGameEnginePda(kingdomId);
  return subscribeToAccountWithParser(
    rpcSubscriptions,
    gameEnginePda,
    (data) => parseGameEngine({ data }),
    callback,
    options
  );
}

// Program-Wide Subscriptions

/**
 * Subscribe to all Novus Mundus program account changes.
 *
 * @param rpcSubscriptions - Solana RPC subscriptions client
 * @param callback - Callback for program account changes
 * @param options - Subscription options with optional filters
 * @returns Subscription handle
 */
export function subscribeToAllGameAccounts(
  rpcSubscriptions: SolanaRpcSubscriptions,
  callback: (data: { pubkey: Address; accountInfo: RawAccountInfo }, context: Context) => void,
  options: SubscriptionOptions & {
    filters?: Array<{ memcmp: { offset: number; bytes: string } } | { dataSize: number }>;
  } = {}
): SubscriptionHandle {
  return subscribeToProgramAccounts(
    rpcSubscriptions,
    PROGRAM_ID,
    (keyedAccountInfo, context) => {
      callback(
        {
          pubkey: keyedAccountInfo.accountId,
          accountInfo: keyedAccountInfo.accountInfo,
        },
        context
      );
    },
    options
  );
}

/**
 * Subscribe to Novus Mundus transaction logs.
 *
 * @param rpcSubscriptions - Solana RPC subscriptions client
 * @param callback - Callback for transaction logs
 * @param options - Subscription options
 * @returns Subscription handle
 */
export function subscribeToGameLogs(
  rpcSubscriptions: SolanaRpcSubscriptions,
  callback: LogsCallback,
  options: SubscriptionOptions = {}
): SubscriptionHandle {
  return subscribeToLogs(rpcSubscriptions, PROGRAM_ID, callback, options);
}

// Subscription Manager

/** Handler callback for a specific AccountKey */
export type AccountHandler<T = unknown> = (
  account: T,
  pubkey: Address,
  context: Context
) => void;

/**
 * Unified game subscription manager using a single `onProgramAccountChange`.
 *
 * Instead of creating one WebSocket subscription per account, this manager
 * uses a single program-wide subscription and routes incoming account updates
 * to registered handlers based on the AccountKey discriminator (byte 0).
 *
 * Usage:
 * ```ts
 * const manager = new GameSubscriptionManager(connection, gameEnginePda);
 * manager.on(AccountKey.Player, (player, pubkey, ctx) => { ... });
 * manager.on(AccountKey.Encounter, (encounter, pubkey, ctx) => { ... });
 * manager.start();
 * // later:
 * manager.stop();
 * ```
 */
export class GameSubscriptionManager {
  private rpcSubscriptions: SolanaRpcSubscriptions;
  private gameEngine: Address;
  private handlers: Map<AccountKey, Set<AccountHandler>> = new Map();
  private subscription: SubscriptionHandle | null = null;
  private options: SubscriptionOptions;

  constructor(
    rpcSubscriptions: SolanaRpcSubscriptions,
    gameEngine: Address,
    options: SubscriptionOptions = {}
  ) {
    this.rpcSubscriptions = rpcSubscriptions;
    this.gameEngine = gameEngine;
    this.options = options;
  }

  /**
   * Register a handler for a specific AccountKey.
   * Multiple handlers can be registered per key.
   */
  on<K extends AccountKey>(
    key: K,
    handler: AccountHandler<Extract<RoutedAccount, { key: K }>['account']>
  ): void {
    let set = this.handlers.get(key);
    if (!set) {
      set = new Set();
      this.handlers.set(key, set);
    }
    set.add(handler as AccountHandler);
  }

  /**
   * Remove a handler for a specific AccountKey.
   */
  off<K extends AccountKey>(
    key: K,
    handler: AccountHandler<Extract<RoutedAccount, { key: K }>['account']>
  ): void {
    const set = this.handlers.get(key);
    if (set) {
      set.delete(handler as AccountHandler);
      if (set.size === 0) {
        this.handlers.delete(key);
      }
    }
  }

  /**
   * Start the program-wide subscription.
   * All program account changes flow through a single WebSocket.
   */
  start(): void {
    if (this.subscription) {
      return; // already running
    }

    this.subscription = subscribeToProgramAccounts(
      this.rpcSubscriptions,
      PROGRAM_ID,
      (keyedAccountInfo, context) => {
        const data = keyedAccountInfo.accountInfo.data;
        if (!data || data.length === 0) {
          return;
        }

        const routed = tryDeserializeAnyAccount(data);
        if (!routed) {
          return;
        }

        const handlers = this.handlers.get(routed.key);
        if (!handlers || handlers.size === 0) {
          return;
        }

        const pubkey = keyedAccountInfo.accountId;
        for (const handler of handlers) {
          try {
            handler(routed.account, pubkey, context);
          } catch {
            // swallow handler errors to not break subscription
          }
        }
      },
      this.options
    );
  }

  /**
   * Stop the program-wide subscription.
   */
  async stop(): Promise<void> {
    if (this.subscription) {
      await this.subscription.unsubscribe();
      this.subscription = null;
    }
  }

  /**
   * Check if the subscription is active.
   */
  get active(): boolean {
    return this.subscription !== null;
  }

  /**
   * Remove all handlers and stop the subscription.
   */
  async destroy(): Promise<void> {
    await this.stop();
    this.handlers.clear();
  }

  /**
   * Get the set of AccountKeys that have registered handlers.
   */
  getRegisteredKeys(): AccountKey[] {
    return Array.from(this.handlers.keys());
  }
}
