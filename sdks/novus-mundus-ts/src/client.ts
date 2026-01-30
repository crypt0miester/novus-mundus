/**
 * Novus Mundus Client
 *
 * High-level client for interacting with the Novus Mundus program.
 * Provides account fetching, transaction building, and simulation utilities.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  Keypair,
  VersionedTransaction,
  TransactionMessage,
} from '@solana/web3.js';
import type {
  Commitment,
  SendOptions,
  AddressLookupTableAccount,
} from '@solana/web3.js';
import BN from 'bn.js';
import { PROGRAM_ID } from './program.ts';
import {
  derivePlayerPda,
  deriveTeamPda,
  deriveRallyPda,
  deriveReinforcementPda,
  deriveExpeditionPda,
  deriveLootPda,
  deriveGameEnginePda,
  deriveCityPda,
  deriveEncounterPda,
  deriveUserPda,
  deriveArenaSeasonPda,
  deriveArenaParticipantPda,
  deriveShopConfigPda,
} from './pda.ts';
import { parseGameEngine } from './state/game-engine.ts';
import type { GameEngine } from './state/game-engine.ts';
import { parsePlayer } from './state/player.ts';
import type { PlayerAccount } from './state/player.ts';
import { parseTeam } from './state/team.ts';
import type { TeamAccount } from './state/team.ts';
import { parseRally } from './state/rally.ts';
import type { RallyAccount } from './state/rally.ts';
import { parseReinforcement } from './state/reinforcement.ts';
import type { ReinforcementAccount } from './state/reinforcement.ts';
import { parseExpedition } from './state/expedition.ts';
import type { ExpeditionAccount } from './state/expedition.ts';
import { parseLoot } from './state/loot.ts';
import type { LootAccount } from './state/loot.ts';
import { parseCity } from './state/city.ts';
import type { CityAccount } from './state/city.ts';
import { parseEncounter } from './state/encounter.ts';
import type { EncounterAccount } from './state/encounter.ts';
import { parseUser } from './state/user.ts';
import type { UserAccount } from './state/user.ts';
import { parseArenaSeason, parseArenaParticipant } from './state/arena.ts';
import type { ArenaSeasonAccount, ArenaParticipantAccount } from './state/arena.ts';
import { parseShopConfig } from './state/shop.ts';
import type { ShopConfigAccount } from './state/shop.ts';
import { parseEventsFromLogs } from './events/index.ts';
import type { NovusMundusEvent } from './events/index.ts';
import { parseTeamMemberSlot, parseTeamInvite, TEAM_MEMBER_SLOT_SIZE, TEAM_INVITE_ACCOUNT_SIZE } from './state/team.ts';
import type { TeamMemberSlot, TeamInviteAccount } from './state/team.ts';
import { parseRallyParticipant, RALLY_ACCOUNT_SIZE, RALLY_PARTICIPANT_SIZE } from './state/rally.ts';
import type { RallyParticipant } from './state/rally.ts';
import { LOOT_ACCOUNT_SIZE } from './state/loot.ts';
import { ENCOUNTER_ACCOUNT_BASE_SIZE } from './state/encounter.ts';
import { CORE_SIZE as PLAYER_CORE_SIZE } from './state/player.ts';
import { ARENA_PARTICIPANT_ACCOUNT_SIZE } from './state/arena.ts';
import { REINFORCEMENT_ACCOUNT_SIZE } from './state/reinforcement.ts';
import bs58 from 'bs58';

// ============================================================
// Types
// ============================================================

/** Options for client configuration */
export interface NovusMundusClientOptions {
  /** Connection to use */
  connection: Connection;
  /** Kingdom ID for multi-kingdom support (default: 0) */
  kingdomId?: number;
  /** GameEngine PDA (derived from kingdomId if not provided) */
  gameEngine?: PublicKey;
  /** Default commitment level */
  commitment?: Commitment;
  /** Compute unit limit for transactions */
  computeUnits?: number;
  /** Compute unit price in microlamports */
  computeUnitPrice?: number;
}

/** Result of account fetch */
export interface AccountFetchResult<T> {
  pubkey: PublicKey;
  account: T | null;
  exists: boolean;
}

