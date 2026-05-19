/**
 * Novus Mundus Client
 *
 * High-level client for interacting with the Novus Mundus program.
 * Provides account fetching, transaction building, and simulation utilities.
 */

import {
  type Address,
  type Commitment,
  type Instruction,
  type Transaction,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  compileTransaction,
  signTransaction,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  getAddressFromPublicKey,
  getBase58Decoder,
  pipe,
  lamports,
  createSolanaRpc,
} from '@solana/kit';
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from '@solana-program/compute-budget';
import { PROGRAM_ID } from './program';
import {
  type SolanaRpc,
  fetchAccount,
  fetchAccounts,
  fetchProgramAccounts,
  memcmpFilter,
  dataSizeFilter,
} from './rpc';
import {
  derivePlayerPda,
  deriveTeamPda,
  deriveRallyPda,
  deriveReinforcementPda,
  deriveExpeditionPda,
  deriveEstatePda,
  deriveLootPda,
  deriveGameEnginePda,
  deriveCityPda,
  deriveEncounterPda,
  deriveUserPda,
  deriveArenaSeasonPda,
  deriveArenaParticipantPda,
  deriveShopConfigPda,
  deriveShopItemPda,
  deriveBundlePda,
  deriveFlashSalePda,
  deriveDailyDealPda,
  derivePlayerPurchaseIndex,
} from './pda';
import { parseGameEngine } from './state/game-engine';
import type { GameEngine } from './state/game-engine';
import { parsePlayer } from './state/player';
import type { PlayerAccount } from './state/player';
import { parseTeam } from './state/team';
import type { TeamAccount } from './state/team';
import { parseRally } from './state/rally';
import type { RallyAccount } from './state/rally';
import { parseReinforcement } from './state/reinforcement';
import type { ReinforcementAccount } from './state/reinforcement';
import { parseExpedition } from './state/expedition';
import type { ExpeditionAccount } from './state/expedition';
import { parseEstate } from './state/estate';
import type { EstateAccount } from './state/estate';
import { parseLoot } from './state/loot';
import type { LootAccount } from './state/loot';
import { parseCity } from './state/city';
import type { CityAccount } from './state/city';
import { parseEncounter } from './state/encounter';
import type { EncounterAccount } from './state/encounter';
import { parseUser } from './state/user';
import type { UserAccount } from './state/user';
import { parseArenaSeason, parseArenaParticipant } from './state/arena';
import type { ArenaSeasonAccount, ArenaParticipantAccount } from './state/arena';
import { parseShopConfig, parseShopItem, parseBundle, parseFlashSale, parseDailyDeal, parseWeeklySale, parseSeasonalSale, parseDaoPromotion, parsePlayerPurchase } from './state/shop';
import type { ShopConfigAccount, ShopItemAccount, BundleAccount, FlashSaleAccount, DailyDealAccount, WeeklySaleAccount, SeasonalSaleAccount, DAOPromotionAccount, PlayerPurchaseAccount } from './state/shop';
import { SHOP_ITEM_ACCOUNT_SIZE, BUNDLE_ACCOUNT_SIZE, FLASH_SALE_ACCOUNT_SIZE } from './state/shop';
import { parseEventsFromLogs } from './events/index';
import type { NovusMundusEvent } from './events/index';
import { parseTeamMemberSlot, parseTeamInvite, TEAM_MEMBER_SLOT_SIZE, TEAM_INVITE_ACCOUNT_SIZE } from './state/team';
import type { TeamMemberSlot, TeamInviteAccount } from './state/team';
import { parseRallyParticipant, RALLY_ACCOUNT_SIZE, RALLY_PARTICIPANT_SIZE } from './state/rally';
import type { RallyParticipant } from './state/rally';
import { LOOT_ACCOUNT_SIZE } from './state/loot';
import { ENCOUNTER_ACCOUNT_BASE_SIZE } from './state/encounter';
import { CORE_SIZE as PLAYER_CORE_SIZE } from './state/player';
import { ARENA_PARTICIPANT_ACCOUNT_SIZE } from './state/arena';
import { REINFORCEMENT_ACCOUNT_SIZE } from './state/reinforcement';
import { parseHeroTemplate, HERO_TEMPLATE_SIZE } from './state/hero';
import type { HeroTemplateAccount } from './state/hero';
import { AccountKey } from './types/enums';

// Types

