/**
 * Game Account Subscription Helpers
 *
 * Specialized subscriptions for Novus Mundus game accounts.
 * Includes per-account subscriptions and a unified GameSubscriptionManager
 * that uses a single onProgramAccountChange with the AccountKey router.
 */

import { PublicKey } from '@solana/web3.js';
import type { Connection, Context, AccountInfo } from '@solana/web3.js';

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
} from './account';

// ============================================================
// Game Account Subscriptions
// ============================================================

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
export function subscribeToPlayer(
  connection: Connection,
  gameEngine: PublicKey,
  owner: PublicKey,
  callback: SubscriptionCallback<PlayerCore>,
  options: SubscriptionOptions = {}
): SubscriptionHandle {
  const [playerPda] = derivePlayerPda(gameEngine, owner);
  return subscribeToAccountWithParser(
    connection,
    playerPda,
    (data) => parsePlayer({ data, executable: false, lamports: 0, owner: PROGRAM_ID }),
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
export function subscribeToUser(
  connection: Connection,
  owner: PublicKey,
  callback: SubscriptionCallback<UserAccount>,
  options: SubscriptionOptions = {}
): SubscriptionHandle {
  const [userPda] = deriveUserPda(owner);
  return subscribeToAccountWithParser(
    connection,
    userPda,
    (data) => parseUser({ data, executable: false, lamports: 0, owner: PROGRAM_ID }),
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
export function subscribeToTeam(
  connection: Connection,
  gameEngine: PublicKey,
  teamId: number,
  callback: SubscriptionCallback<TeamAccount>,
  options: SubscriptionOptions = {}
): SubscriptionHandle {
  const [teamPda] = deriveTeamPda(gameEngine, teamId);
  return subscribeToAccountWithParser(
    connection,
    teamPda,
    (data) => parseTeam({ data, executable: false, lamports: 0, owner: PROGRAM_ID }),
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
export function subscribeToRally(
  connection: Connection,
  gameEngine: PublicKey,
  creator: PublicKey,
  rallyId: number,
  callback: SubscriptionCallback<RallyAccount>,
  options: SubscriptionOptions = {}
): SubscriptionHandle {
  const [rallyPda] = deriveRallyPda(gameEngine, creator, rallyId);
  return subscribeToAccountWithParser(
    connection,
    rallyPda,
    (data) => parseRally({ data, executable: false, lamports: 0, owner: PROGRAM_ID }),
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
export function subscribeToReinforcement(
  connection: Connection,
  gameEngine: PublicKey,
  sender: PublicKey,
  receiver: PublicKey,
  callback: SubscriptionCallback<ReinforcementAccount>,
  options: SubscriptionOptions = {}
): SubscriptionHandle {
  const [reinforcementPda] = deriveReinforcementPda(gameEngine, sender, receiver);
  return subscribeToAccountWithParser(
    connection,
    reinforcementPda,
    (data) => parseReinforcement({ data, executable: false, lamports: 0, owner: PROGRAM_ID }),
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
export function subscribeToEncounter(
  connection: Connection,
  gameEngine: PublicKey,
  cityId: number,
  encounterId: number,
  callback: SubscriptionCallback<EncounterAccount>,
  options: SubscriptionOptions = {}
): SubscriptionHandle {
  const [encounterPda] = deriveEncounterPda(gameEngine, cityId, encounterId);
  return subscribeToAccountWithParser(
    connection,
    encounterPda,
    (data) => parseEncounter({ data, executable: false, lamports: 0, owner: PROGRAM_ID }),
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
export function subscribeToExpedition(
  connection: Connection,
  owner: PublicKey,
  callback: SubscriptionCallback<ExpeditionAccount>,
  options: SubscriptionOptions = {}
): SubscriptionHandle {
  const [expeditionPda] = deriveExpeditionPda(owner);
  return subscribeToAccountWithParser(
    connection,
    expeditionPda,
    (data) => parseExpedition({ data, executable: false, lamports: 0, owner: PROGRAM_ID }),
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
export function subscribeToArenaSeason(
  connection: Connection,
  gameEngine: PublicKey,
  seasonId: number,
  callback: SubscriptionCallback<ArenaSeasonAccount>,
  options: SubscriptionOptions = {}
): SubscriptionHandle {
  const [seasonPda] = deriveArenaSeasonPda(gameEngine, seasonId);
  return subscribeToAccountWithParser(
    connection,
    seasonPda,
    (data) => parseArenaSeason({ data, executable: false, lamports: 0, owner: PROGRAM_ID }),
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
export function subscribeToArenaParticipant(
  connection: Connection,
  gameEngine: PublicKey,
  seasonId: number,
  player: PublicKey,
  callback: SubscriptionCallback<ArenaParticipantAccount>,
  options: SubscriptionOptions = {}
): SubscriptionHandle {
  const [arenaParticipantPda] = deriveArenaParticipantPda(gameEngine, seasonId, player);
  return subscribeToAccountWithParser(
    connection,
    arenaParticipantPda,
    (data) => parseArenaParticipant({ data, executable: false, lamports: 0, owner: PROGRAM_ID }),
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
export function subscribeToLoot(
  connection: Connection,
  playerPda: PublicKey,
  lootId: number | bigint,
  callback: SubscriptionCallback<LootAccount>,
  options: SubscriptionOptions = {}
): SubscriptionHandle {
  const [lootPda] = deriveLootPda(playerPda, lootId);
  return subscribeToAccountWithParser(
    connection,
    lootPda,
    (data) => parseLoot({ data, executable: false, lamports: 0, owner: PROGRAM_ID }),
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
export function subscribeToGameEngine(
  connection: Connection,
  kingdomId: number,
  callback: SubscriptionCallback<GameEngine>,
  options: SubscriptionOptions = {}
): SubscriptionHandle {
  const [gameEnginePda] = deriveGameEnginePda(kingdomId);
  return subscribeToAccountWithParser(
    connection,
    gameEnginePda,
    (data) => parseGameEngine({ data, executable: false, lamports: 0, owner: PROGRAM_ID }),
    callback,
    options
  );
}

// ============================================================
// Program-Wide Subscriptions
// ============================================================

/**
 * Subscribe to all Novus Mundus program account changes.
 *
 * @param connection - Solana connection
 * @param callback - Callback for program account changes
 * @param options - Subscription options with optional filters
 * @returns Subscription handle
 */
export function subscribeToAllGameAccounts(
  connection: Connection,
  callback: (data: { pubkey: PublicKey; accountInfo: AccountInfo<Buffer> }, context: Context) => void,
  options: SubscriptionOptions & {
    filters?: Array<{ memcmp: { offset: number; bytes: string } } | { dataSize: number }>;
  } = {}
): SubscriptionHandle {
  return subscribeToProgramAccounts(
    connection,
    PROGRAM_ID,
    (keyedAccountInfo, context) => {
      callback(
        {
          pubkey: keyedAccountInfo.accountId,
          accountInfo: {
            data: Buffer.from(keyedAccountInfo.accountInfo.data),
            executable: keyedAccountInfo.accountInfo.executable,
            lamports: keyedAccountInfo.accountInfo.lamports,
            owner: keyedAccountInfo.accountInfo.owner,
            rentEpoch: keyedAccountInfo.accountInfo.rentEpoch,
          },
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
 * @param connection - Solana connection
 * @param callback - Callback for transaction logs
 * @param options - Subscription options
 * @returns Subscription handle
 */
export function subscribeToGameLogs(
  connection: Connection,
  callback: LogsCallback,
  options: SubscriptionOptions = {}
): SubscriptionHandle {
  return subscribeToLogs(connection, PROGRAM_ID, callback, options);
}

// ============================================================
// Subscription Manager
// ============================================================

/** Handler callback for a specific AccountKey */
export type AccountHandler<T = unknown> = (
  account: T,
  pubkey: PublicKey,
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
  private connection: Connection;
  private gameEngine: PublicKey;
  private handlers: Map<AccountKey, Set<AccountHandler>> = new Map();
  private subscription: SubscriptionHandle | null = null;
  private options: SubscriptionOptions;

  constructor(
    connection: Connection,
    gameEngine: PublicKey,
    options: SubscriptionOptions = {}
  ) {
    this.connection = connection;
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
      this.connection,
      PROGRAM_ID,
      (keyedAccountInfo, context) => {
        const data = keyedAccountInfo.accountInfo.data;
        if (!data || data.length === 0) {
          return;
        }

        const routed = tryDeserializeAnyAccount(Buffer.from(data));
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