/** Transaction building options */
export interface TransactionBuildOptions {
  /** Additional compute units (default: 200_000) */
  computeUnits?: number;
  /** Compute unit price in microlamports (default: 1) */
  computeUnitPrice?: number;
  /** Recent blockhash (if not provided, will be fetched) */
  recentBlockhash?: string;
  /** Fee payer (if not provided, uses first signer) */
  feePayer?: PublicKey;
  /** Lookup table accounts for versioned transactions */
  lookupTables?: AddressLookupTableAccount[];
}

/** Result of transaction simulation */
export interface SimulationResult {
  success: boolean;
  error: string | null;
  logs: string[];
  unitsConsumed: number | null;
  events: NovusMundusEvent[];
}

/** Result of transaction send */
export interface SendResult {
  signature: string;
  success: boolean;
  error: string | null;
  events: NovusMundusEvent[];
}

/** Result of bulk account fetch */
export interface BulkFetchResult<T> {
  pubkey: PublicKey;
  account: T;
}

/** Options for fetching loot */
export interface FetchLootOptions {
  /** Only return unclaimed loot */
  unclaimedOnly?: boolean;
}

/** Options for fetching encounters */
export interface FetchEncountersOptions {
  /** Only return encounters with health > 0 */
  aliveOnly?: boolean;
}

/** Options for fetching rallies */
export interface FetchRalliesOptions {
  /** Filter by team */
  team?: PublicKey;
  /** Only return active rallies (not completed/cancelled) */
  activeOnly?: boolean;
}

/** Options for fetching players */
export interface FetchPlayersOptions {
  /** Filter by city ID */
  cityId?: number;
  /** Filter by team */
  team?: PublicKey;
  /** Minimum level */
  minLevel?: number;
}

// ============================================================
// Client Class
// ============================================================

/**
 * High-level client for Novus Mundus program.
 *
 * @example
 * ```typescript
 * const client = new NovusMundusClient({
 *   connection: new Connection('https://api.mainnet-beta.solana.com'),
 *   computeUnits: 400_000,
 *   computeUnitPrice: 100,
 * });
 *
 * // Fetch accounts
 * const player = await client.fetchPlayer(ownerPubkey);
 *
 * // Build and send transaction
 * const tx = client.buildTransaction([instruction1, instruction2], { feePayer });
 * const result = await client.sendTransaction(tx, [signer]);
 * ```
 */
export class NovusMundusClient {
  readonly connection: Connection;
  readonly commitment: Commitment;
  readonly defaultComputeUnits: number;
  readonly defaultComputeUnitPrice: number;
  readonly kingdomId: number;
  readonly gameEngine: PublicKey;

  constructor(options: NovusMundusClientOptions) {
    this.connection = options.connection;
    this.commitment = options.commitment ?? 'confirmed';
    this.defaultComputeUnits = options.computeUnits ?? 200_000;
    this.defaultComputeUnitPrice = options.computeUnitPrice ?? 1;
    this.kingdomId = options.kingdomId ?? 0;
    // Derive gameEngine from kingdomId if not provided
    if (options.gameEngine) {
      this.gameEngine = options.gameEngine;
    } else {
      const [gameEngine] = deriveGameEnginePda(this.kingdomId);
      this.gameEngine = gameEngine;
    }
  }

  // ============================================================
  // Account Fetching
  // ============================================================

  /**
   * Fetch the game engine account.
   */
  async fetchGameEngine(): Promise<AccountFetchResult<GameEngine>> {
    const pubkey = this.gameEngine;
    const accountInfo = await this.connection.getAccountInfo(pubkey, this.commitment);

    if (!accountInfo) {
      return { pubkey, account: null, exists: false };
    }

    const account = parseGameEngine(accountInfo);
    return { pubkey, account, exists: true };
  }

  /**
   * Fetch a player account by owner wallet.
   */
  async fetchPlayer(owner: PublicKey): Promise<AccountFetchResult<PlayerAccount>> {
    const [pubkey] = derivePlayerPda(this.gameEngine, owner);
    const accountInfo = await this.connection.getAccountInfo(pubkey, this.commitment);

    if (!accountInfo) {
      return { pubkey, account: null, exists: false };
    }

    const account = parsePlayer(accountInfo);
    return { pubkey, account, exists: true };
  }