/** Options for client configuration */
export interface NovusMundusClientOptions {
  /** RPC client to use */
  rpc: SolanaRpc;
  /** Kingdom ID for multi-kingdom support (default: 0) */
  kingdomId?: number;
  /** GameEngine PDA (derived from kingdomId if not provided) */
  gameEngine?: Address;
  /** Default commitment level */
  commitment?: Commitment;
  /** Compute unit limit for transactions */
  computeUnits?: number;
  /** Compute unit price in microlamports */
  computeUnitPrice?: number;
}

/** Result of account fetch */
export interface AccountFetchResult<T> {
  pubkey: Address;
  account: T | null;
  exists: boolean;
}

/** Transaction building options */
export interface TransactionBuildOptions {
  /** Additional compute units (default: 200_000) */
  computeUnits?: number;
  /** Compute unit price in microlamports (default: 1) */
  computeUnitPrice?: number;
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
  pubkey: Address;
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
  team?: Address;
  /** Only return active rallies (not completed/cancelled) */
  activeOnly?: boolean;
}

/** Options for fetching players */
export interface FetchPlayersOptions {
  /** Filter by city ID */
  cityId?: number;
  /** Filter by team */
  team?: Address;
  /** Minimum level */
  minLevel?: number;
}

// Client Class

/**
 * High-level client for Novus Mundus program.
 *
 * @example
 * ```typescript
 * const client = new NovusMundusClient({
 *   rpc: createSolanaRpc('https://api.mainnet-beta.solana.com'),
 *   computeUnits: 400_000,
 *   computeUnitPrice: 100,
 * });
 *
 * // Fetch accounts
 * const player = await client.fetchPlayer(ownerAddress);
 *
 * // Build and send transaction
 * const tx = await client.buildTransaction([instruction1, instruction2], feePayer);
 * const result = await client.sendTransaction([instruction1], [signer]);
 * ```
 */
export class NovusMundusClient {
  readonly rpc: SolanaRpc;
  readonly commitment: Commitment;
  readonly defaultComputeUnits: number;
  readonly defaultComputeUnitPrice: number;
  readonly kingdomId: number;

  /** Cached GameEngine address. Resolved lazily on first use via resolveGameEngine(). */
  private _gameEngine: Address | undefined;

  constructor(options: NovusMundusClientOptions) {
    this.rpc = options.rpc;
    this.commitment = options.commitment ?? 'confirmed';
    this.defaultComputeUnits = options.computeUnits ?? 200_000;
    this.defaultComputeUnitPrice = options.computeUnitPrice ?? 1;
    this.kingdomId = options.kingdomId ?? 0;
    // gameEngine is derived lazily from kingdomId if not provided
    this._gameEngine = options.gameEngine;
  }

  /**
   * Resolve the GameEngine address, deriving it from kingdomId on first call
   * and caching the result.
   */
  async resolveGameEngine(): Promise<Address> {
    if (this._gameEngine === undefined) {
      const [gameEngine] = await deriveGameEnginePda(this.kingdomId);
      this._gameEngine = gameEngine;
    }
    return this._gameEngine;
  }

  /** The GameEngine address if already resolved, otherwise undefined. */
  get gameEngine(): Address | undefined {
    return this._gameEngine;
  }

  // Account Fetching

  /**
   * Fetch the game engine account.
   */
  async fetchGameEngine(): Promise<AccountFetchResult<GameEngine>> {
    const pubkey = (await this.resolveGameEngine());
    const accountInfo = await fetchAccount(this.rpc, pubkey, this.commitment);

    if (!accountInfo) {
      return { pubkey, account: null, exists: false };
    }

    const account = parseGameEngine(accountInfo);
    return { pubkey, account, exists: true };
  }

  /**
   * Fetch a player account by owner wallet.
   */
  async fetchPlayer(owner: Address): Promise<AccountFetchResult<PlayerAccount>> {
    const [pubkey] = await derivePlayerPda((await this.resolveGameEngine()), owner);
    const accountInfo = await fetchAccount(this.rpc, pubkey, this.commitment);

    if (!accountInfo) {
      return { pubkey, account: null, exists: false };
    }

    const account = parsePlayer(accountInfo);
    return { pubkey, account, exists: true };
  }

