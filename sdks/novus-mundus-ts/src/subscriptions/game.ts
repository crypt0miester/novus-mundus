/**
 * Game Account Subscription Helpers
 *
 * Specialized subscriptions for Novus Mundus game accounts.
 */

import { PublicKey } from '@solana/web3.js';
import type { Connection, Context, AccountInfo } from '@solana/web3.js';

import { PROGRAM_ID } from '../program.ts';
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
} from '../pda.ts';

import { parsePlayer, type PlayerCore } from '../state/player.ts';
import { parseUser, type UserAccount } from '../state/user.ts';
import { parseTeam, type TeamAccount } from '../state/team.ts';
import { parseRally, type RallyAccount } from '../state/rally.ts';
import { parseReinforcement, type ReinforcementAccount } from '../state/reinforcement.ts';
import { parseEncounter, type EncounterAccount } from '../state/encounter.ts';
import { parseExpedition, type ExpeditionAccount } from '../state/expedition.ts';
import { parseArenaSeason, parseArenaParticipant, type ArenaSeasonAccount, type ArenaParticipantAccount } from '../state/arena.ts';
import { parseLoot, type LootAccount } from '../state/loot.ts';
import { parseGameEngine, type GameEngine } from '../state/game-engine.ts';

import {
  subscribeToAccountWithParser,
  subscribeToProgramAccounts,
  subscribeToLogs,
  type SubscriptionHandle,
  type SubscriptionCallback,
  type SubscriptionOptions,
  type LogsCallback,
} from './account.ts';

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
 * @param encounter - Encounter pubkey
 * @param attacker - Attacker pubkey
 * @param callback - Callback for loot account changes
 * @param options - Subscription options
 * @returns Subscription handle
 */
export function subscribeToLoot(
  connection: Connection,
  encounter: PublicKey,
  attacker: PublicKey,
  callback: SubscriptionCallback<LootAccount>,
  options: SubscriptionOptions = {}
): SubscriptionHandle {
  const [lootPda] = deriveLootPda(encounter, attacker);
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

/**
 * Game subscription manager for managing multiple subscriptions.
 */
export class GameSubscriptionManager {
  private connection: Connection;
  private gameEngine: PublicKey;
  private subscriptions: Map<string, SubscriptionHandle> = new Map();

  constructor(connection: Connection, gameEngine: PublicKey) {
    this.connection = connection;
    this.gameEngine = gameEngine;
  }

  /**
   * Subscribe to a player account.
   */
  subscribeToPlayer(
    owner: PublicKey,
    callback: SubscriptionCallback<PlayerCore>,
    options?: SubscriptionOptions
  ): string {
    const key = `player:${owner.toBase58()}`;
    const handle = subscribeToPlayer(this.connection, this.gameEngine, owner, callback, options);
    this.subscriptions.set(key, handle);
    return key;
  }

  /**
   * Subscribe to a user account.
   */
  subscribeToUser(
    owner: PublicKey,
    callback: SubscriptionCallback<UserAccount>,
    options?: SubscriptionOptions
  ): string {
    const key = `user:${owner.toBase58()}`;
    const handle = subscribeToUser(this.connection, owner, callback, options);
    this.subscriptions.set(key, handle);
    return key;
  }

  /**
   * Subscribe to a team account.
   */
  subscribeToTeam(
    teamId: number,
    callback: SubscriptionCallback<TeamAccount>,
    options?: SubscriptionOptions
  ): string {
    const key = `team:${teamId}`;
    const handle = subscribeToTeam(this.connection, this.gameEngine, teamId, callback, options);
    this.subscriptions.set(key, handle);
    return key;
  }

  /**
   * Subscribe to a rally account.
   */
  subscribeToRally(
    creator: PublicKey,
    rallyId: number,
    callback: SubscriptionCallback<RallyAccount>,
    options?: SubscriptionOptions
  ): string {
    const key = `rally:${creator.toBase58()}:${rallyId}`;
    const handle = subscribeToRally(this.connection, this.gameEngine, creator, rallyId, callback, options);
    this.subscriptions.set(key, handle);
    return key;
  }

  /**
   * Subscribe to an encounter account.
   */
  subscribeToEncounter(
    cityId: number,
    encounterId: number,
    callback: SubscriptionCallback<EncounterAccount>,
    options?: SubscriptionOptions
  ): string {
    const key = `encounter:${cityId}:${encounterId}`;
    const handle = subscribeToEncounter(this.connection, this.gameEngine, cityId, encounterId, callback, options);
    this.subscriptions.set(key, handle);
    return key;
  }

  /**
   * Unsubscribe by key.
   */
  async unsubscribe(key: string): Promise<boolean> {
    const handle = this.subscriptions.get(key);
    if (handle) {
      await handle.unsubscribe();
      this.subscriptions.delete(key);
      return true;
    }
    return false;
  }

  /**
   * Unsubscribe from all subscriptions.
   */
  async unsubscribeAll(): Promise<void> {
    const promises = Array.from(this.subscriptions.values()).map((h) => h.unsubscribe());
    await Promise.all(promises);
    this.subscriptions.clear();
  }

  /**
   * Get all active subscription keys.
   */
  getActiveSubscriptions(): string[] {
    return Array.from(this.subscriptions.keys());
  }

  /**
   * Check if a subscription is active.
   */
  isSubscribed(key: string): boolean {
    return this.subscriptions.has(key);
  }
}