  /**
   * Fetch a user account by wallet.
   */
  async fetchUser(wallet: PublicKey): Promise<AccountFetchResult<UserAccount>> {
    const [pubkey] = deriveUserPda(wallet);
    const accountInfo = await this.connection.getAccountInfo(pubkey, this.commitment);

    if (!accountInfo) {
      return { pubkey, account: null, exists: false };
    }

    const account = parseUser(accountInfo);
    return { pubkey, account, exists: true };
  }

  /**
   * Fetch a city account by city ID.
   */
  async fetchCity(cityId: number): Promise<AccountFetchResult<CityAccount>> {
    const [pubkey] = deriveCityPda(this.gameEngine, cityId);
    const accountInfo = await this.connection.getAccountInfo(pubkey, this.commitment);

    if (!accountInfo) {
      return { pubkey, account: null, exists: false };
    }

    const account = parseCity(accountInfo);
    return { pubkey, account, exists: true };
  }

  /**
   * Fetch a team account by team ID.
   */
  async fetchTeam(teamId: number): Promise<AccountFetchResult<TeamAccount>> {
    const [pubkey] = deriveTeamPda(this.gameEngine, teamId);
    const accountInfo = await this.connection.getAccountInfo(pubkey, this.commitment);

    if (!accountInfo) {
      return { pubkey, account: null, exists: false };
    }

    const account = parseTeam(accountInfo);
    return { pubkey, account, exists: true };
  }

  /**
   * Fetch an encounter account.
   */
  async fetchEncounter(cityId: number, encounterId: number): Promise<AccountFetchResult<EncounterAccount>> {
    const [pubkey] = deriveEncounterPda(this.gameEngine, cityId, encounterId);
    const accountInfo = await this.connection.getAccountInfo(pubkey, this.commitment);

    if (!accountInfo) {
      return { pubkey, account: null, exists: false };
    }

    const account = parseEncounter(accountInfo);
    return { pubkey, account, exists: true };
  }

  /**
   * Fetch a rally account.
   */
  async fetchRally(creator: PublicKey, rallyIndex: number): Promise<AccountFetchResult<RallyAccount>> {
    const [pubkey] = deriveRallyPda(this.gameEngine, creator, rallyIndex);
    const accountInfo = await this.connection.getAccountInfo(pubkey, this.commitment);

    if (!accountInfo) {
      return { pubkey, account: null, exists: false };
    }

    const account = parseRally(accountInfo);
    return { pubkey, account, exists: true };
  }

  /**
   * Fetch a reinforcement account.
   */
  async fetchReinforcement(sender: PublicKey, recipient: PublicKey): Promise<AccountFetchResult<ReinforcementAccount>> {
    const [pubkey] = deriveReinforcementPda(this.gameEngine, sender, recipient);
    const accountInfo = await this.connection.getAccountInfo(pubkey, this.commitment);

    if (!accountInfo) {
      return { pubkey, account: null, exists: false };
    }

    const account = parseReinforcement(accountInfo);
    return { pubkey, account, exists: true };
  }

  /**
   * Fetch an expedition account.
   */
  async fetchExpedition(player: PublicKey): Promise<AccountFetchResult<ExpeditionAccount>> {
    const [pubkey] = deriveExpeditionPda(player);
    const accountInfo = await this.connection.getAccountInfo(pubkey, this.commitment);

    if (!accountInfo) {
      return { pubkey, account: null, exists: false };
    }

    const account = parseExpedition(accountInfo);
    return { pubkey, account, exists: true };
  }

  /**
   * Fetch a loot account.
   */
  async fetchLoot(encounter: PublicKey, player: PublicKey): Promise<AccountFetchResult<LootAccount>> {
    const [pubkey] = deriveLootPda(encounter, player);
    const accountInfo = await this.connection.getAccountInfo(pubkey, this.commitment);

    if (!accountInfo) {
      return { pubkey, account: null, exists: false };
    }

    const account = parseLoot(accountInfo);
    return { pubkey, account, exists: true };
  }