  /**
   * Fetch a user account by wallet.
   */
  async fetchUser(wallet: Address): Promise<AccountFetchResult<UserAccount>> {
    const [pubkey] = await deriveUserPda(wallet);
    const accountInfo = await fetchAccount(this.rpc, pubkey, this.commitment);

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
    const [pubkey] = await deriveCityPda((await this.resolveGameEngine()), cityId);
    const accountInfo = await fetchAccount(this.rpc, pubkey, this.commitment);

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
    const [pubkey] = await deriveTeamPda((await this.resolveGameEngine()), teamId);
    const accountInfo = await fetchAccount(this.rpc, pubkey, this.commitment);

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
    const [pubkey] = await deriveEncounterPda((await this.resolveGameEngine()), cityId, encounterId);
    const accountInfo = await fetchAccount(this.rpc, pubkey, this.commitment);

    if (!accountInfo) {
      return { pubkey, account: null, exists: false };
    }

    const account = parseEncounter(accountInfo);
    return { pubkey, account, exists: true };
  }

  /**
   * Fetch a rally account.
   */
  async fetchRally(creator: Address, rallyIndex: number): Promise<AccountFetchResult<RallyAccount>> {
    const [pubkey] = await deriveRallyPda((await this.resolveGameEngine()), creator, rallyIndex);
    const accountInfo = await fetchAccount(this.rpc, pubkey, this.commitment);

    if (!accountInfo) {
      return { pubkey, account: null, exists: false };
    }

    const account = parseRally(accountInfo);
    return { pubkey, account, exists: true };
  }

  /**
   * Fetch a reinforcement account.
   */
  async fetchReinforcement(sender: Address, recipient: Address): Promise<AccountFetchResult<ReinforcementAccount>> {
    const [pubkey] = await deriveReinforcementPda((await this.resolveGameEngine()), sender, recipient);
    const accountInfo = await fetchAccount(this.rpc, pubkey, this.commitment);

    if (!accountInfo) {
      return { pubkey, account: null, exists: false };
    }

    const account = parseReinforcement(accountInfo);
    return { pubkey, account, exists: true };
  }

  /**
   * Fetch an expedition account.
   */
  async fetchExpedition(player: Address): Promise<AccountFetchResult<ExpeditionAccount>> {
    const [pubkey] = await deriveExpeditionPda(player);
    const accountInfo = await fetchAccount(this.rpc, pubkey, this.commitment);

    if (!accountInfo) {
      return { pubkey, account: null, exists: false };
    }

    const account = parseExpedition(accountInfo);
    return { pubkey, account, exists: true };
  }

  /**
   * Fetch an estate account by player PDA.
   */
  async fetchEstate(player: Address): Promise<AccountFetchResult<EstateAccount>> {
    const [pubkey] = await deriveEstatePda(player);
    const accountInfo = await fetchAccount(this.rpc, pubkey, this.commitment);

    if (!accountInfo) {
      return { pubkey, account: null, exists: false };
    }

    const account = parseEstate(accountInfo);
    return { pubkey, account, exists: true };
  }

  /**
   * Fetch a loot account.
   */
  async fetchLoot(playerPda: Address, lootId: number | bigint): Promise<AccountFetchResult<LootAccount>> {
    const [pubkey] = await deriveLootPda(playerPda, lootId);
    const accountInfo = await fetchAccount(this.rpc, pubkey, this.commitment);

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
    const [pubkey] = await deriveArenaSeasonPda((await this.resolveGameEngine()), seasonId);
    const accountInfo = await fetchAccount(this.rpc, pubkey, this.commitment);

    if (!accountInfo) {
      return { pubkey, account: null, exists: false };
    }

    const account = parseArenaSeason(accountInfo);
    return { pubkey, account, exists: true };
  }

  /**
   * Fetch an arena participant account.
   */
  async fetchArenaParticipant(seasonId: number, player: Address): Promise<AccountFetchResult<ArenaParticipantAccount>> {
    const [pubkey] = await deriveArenaParticipantPda((await this.resolveGameEngine()), seasonId, player);
    const accountInfo = await fetchAccount(this.rpc, pubkey, this.commitment);

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
    const [pubkey] = await deriveShopConfigPda((await this.resolveGameEngine()));
    const accountInfo = await fetchAccount(this.rpc, pubkey, this.commitment);

    if (!accountInfo) {
      return { pubkey, account: null, exists: false };
    }

    const account = parseShopConfig(accountInfo);
    return { pubkey, account, exists: true };
  }