  /**
   * Fetch an arena season account.
   */
  async fetchArenaSeason(seasonId: number): Promise<AccountFetchResult<ArenaSeasonAccount>> {
    const [pubkey] = deriveArenaSeasonPda(this.gameEngine, seasonId);
    const accountInfo = await this.connection.getAccountInfo(pubkey, this.commitment);

    if (!accountInfo) {
      return { pubkey, account: null, exists: false };
    }

    const account = parseArenaSeason(accountInfo);
    return { pubkey, account, exists: true };
  }

  /**
   * Fetch an arena participant account.
   */
  async fetchArenaParticipant(seasonId: number, player: PublicKey): Promise<AccountFetchResult<ArenaParticipantAccount>> {
    const [pubkey] = deriveArenaParticipantPda(this.gameEngine, seasonId, player);
    const accountInfo = await this.connection.getAccountInfo(pubkey, this.commitment);

    if (!accountInfo) {
      return { pubkey, account: null, exists: false };
    }

    const account = parseArenaParticipant(accountInfo);
    return { pubkey, account, exists: true };
  }

  /**
   * Fetch the shop config account.
   */
  async fetchShopConfig(): Promise<AccountFetchResult<ShopConfigAccount>> {
    const [pubkey] = deriveShopConfigPda(this.gameEngine);
    const accountInfo = await this.connection.getAccountInfo(pubkey, this.commitment);

    if (!accountInfo) {
      return { pubkey, account: null, exists: false };
    }

    const account = parseShopConfig(accountInfo);
    return { pubkey, account, exists: true };
  }

  /**
   * Fetch multiple accounts in a single RPC call.
   */
  async fetchMultiple(pubkeys: PublicKey[]): Promise<(Buffer | null)[]> {
    const accounts = await this.connection.getMultipleAccountsInfo(pubkeys, this.commitment);
    return accounts.map(a => a?.data ?? null);
  }

  // ============================================================
  // Bulk Account Fetching (getProgramAccounts)
  // ============================================================