  /**
   * Fetch all shop items using AccountKey discriminator filter.
   * Resolves itemId by reverse-matching PDAs.
   */
  async fetchAllShopItems(maxId: number = 200): Promise<(BulkFetchResult<ShopItemAccount> & { itemId: number })[]> {
    const keyByte = getBase58Decoder().decode(new Uint8Array([AccountKey.ShopItem]));
    const accounts = await fetchProgramAccounts(this.rpc, PROGRAM_ID, [
      memcmpFilter(0, keyByte),
    ], this.commitment);

    // Build reverse lookup: pubkey base58 -> itemId
    const gameEngine = await this.resolveGameEngine();
    const pdaToId = new Map(
      await Promise.all(
        Array.from({ length: maxId }, async (_, i): Promise<[string, number]> => {
          const [pda] = await deriveShopItemPda(gameEngine, i);
          return [pda, i];
        })
      )
    );

    return accounts
      .map(({ pubkey, data }) => {
        const parsed = parseShopItem({ data });
        const itemId = pdaToId.get(pubkey);
        if (parsed && itemId !== undefined) {
          return { pubkey, account: parsed, itemId };
        }
        return null;
      })
      .filter((r): r is BulkFetchResult<ShopItemAccount> & { itemId: number } => r !== null);
  }

  /**
   * Fetch all bundles using AccountKey discriminator filter.
   * Resolves bundleId by reverse-matching PDAs.
   */
  async fetchAllBundles(maxId: number = 100): Promise<(BulkFetchResult<BundleAccount> & { bundleId: number })[]> {
    const keyByte = getBase58Decoder().decode(new Uint8Array([AccountKey.ShopBundle]));
    const accounts = await fetchProgramAccounts(this.rpc, PROGRAM_ID, [
      memcmpFilter(0, keyByte),
    ], this.commitment);

    // Build reverse lookup: pubkey base58 -> bundleId
    const gameEngine = await this.resolveGameEngine();
    const pdaToId = new Map(
      await Promise.all(
        Array.from({ length: maxId }, async (_, i): Promise<[string, number]> => {
          const [pda] = await deriveBundlePda(gameEngine, i);
          return [pda, i];
        })
      )
    );

    return accounts
      .map(({ pubkey, data }) => {
        const parsed = parseBundle({ data });
        const bundleId = pdaToId.get(pubkey);
        if (parsed && bundleId !== undefined) {
          return { pubkey, account: parsed, bundleId };
        }
        return null;
      })
      .filter((r): r is BulkFetchResult<BundleAccount> & { bundleId: number } => r !== null);
  }

  /**
   * Fetch all flash sales using nextFlashSaleId from shop config.
   * Derives PDAs for IDs 0..nextFlashSaleId-1 and batch fetches.
   */
  async fetchAllFlashSales(): Promise<(BulkFetchResult<FlashSaleAccount> & { saleId: number })[]> {
    // Get the range from shop config
    const shopConfigResult = await this.fetchShopConfig();
    if (!shopConfigResult.account) return [];

    const maxId = Number(shopConfigResult.account.nextFlashSaleId);
    if (maxId === 0) return [];

    const gameEngine = await this.resolveGameEngine();
    const entries = await Promise.all(
      Array.from({ length: maxId }, async (_, i) => ({
        id: i,
        pubkey: (await deriveFlashSalePda(gameEngine, i))[0],
      }))
    );

    const infos = await fetchAccounts(
      this.rpc,
      entries.map(e => e.pubkey),
      this.commitment,
    );

    const results: (BulkFetchResult<FlashSaleAccount> & { saleId: number })[] = [];
    for (let i = 0; i < infos.length; i++) {
      const entry = entries[i];
      const info = infos[i];
      if (info && entry) {
        const parsed = parseFlashSale(info);
        if (parsed) {
          results.push({ pubkey: entry.pubkey, account: parsed, saleId: entry.id });
        }
      }
    }
    return results;
  }

  /**
   * Fetch all daily deal slots. Daily deals occupy a fixed set of slots
   * (0, 1, 2) — derive each PDA and batch fetch.
   */
  async fetchAllDailyDeals(): Promise<(BulkFetchResult<DailyDealAccount> & { slot: number })[]> {
    const slots = [0, 1, 2];
    const gameEngine = await this.resolveGameEngine();
    const entries = await Promise.all(
      slots.map(async (slot) => ({
        slot,
        pubkey: (await deriveDailyDealPda(gameEngine, slot))[0],
      }))
    );

    const infos = await fetchAccounts(
      this.rpc,
      entries.map((e) => e.pubkey),
      this.commitment,
    );

    const results: (BulkFetchResult<DailyDealAccount> & { slot: number })[] = [];
    for (let i = 0; i < infos.length; i++) {
      const entry = entries[i];
      const info = infos[i];
      if (info && entry) {
        const parsed = parseDailyDeal(info);
        if (parsed) {
          results.push({ pubkey: entry.pubkey, account: parsed, slot: entry.slot });
        }
      }
    }
    return results;
  }