  /**
   * Fetch all team member slots for a team.
   *
   * @param team - The team pubkey
   * @returns Array of team member slots
   */
  async fetchTeamMembers(team: PublicKey): Promise<BulkFetchResult<TeamMemberSlot>[]> {
    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
      commitment: this.commitment,
      filters: [
        { dataSize: TEAM_MEMBER_SLOT_SIZE },
        { memcmp: { offset: 0, bytes: team.toBase58() } },
      ],
    });

    return accounts
      .map(({ pubkey, account }) => {
        const parsed = parseTeamMemberSlot(account);
        return parsed ? { pubkey, account: parsed } : null;
      })
      .filter((r): r is BulkFetchResult<TeamMemberSlot> => r !== null);
  }

  /**
   * Fetch all pending invites for a team.
   *
   * @param team - The team pubkey
   * @returns Array of team invites
   */
  async fetchTeamInvites(team: PublicKey): Promise<BulkFetchResult<TeamInviteAccount>[]> {
    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
      commitment: this.commitment,
      filters: [
        { dataSize: TEAM_INVITE_ACCOUNT_SIZE },
        { memcmp: { offset: 0, bytes: team.toBase58() } },
      ],
    });

    return accounts
      .map(({ pubkey, account }) => {
        const parsed = parseTeamInvite(account);
        return parsed ? { pubkey, account: parsed } : null;
      })
      .filter((r): r is BulkFetchResult<TeamInviteAccount> => r !== null);
  }

  /**
   * Fetch all loot accounts for a player.
   *
   * @param owner - The player pubkey (not wallet)
   * @param options - Fetch options
   * @returns Array of loot accounts
   */
  async fetchPlayerLoot(
    owner: PublicKey,
    options?: FetchLootOptions
  ): Promise<BulkFetchResult<LootAccount>[]> {
    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
      commitment: this.commitment,
      filters: [
        { dataSize: LOOT_ACCOUNT_SIZE },
        { memcmp: { offset: 0, bytes: owner.toBase58() } },
      ],
    });

    let results = accounts
      .map(({ pubkey, account }) => {
        const parsed = parseLoot(account);
        return parsed ? { pubkey, account: parsed } : null;
      })
      .filter((r): r is BulkFetchResult<LootAccount> => r !== null);

    // Filter unclaimed if requested
    if (options?.unclaimedOnly) {
      results = results.filter(r => !r.account.claimed);
    }

    return results;
  }

  /**
   * Fetch all encounters in a city.
   *
   * @param cityId - The city ID
   * @param options - Fetch options
   * @returns Array of encounters
   */
  async fetchEncountersInCity(
    cityId: number,
    options?: FetchEncountersOptions
  ): Promise<BulkFetchResult<EncounterAccount>[]> {
    // cityId is u16 at offset 8 (after u64 id)
    const cityIdBuffer = Buffer.alloc(2);
    cityIdBuffer.writeUInt16LE(cityId, 0);

    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
      commitment: this.commitment,
      filters: [
        // Encounters have variable size, so we filter by minimum size
        { memcmp: { offset: 8, bytes: bs58.encode(cityIdBuffer) } },
      ],
    });

    let results = accounts
      .map(({ pubkey, account }) => {
        // Check minimum size for encounter accounts
        if (account.data.length < ENCOUNTER_ACCOUNT_BASE_SIZE) return null;
        const parsed = parseEncounter(account);
        return parsed ? { pubkey, account: parsed } : null;
      })
      .filter((r): r is BulkFetchResult<EncounterAccount> => r !== null);

    // Filter alive encounters if requested
    if (options?.aliveOnly) {
      results = results.filter(r => r.account.health.gtn(0));
    }

    return results;
  }

  /**
   * Fetch all active rallies.
   *
   * @param options - Filter options
   * @returns Array of rallies
   */
  async fetchActiveRallies(options?: FetchRalliesOptions): Promise<BulkFetchResult<RallyAccount>[]> {
    const filters: Array<{ dataSize: number } | { memcmp: { offset: number; bytes: string } }> = [
      { dataSize: RALLY_ACCOUNT_SIZE },
    ];

    // Filter by team if specified (team is at offset 40: id(8) + creator(32))
    if (options?.team) {
      filters.push({ memcmp: { offset: 40, bytes: options.team.toBase58() } });
    }

    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
      commitment: this.commitment,
      filters,
    });

    let results = accounts
      .map(({ pubkey, account }) => {
        const parsed = parseRally(account);
        return parsed ? { pubkey, account: parsed } : null;
      })
      .filter((r): r is BulkFetchResult<RallyAccount> => r !== null);

    // Filter active rallies if requested (status < 4 means not completed/cancelled)
    if (options?.activeOnly) {
      results = results.filter(r => r.account.status < 4);
    }

    return results;
  }

  /**
   * Fetch all participants in a rally.
   *
   * @param rally - The rally pubkey
   * @returns Array of rally participants
   */
  async fetchRallyParticipants(rally: PublicKey, rallyAccount?: RallyAccount): Promise<BulkFetchResult<RallyParticipant>[]> {
    // RallyParticipant has rallyId(8) + rallyCreator(32) at start
    // To filter efficiently, we need the rally's id and creator. Fetch rally if not provided.
    let rallyData: RallyAccount | undefined = rallyAccount;
    if (!rallyData) {
      const accountInfo = await this.connection.getAccountInfo(rally, this.commitment);
      if (!accountInfo) {
        return [];
      }
      const parsed = parseRally(accountInfo);
      if (!parsed) {
        return [];
      }
      rallyData = parsed;
    }

    // Filter by rallyCreator at offset 8 (after rallyId which is 8 bytes)
    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
      commitment: this.commitment,
      filters: [
        { dataSize: RALLY_PARTICIPANT_SIZE },
        { memcmp: { offset: 8, bytes: rallyData.creator.toBase58() } },
      ],
    });

    // Parse and filter by matching rallyId
    return accounts
      .map(({ pubkey, account }) => {
        const parsed = parseRallyParticipant(account);
        // Double-check rallyId matches (in case creator has multiple rallies)
        if (parsed && parsed.rallyId.eq(rallyData!.id)) {
          return { pubkey, account: parsed };
        }
        return null;
      })
      .filter((r): r is BulkFetchResult<RallyParticipant> => r !== null);
  }

  /**
   * Fetch all arena participants for a season.
   *
   * @param seasonId - The season ID (u32)
   * @returns Array of arena participants
   */
  async fetchArenaParticipants(seasonId: number): Promise<BulkFetchResult<ArenaParticipantAccount>[]> {
    // ArenaParticipantAccount layout: player(32) + seasonId(4) + ...
    // seasonId is at offset 32
    const seasonIdBuffer = Buffer.alloc(4);
    seasonIdBuffer.writeUInt32LE(seasonId, 0);

    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
      commitment: this.commitment,
      filters: [
        { dataSize: ARENA_PARTICIPANT_ACCOUNT_SIZE },
        { memcmp: { offset: 32, bytes: bs58.encode(seasonIdBuffer) } },
      ],
    });

    return accounts
      .map(({ pubkey, account }) => {
        const parsed = parseArenaParticipant(account);
        return parsed ? { pubkey, account: parsed } : null;
      })
      .filter((r): r is BulkFetchResult<ArenaParticipantAccount> => r !== null);
  }

  /**
   * Fetch all reinforcements sent by a player.
   *
   * @param sender - The sender player pubkey
   * @returns Array of reinforcements
   */
  async fetchReinforcementsSent(sender: PublicKey): Promise<BulkFetchResult<ReinforcementAccount>[]> {
    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
      commitment: this.commitment,
      filters: [
        { dataSize: REINFORCEMENT_ACCOUNT_SIZE },
        // sender is at offset 0
        { memcmp: { offset: 0, bytes: sender.toBase58() } },
      ],
    });

    return accounts
      .map(({ pubkey, account }) => {
        const parsed = parseReinforcement(account);
        return parsed ? { pubkey, account: parsed } : null;
      })
      .filter((r): r is BulkFetchResult<ReinforcementAccount> => r !== null);
  }

  /**
   * Fetch all reinforcements received by a player.
   *
   * @param recipient - The recipient player pubkey
   * @returns Array of reinforcements
   */
  async fetchReinforcementsReceived(recipient: PublicKey): Promise<BulkFetchResult<ReinforcementAccount>[]> {
    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
      commitment: this.commitment,
      filters: [
        { dataSize: REINFORCEMENT_ACCOUNT_SIZE },
        // recipient is at offset 32 (after sender pubkey)
        { memcmp: { offset: 32, bytes: recipient.toBase58() } },
      ],
    });

    return accounts
      .map(({ pubkey, account }) => {
        const parsed = parseReinforcement(account);
        return parsed ? { pubkey, account: parsed } : null;
      })
      .filter((r): r is BulkFetchResult<ReinforcementAccount> => r !== null);
  }

  /**
   * Fetch all player accounts.
   *
   * Warning: This can return a large number of accounts. Use with caution.
   * Consider using pagination or filters in production.
   *
   * @returns Array of all players
   */
  async fetchAllPlayers(): Promise<BulkFetchResult<PlayerAccount>[]> {
    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
      commitment: this.commitment,
      filters: [
        // Players have minimum CORE_SIZE
        { dataSize: PLAYER_CORE_SIZE },
      ],
    });

    return accounts
      .map(({ pubkey, account }) => {
        const parsed = parsePlayer(account);
        return parsed ? { pubkey, account: parsed } : null;
      })
      .filter((r): r is BulkFetchResult<PlayerAccount> => r !== null);
  }

  /**
   * Fetch all expeditions (active or completed).
   *
   * @returns Array of expeditions
   */
  async fetchAllExpeditions(): Promise<BulkFetchResult<ExpeditionAccount>[]> {
    // Import expedition size
    const EXPEDITION_ACCOUNT_SIZE = 176; // Based on state structure

    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
      commitment: this.commitment,
      filters: [
        { dataSize: EXPEDITION_ACCOUNT_SIZE },
      ],
    });

    return accounts
      .map(({ pubkey, account }) => {
        const parsed = parseExpedition(account);
        return parsed ? { pubkey, account: parsed } : null;
      })
      .filter((r): r is BulkFetchResult<ExpeditionAccount> => r !== null);
  }

  /**
   * Fetch all cities.
   *
   * @returns Array of all cities
   */
  async fetchAllCities(): Promise<BulkFetchResult<CityAccount>[]> {
    // City account size based on structure
    const CITY_ACCOUNT_SIZE = 256;

    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
      commitment: this.commitment,
      filters: [
        { dataSize: CITY_ACCOUNT_SIZE },
      ],
    });

    return accounts
      .map(({ pubkey, account }) => {
        const parsed = parseCity(account);
        return parsed ? { pubkey, account: parsed } : null;
      })
      .filter((r): r is BulkFetchResult<CityAccount> => r !== null);
  }

  /**
   * Fetch all teams.
   *
   * @param options - Filter options
   * @returns Array of teams
   */
  async fetchAllTeams(options?: { activeOnly?: boolean }): Promise<BulkFetchResult<TeamAccount>[]> {
    const TEAM_ACCOUNT_SIZE = 240;

    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
      commitment: this.commitment,
      filters: [
        { dataSize: TEAM_ACCOUNT_SIZE },
      ],
    });

    let results = accounts
      .map(({ pubkey, account }) => {
        const parsed = parseTeam(account);
        return parsed ? { pubkey, account: parsed } : null;
      })
      .filter((r): r is BulkFetchResult<TeamAccount> => r !== null);

    // Filter active (not disbanded) if requested
    if (options?.activeOnly) {
      results = results.filter(r => !r.account.disbanded);
    }

    return results;
  }

  // ============================================================
  // Transaction Building
  // ============================================================

  /**
   * Build a transaction with compute budget instructions.
   */
  buildTransaction(
    instructions: TransactionInstruction[],
    options?: TransactionBuildOptions
  ): Transaction {
    const computeUnits = options?.computeUnits ?? this.defaultComputeUnits;
    const computeUnitPrice = options?.computeUnitPrice ?? this.defaultComputeUnitPrice;

    const tx = new Transaction();

    // Add compute budget instructions
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits })
    );
    tx.add(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: computeUnitPrice })
    );

    // Add all user instructions
    for (const ix of instructions) {
      tx.add(ix);
    }

    if (options?.recentBlockhash) {
      tx.recentBlockhash = options.recentBlockhash;
    }

    if (options?.feePayer) {
      tx.feePayer = options.feePayer;
    }

    return tx;
  }

  /**
   * Build a versioned transaction with lookup tables.
   */
  async buildVersionedTransaction(
    instructions: TransactionInstruction[],
    feePayer: PublicKey,
    options?: TransactionBuildOptions
  ): Promise<VersionedTransaction> {
    const computeUnits = options?.computeUnits ?? this.defaultComputeUnits;
    const computeUnitPrice = options?.computeUnitPrice ?? this.defaultComputeUnitPrice;

    // Build instructions array with compute budget
    const allInstructions = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: computeUnitPrice }),
      ...instructions,
    ];

    // Get recent blockhash
    const blockhash = options?.recentBlockhash ??
      (await this.connection.getLatestBlockhash(this.commitment)).blockhash;

    // Create message
    const message = new TransactionMessage({
      payerKey: feePayer,
      recentBlockhash: blockhash,
      instructions: allInstructions,
    }).compileToV0Message(options?.lookupTables);

    return new VersionedTransaction(message);
  }

  // ============================================================
  // Simulation
  // ============================================================

  /**
   * Simulate a transaction and return results with parsed events.
   */
  async simulateTransaction(
    transaction: Transaction | VersionedTransaction,
    signers?: Keypair[]
  ): Promise<SimulationResult> {
    // Sign if needed
    if (signers && signers.length > 0) {
      if (transaction instanceof Transaction) {
        transaction.partialSign(...signers);
      } else {
        transaction.sign(signers);
      }
    }

    const result = await this.connection.simulateTransaction(
      transaction as VersionedTransaction,
      { commitment: this.commitment }
    );

    const logs = result.value.logs ?? [];
    const events = parseEventsFromLogs(logs);

    return {
      success: result.value.err === null,
      error: result.value.err ? JSON.stringify(result.value.err) : null,
      logs,
      unitsConsumed: result.value.unitsConsumed ?? null,
      events,
    };
  }

  // ============================================================
  // Transaction Sending
  // ============================================================

  /**
   * Send and confirm a transaction.
   */
  async sendTransaction(
    transaction: Transaction | VersionedTransaction,
    signers: Keypair[],
    options?: SendOptions
  ): Promise<SendResult> {
    // Sign transaction
    if (transaction instanceof Transaction) {
      transaction.partialSign(...signers);
    } else {
      transaction.sign(signers);
    }

    // Send transaction
    const signature = await this.connection.sendRawTransaction(
      transaction.serialize(),
      options
    );

    // Confirm transaction
    const confirmation = await this.connection.confirmTransaction(
      signature,
      this.commitment
    );

    if (confirmation.value.err) {
      return {
        signature,
        success: false,
        error: JSON.stringify(confirmation.value.err),
        events: [],
      };
    }

    // Fetch transaction to get logs (getTransaction requires Finality type)
    const txInfo = await this.connection.getTransaction(signature, {
      commitment: this.commitment === 'finalized' || this.commitment === 'confirmed'
        ? this.commitment
        : 'confirmed',
      maxSupportedTransactionVersion: 0,
    });

    const logs = txInfo?.meta?.logMessages ?? [];
    const events = parseEventsFromLogs(logs);

    return {
      signature,
      success: true,
      error: null,
      events,
    };
  }

  /**
   * Send a transaction without waiting for confirmation.
   */
  async sendTransactionRaw(
    transaction: Transaction | VersionedTransaction,
    signers: Keypair[],
    options?: SendOptions
  ): Promise<string> {
    // Sign transaction
    if (transaction instanceof Transaction) {
      transaction.partialSign(...signers);
    } else {
      transaction.sign(signers);
    }

    // Send transaction
    return this.connection.sendRawTransaction(transaction.serialize(), options);
  }

  // ============================================================
  // Utilities
  // ============================================================

  /**
   * Get the program ID.
   */
  getProgramId(): PublicKey {
    return PROGRAM_ID;
  }

  /**
   * Check if an account exists.
   */
  async accountExists(pubkey: PublicKey): Promise<boolean> {
    const accountInfo = await this.connection.getAccountInfo(pubkey, this.commitment);
    return accountInfo !== null;
  }

  /**
   * Get the current slot.
   */
  async getSlot(): Promise<number> {
    return this.connection.getSlot(this.commitment);
  }

  /**
   * Get the current block time.
   */
  async getBlockTime(): Promise<number | null> {
    const slot = await this.getSlot();
    return this.connection.getBlockTime(slot);
  }

  /**
   * Get SOL balance of an account.
   */
  async getBalance(pubkey: PublicKey): Promise<BN> {
    const balance = await this.connection.getBalance(pubkey, this.commitment);
    return new BN(balance);
  }

  /**
   * Airdrop SOL (devnet/testnet only).
   */
  async requestAirdrop(pubkey: PublicKey, lamports: number): Promise<string> {
    return this.connection.requestAirdrop(pubkey, lamports);
  }
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Create a client for mainnet.
 */
export function createMainnetClient(options?: Partial<NovusMundusClientOptions>): NovusMundusClient {
  return new NovusMundusClient({
    connection: new Connection('https://api.mainnet-beta.solana.com'),
    commitment: 'confirmed',
    computeUnits: 400_000,
    computeUnitPrice: 100,
    ...options,
  });
}

/**
 * Create a client for devnet.
 */
export function createDevnetClient(options?: Partial<NovusMundusClientOptions>): NovusMundusClient {
  return new NovusMundusClient({
    connection: new Connection('https://api.devnet.solana.com'),
    commitment: 'confirmed',
    computeUnits: 200_000,
    computeUnitPrice: 1,
    ...options,
  });
}

/**
 * Create a client for a custom RPC endpoint.
 */
export function createClient(
  rpcUrl: string,
  options?: Partial<NovusMundusClientOptions>
): NovusMundusClient {
  return new NovusMundusClient({
    connection: new Connection(rpcUrl),
    commitment: 'confirmed',
    computeUnits: 200_000,
    computeUnitPrice: 1,
    ...options,
  });
}