  /**
   * Fetch every account of a given AccountKey via the discriminator filter.
   */
  private async fetchAllByKey<T extends object>(
    key: AccountKey,
    parse: (account: { data: Uint8Array }) => T | null,
  ): Promise<BulkFetchResult<T>[]> {
    const keyByte = getBase58Decoder().decode(new Uint8Array([key]));
    const accounts = await fetchProgramAccounts(this.rpc, PROGRAM_ID, [
      memcmpFilter(0, keyByte),
    ], this.commitment);
    return accounts
      .map(({ pubkey, data }) => {
        const parsed = parse({ data });
        return parsed ? { pubkey, account: parsed } : null;
      })
      .filter((r): r is BulkFetchResult<T> => r !== null);
  }

  /** Fetch all weekly sales. */
  fetchAllWeeklySales(): Promise<BulkFetchResult<WeeklySaleAccount>[]> {
    return this.fetchAllByKey(AccountKey.WeeklySale, parseWeeklySale);
  }

  /** Fetch all seasonal sales. */
  fetchAllSeasonalSales(): Promise<BulkFetchResult<SeasonalSaleAccount>[]> {
    return this.fetchAllByKey(AccountKey.SeasonalSale, parseSeasonalSale);
  }

  /** Fetch all DAO promotions. */
  fetchAllDaoPromotions(): Promise<BulkFetchResult<DAOPromotionAccount>[]> {
    return this.fetchAllByKey(AccountKey.DaoPromotion, parseDaoPromotion);
  }

  /**
   * Fetch a wallet's per-item purchase records. There is one PlayerPurchase
   * account per (buyer, itemId); itemId is resolved via the PDA reverse-lookup
   * — pass a precomputed one (derivePlayerPurchaseIndex) to avoid rebuilding it.
   */
  async fetchPlayerPurchases(
    wallet: Address,
    pdaToId?: Map<string, number>,
  ): Promise<(BulkFetchResult<PlayerPurchaseAccount> & { itemId: number })[]> {
    pdaToId ??= await derivePlayerPurchaseIndex(wallet);
    const accounts = await this.fetchAllByKey(AccountKey.PlayerPurchase, parsePlayerPurchase);
    return accounts
      .map(({ pubkey, account }) => {
        const itemId = pdaToId.get(pubkey);
        return itemId !== undefined ? { pubkey, account, itemId } : null;
      })
      .filter((r): r is BulkFetchResult<PlayerPurchaseAccount> & { itemId: number } => r !== null);
  }

  /**
   * Fetch multiple accounts in a single RPC call.
   */
  async fetchMultiple(pubkeys: Address[]): Promise<(Uint8Array | null)[]> {
    const accounts = await fetchAccounts(this.rpc, pubkeys, this.commitment);
    return accounts.map(a => a?.data ?? null);
  }

  // Bulk Account Fetching (getProgramAccounts)

  /**
   * Fetch all team member slots for a team.
   *
   * @param team - The team pubkey
   * @returns Array of team member slots
   */
  async fetchTeamMembers(team: Address): Promise<BulkFetchResult<TeamMemberSlot>[]> {
    const keyByte = getBase58Decoder().decode(new Uint8Array([AccountKey.TeamMemberSlot]));
    const accounts = await fetchProgramAccounts(this.rpc, PROGRAM_ID, [
      memcmpFilter(0, keyByte),
      memcmpFilter(1, team),
    ], this.commitment);

    return accounts
      .map(({ pubkey, data }) => {
        const parsed = parseTeamMemberSlot({ data });
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
  async fetchTeamInvites(team: Address): Promise<BulkFetchResult<TeamInviteAccount>[]> {
    const keyByte = getBase58Decoder().decode(new Uint8Array([AccountKey.TeamInvite]));
    const accounts = await fetchProgramAccounts(this.rpc, PROGRAM_ID, [
      memcmpFilter(0, keyByte),
      memcmpFilter(1, team),
    ], this.commitment);

    return accounts
      .map(({ pubkey, data }) => {
        const parsed = parseTeamInvite({ data });
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
    owner: Address,
    options?: FetchLootOptions
  ): Promise<BulkFetchResult<LootAccount>[]> {
    const keyByte = getBase58Decoder().decode(new Uint8Array([AccountKey.Loot]));
    const accounts = await fetchProgramAccounts(this.rpc, PROGRAM_ID, [
      memcmpFilter(0, keyByte),
      // owner is at offset 1 (after account_key u8)
      memcmpFilter(1, owner),
    ], this.commitment);

    let results = accounts
      .map(({ pubkey, data }) => {
        const parsed = parseLoot({ data });
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
    const keyByte = getBase58Decoder().decode(new Uint8Array([AccountKey.Encounter]));
    // cityId is u16 at offset 48 (1 account_key + 32 game_engine + 7 padding + 8 id)
    const cityIdBuffer = new Uint8Array(2);
    new DataView(cityIdBuffer.buffer).setUint16(0, cityId, true);

    const accounts = await fetchProgramAccounts(this.rpc, PROGRAM_ID, [
      memcmpFilter(0, keyByte),
      memcmpFilter(1, (await this.resolveGameEngine())),
      memcmpFilter(48, getBase58Decoder().decode(cityIdBuffer)),
    ], this.commitment);

    let results = accounts
      .map(({ pubkey, data }) => {
        // Check minimum size for encounter accounts
        if (data.length < ENCOUNTER_ACCOUNT_BASE_SIZE) return null;
        const parsed = parseEncounter({ data });
        return parsed ? { pubkey, account: parsed } : null;
      })
      .filter((r): r is BulkFetchResult<EncounterAccount> => r !== null);

    // Filter alive encounters if requested
    if (options?.aliveOnly) {
      results = results.filter(r => r.account.health > 0n);
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
    const keyByte = getBase58Decoder().decode(new Uint8Array([AccountKey.Rally]));
    const filters = [
      memcmpFilter(0, keyByte),
      memcmpFilter(1, (await this.resolveGameEngine())),
    ];

    // Filter by team if specified (team is at offset 80: 1 account_key + 32 game_engine + 7 pad + 8 id + 32 creator)
    if (options?.team) {
      filters.push(memcmpFilter(80, options.team));
    }

    const accounts = await fetchProgramAccounts(this.rpc, PROGRAM_ID, filters, this.commitment);

    let results = accounts
      .map(({ pubkey, data }) => {
        const parsed = parseRally({ data });
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
  async fetchRallyParticipants(rally: Address, rallyAccount?: RallyAccount): Promise<BulkFetchResult<RallyParticipant>[]> {
    // RallyParticipant has rallyId(8) + rallyCreator(32) at start
    // To filter efficiently, we need the rally's id and creator. Fetch rally if not provided.
    let rallyData: RallyAccount | undefined = rallyAccount;
    if (!rallyData) {
      const accountInfo = await fetchAccount(this.rpc, rally, this.commitment);
      if (!accountInfo) {
        return [];
      }
      const parsed = parseRally(accountInfo);
      if (!parsed) {
        return [];
      }
      rallyData = parsed;
    }

    // rallyCreator at offset 16 (1 account_key + 7 padding + 8 rallyId)
    const rpKeyByte = getBase58Decoder().decode(new Uint8Array([AccountKey.RallyParticipant]));
    const accounts = await fetchProgramAccounts(this.rpc, PROGRAM_ID, [
      memcmpFilter(0, rpKeyByte),
      memcmpFilter(16, rallyData.creator),
    ], this.commitment);

    // Parse and filter by matching rallyId
    return accounts
      .map(({ pubkey, data }) => {
        const parsed = parseRallyParticipant({ data });
        // Double-check rallyId matches (in case creator has multiple rallies)
        if (parsed && parsed.rallyId === rallyData!.id) {
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
    const keyByte = getBase58Decoder().decode(new Uint8Array([AccountKey.ArenaParticipant]));
    const seasonIdBuffer = new Uint8Array(4);
    new DataView(seasonIdBuffer.buffer).setUint32(0, seasonId, true);

    const accounts = await fetchProgramAccounts(this.rpc, PROGRAM_ID, [
      memcmpFilter(0, keyByte),
      memcmpFilter(1, (await this.resolveGameEngine())),
      // seasonId at offset 68 (1 account_key + 32 game_engine + 32 player + 3 padding)
      memcmpFilter(68, getBase58Decoder().decode(seasonIdBuffer)),
    ], this.commitment);

    return accounts
      .map(({ pubkey, data }) => {
        const parsed = parseArenaParticipant({ data });
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
  async fetchReinforcementsSent(sender: Address): Promise<BulkFetchResult<ReinforcementAccount>[]> {
    const keyByte = getBase58Decoder().decode(new Uint8Array([AccountKey.Reinforcement]));
    const accounts = await fetchProgramAccounts(this.rpc, PROGRAM_ID, [
      memcmpFilter(0, keyByte),
      memcmpFilter(1, (await this.resolveGameEngine())),
      // sender is at offset 33 (1 account_key + 32 game_engine)
      memcmpFilter(33, sender),
    ], this.commitment);

    return accounts
      .map(({ pubkey, data }) => {
        const parsed = parseReinforcement({ data });
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
  async fetchReinforcementsReceived(recipient: Address): Promise<BulkFetchResult<ReinforcementAccount>[]> {
    const keyByte = getBase58Decoder().decode(new Uint8Array([AccountKey.Reinforcement]));
    const accounts = await fetchProgramAccounts(this.rpc, PROGRAM_ID, [
      memcmpFilter(0, keyByte),
      memcmpFilter(1, (await this.resolveGameEngine())),
      // destination is at offset 65 (1 account_key + 32 game_engine + 32 sender)
      memcmpFilter(65, recipient),
    ], this.commitment);

    return accounts
      .map(({ pubkey, data }) => {
        const parsed = parseReinforcement({ data });
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
    const keyByte = getBase58Decoder().decode(new Uint8Array([AccountKey.Player]));
    const accounts = await fetchProgramAccounts(this.rpc, PROGRAM_ID, [
      memcmpFilter(0, keyByte),
      memcmpFilter(1, (await this.resolveGameEngine())),
    ], this.commitment);

    return accounts
      .map(({ pubkey, data }) => {
        const parsed = parsePlayer({ data });
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
    const EXPEDITION_ACCOUNT_SIZE = 176;
    const keyByte = getBase58Decoder().decode(new Uint8Array([AccountKey.Expedition]));

    const accounts = await fetchProgramAccounts(this.rpc, PROGRAM_ID, [
      memcmpFilter(0, keyByte),
    ], this.commitment);

    return accounts
      .map(({ pubkey, data }) => {
        const parsed = parseExpedition({ data });
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
    const keyByte = getBase58Decoder().decode(new Uint8Array([AccountKey.City]));

    const accounts = await fetchProgramAccounts(this.rpc, PROGRAM_ID, [
      memcmpFilter(0, keyByte),
      memcmpFilter(1, (await this.resolveGameEngine())),
    ], this.commitment);

    return accounts
      .map(({ pubkey, data }) => {
        const parsed = parseCity({ data });
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
    const keyByte = getBase58Decoder().decode(new Uint8Array([AccountKey.Team]));

    const accounts = await fetchProgramAccounts(this.rpc, PROGRAM_ID, [
      memcmpFilter(0, keyByte),
      memcmpFilter(1, (await this.resolveGameEngine())),
    ], this.commitment);

    let results = accounts
      .map(({ pubkey, data }) => {
        const parsed = parseTeam({ data });
        return parsed ? { pubkey, account: parsed } : null;
      })
      .filter((r): r is BulkFetchResult<TeamAccount> => r !== null);

    // Filter active (not disbanded) if requested
    if (options?.activeOnly) {
      results = results.filter(r => !r.account.disbanded);
    }

    return results;
  }

  /**
   * Fetch all hero templates.
   */
  async fetchAllHeroTemplates(): Promise<BulkFetchResult<HeroTemplateAccount>[]> {
    const keyByte = getBase58Decoder().decode(new Uint8Array([AccountKey.HeroTemplate]));

    const accounts = await fetchProgramAccounts(this.rpc, PROGRAM_ID, [
      memcmpFilter(0, keyByte),
      dataSizeFilter(HERO_TEMPLATE_SIZE),
    ], this.commitment);

    return accounts
      .map(({ pubkey, data }) => {
        const parsed = parseHeroTemplate({ data });
        return parsed ? { pubkey, account: parsed } : null;
      })
      .filter((r): r is BulkFetchResult<HeroTemplateAccount> => r !== null);
  }

  // Transaction Building

  /** Build a compiled (unsigned) transaction: compute-budget ixs + the given instructions. */
  async buildTransaction(
    instructions: Instruction[],
    feePayer: Address,
    options?: TransactionBuildOptions
  ): Promise<Transaction> {
    const cuLimit = options?.computeUnits ?? this.defaultComputeUnits;
    const cuPrice = options?.computeUnitPrice ?? this.defaultComputeUnitPrice;
    const { value: blockhash } = await this.rpc.getLatestBlockhash({ commitment: this.commitment }).send();
    const allIxs: Instruction[] = [
      getSetComputeUnitLimitInstruction({ units: cuLimit }),
      getSetComputeUnitPriceInstruction({ microLamports: cuPrice }),
      ...instructions,
    ];
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(feePayer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstructions(allIxs, m),
    );
    return compileTransaction(message);
  }

  // Simulation

  /**
   * Simulate a transaction and return results with parsed events.
   */
  async simulateTransaction(
    instructions: Instruction[],
    feePayer: Address,
    options?: TransactionBuildOptions
  ): Promise<SimulationResult> {
    const tx = await this.buildTransaction(instructions, feePayer, options);
    const wire = getBase64EncodedWireTransaction(tx);
    const { value } = await this.rpc
      .simulateTransaction(wire, { encoding: 'base64', commitment: this.commitment, replaceRecentBlockhash: true, sigVerify: false })
      .send();
    const logs = value.logs ?? [];
    return {
      success: value.err === null,
      error: value.err ? JSON.stringify(value.err) : null,
      logs,
      unitsConsumed: value.unitsConsumed != null ? Number(value.unitsConsumed) : null,
      events: parseEventsFromLogs(logs),
    };
  }

  // Transaction Sending

  /**
   * Send and confirm a transaction.
   */
  async sendTransaction(
    instructions: Instruction[],
    signers: CryptoKeyPair[],
    options?: TransactionBuildOptions
  ): Promise<SendResult> {
    const feePayer = await getAddressFromPublicKey(signers[0]!.publicKey);
    const tx = await this.buildTransaction(instructions, feePayer, options);
    const signed = await signTransaction(signers, tx);
    const signature = getSignatureFromTransaction(signed);
    const wire = getBase64EncodedWireTransaction(signed);
    await this.rpc.sendTransaction(wire, { encoding: 'base64', preflightCommitment: this.commitment }).send();
    // poll for confirmation
    for (let i = 0; i < 30; i++) {
      const { value } = await this.rpc.getSignatureStatuses([signature]).send();
      const status = value[0];
      if (status) {
        if (status.err) return { signature, success: false, error: JSON.stringify(status.err), events: [] };
        if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return { signature, success: true, error: null, events: [] };
  }

  /**
   * Send a transaction without waiting for confirmation.
   */
  async sendTransactionRaw(
    instructions: Instruction[],
    signers: CryptoKeyPair[],
    options?: TransactionBuildOptions
  ): Promise<string> {
    const feePayer = await getAddressFromPublicKey(signers[0]!.publicKey);
    const tx = await this.buildTransaction(instructions, feePayer, options);
    const signed = await signTransaction(signers, tx);
    const signature = getSignatureFromTransaction(signed);
    const wire = getBase64EncodedWireTransaction(signed);
    await this.rpc.sendTransaction(wire, { encoding: 'base64', preflightCommitment: this.commitment }).send();
    return signature;
  }

  // Utilities

  /**
   * Get the program ID.
   */
  getProgramId(): Address {
    return PROGRAM_ID;
  }

  /**
   * Check if an account exists.
   */
  async accountExists(pubkey: Address): Promise<boolean> {
    return (await fetchAccount(this.rpc, pubkey, this.commitment)) !== null;
  }

  /**
   * Get the current slot.
   */
  async getSlot(): Promise<number> {
    return Number(await this.rpc.getSlot({ commitment: this.commitment }).send());
  }

  /**
   * Get the current block time.
   */
  async getBlockTime(): Promise<number | null> {
    const t = await this.rpc.getBlockTime(BigInt(await this.getSlot())).send();
    return t == null ? null : Number(t);
  }

  /**
   * Get SOL balance of an account.
   */
  async getBalance(pubkey: Address): Promise<bigint> {
    const { value } = await this.rpc.getBalance(pubkey, { commitment: this.commitment }).send();
    return BigInt(value.toString());
  }

  /**
   * Airdrop SOL (devnet/testnet only).
   */
  async requestAirdrop(pubkey: Address, lamportsAmount: number): Promise<string> {
    return this.rpc.requestAirdrop(pubkey, lamports(BigInt(lamportsAmount)), { commitment: this.commitment }).send();
  }
}

// Helper Functions

/**
 * Create a client for mainnet.
 */
export function createMainnetClient(options?: Partial<NovusMundusClientOptions>): NovusMundusClient {
  return new NovusMundusClient({
    rpc: createSolanaRpc('https://api.mainnet-beta.solana.com'),
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
    rpc: createSolanaRpc('https://api.devnet.solana.com'),
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
    rpc: createSolanaRpc(rpcUrl),
    commitment: 'confirmed',
    computeUnits: 200_000,
    computeUnitPrice: 1,
    ...options,
  });
}
