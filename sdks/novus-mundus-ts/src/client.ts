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
  AccountInfo,
  Blockhash,
} from '@solana/web3.js';
import { getBase58Decoder } from '@solana/codecs-strings';
import { sha256 } from '@noble/hashes/sha2.js';
import { PROGRAM_ID, SEEDS } from './program';
import {
  derivePlayerPda,
  deriveTeamPda,
  deriveRallyPda,
  deriveReinforcementPda,
  deriveExpeditionPda,
  deriveEstatePda,
  deriveLootPda,
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
  deriveEventParticipationPda,
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
import { parseCastle } from './state/castle';
import type { CastleAccount } from './state/castle';
import { parseLocation, LOCATION_ACCOUNT_SIZE } from './state/location';
import type { LocationAccount } from './state/location';
import { parseEvent, parseEventParticipation, EVENT_ACCOUNT_SIZE } from './state/event';
import type { EventAccount, EventParticipation } from './state/event';
import { AccountKey } from './types/enums';

// base58 codec (replaces bs58). Note the inverted naming: bs58.encode(bytes) ->
// base58 string is `getBase58Decoder().decode(bytes)`.
const base58Decoder = getBase58Decoder();

/** Encode raw bytes as a base58 string (was `bs58.encode`). */
function bytesToBase58(b: Uint8Array): string {
  return base58Decoder.decode(b);
}

/** Encode a single discriminator byte as a base58 memcmp filter string. */
function keyFilterBytes(key: number): string {
  return bytesToBase58(Uint8Array.of(key & 0xff));
}

/** Encode a u16 little-endian value as a base58 memcmp filter string. */
function u16leFilterBytes(value: number): string {
  const buf = new Uint8Array(2);
  new DataView(buf.buffer).setUint16(0, value, true);
  return bytesToBase58(buf);
}

/** Encode a u32 little-endian value as a base58 memcmp filter string. */
function u32leFilterBytes(value: number): string {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, value, true);
  return bytesToBase58(buf);
}

const PDA_MARKER = new TextEncoder().encode('ProgramDerivedAddress');

/**
 * Synchronous PDA derivation used solely for the GameEngine default in the
 * constructor, which must produce a `PublicKey` eagerly (the `client.gameEngine`
 * field is read synchronously by callers). All other PDA work in this file uses
 * the async `derive*Pda` exports from ./pda. Mirrors the standard ed25519
 * off-curve bump search.
 */
function deriveProgramAddressSync(seeds: Uint8Array[], programId: PublicKey): [PublicKey, number] {
  const programBytes = programId.toBytes();
  for (let bump = 255; bump >= 0; bump--) {
    const parts: Uint8Array[] = [...seeds, Uint8Array.of(bump), programBytes, PDA_MARKER];
    let total = 0;
    for (const p of parts) total += p.length;
    const buf = new Uint8Array(total);
    let offset = 0;
    for (const p of parts) {
      buf.set(p, offset);
      offset += p.length;
    }
    const hash = sha256(buf);
    if (!PublicKey.isOnCurve(hash)) {
      return [new PublicKey(hash), bump];
    }
  }
  throw new Error('Unable to find a viable program address bump seed');
}

// Types

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

/**
 * Number of compute-budget instructions {@link NovusMundusClient.buildVersionedTransaction}
 * prepends ahead of the caller's instructions (`SetComputeUnitLimit` +
 * `SetComputeUnitPrice`).
 *
 * Callers that need the on-tx index of one of their instructions — e.g. the
 * `ed25519` verify instruction whose position is embedded in
 * `crank_oracle_quote` data and the Switchboard gateway request — must offset
 * by this count. Keep in sync with the prefix `buildVersionedTransaction` builds.
 */
export const COMPUTE_BUDGET_PREFIX_IX_COUNT = 2;

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

/** Options for fetching locations */
export interface FetchLocationsOptions {
  /** Only return cells with a non-zero occupantType */
  occupiedOnly?: boolean;
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

// Client Class

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
    // Derive gameEngine from kingdomId if not provided. Done synchronously so
    // `client.gameEngine` is available immediately (see deriveProgramAddressSync).
    if (options.gameEngine) {
      this.gameEngine = options.gameEngine;
    } else {
      const buf = new Uint8Array(2);
      new DataView(buf.buffer).setUint16(0, this.kingdomId, true);
      const [gameEngine] = deriveProgramAddressSync([SEEDS.GAME_ENGINE, buf], PROGRAM_ID);
      this.gameEngine = gameEngine;
    }
  }

  // Account Fetching

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
    const [pubkey] = await derivePlayerPda(this.gameEngine, owner);
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
    const [pubkey] = await deriveUserPda(wallet);
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
    const [pubkey] = await deriveCityPda(this.gameEngine, cityId);
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
    const [pubkey] = await deriveTeamPda(this.gameEngine, teamId);
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
    const [pubkey] = await deriveEncounterPda(this.gameEngine, cityId, encounterId);
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
    const [pubkey] = await deriveRallyPda(this.gameEngine, creator, rallyIndex);
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
    const [pubkey] = await deriveReinforcementPda(this.gameEngine, sender, recipient);
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
    const [pubkey] = await deriveExpeditionPda(player);
    const accountInfo = await this.connection.getAccountInfo(pubkey, this.commitment);

    if (!accountInfo) {
      return { pubkey, account: null, exists: false };
    }

    const account = parseExpedition(accountInfo);
    return { pubkey, account, exists: true };
  }

  /**
   * Fetch an estate account by player PDA.
   */
  async fetchEstate(player: PublicKey): Promise<AccountFetchResult<EstateAccount>> {
    const [pubkey] = await deriveEstatePda(player);
    const accountInfo = await this.connection.getAccountInfo(pubkey, this.commitment);

    if (!accountInfo) {
      return { pubkey, account: null, exists: false };
    }

    const account = parseEstate(accountInfo);
    return { pubkey, account, exists: true };
  }

  /**
   * Fetch a loot account.
   */
  async fetchLoot(playerPda: PublicKey, lootId: number | bigint): Promise<AccountFetchResult<LootAccount>> {
    const [pubkey] = await deriveLootPda(playerPda, lootId);
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
    const [pubkey] = await deriveArenaSeasonPda(this.gameEngine, seasonId);
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
    const [pubkey] = await deriveArenaParticipantPda(this.gameEngine, seasonId, player);
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
    const [pubkey] = await deriveShopConfigPda(this.gameEngine);
    const accountInfo = await this.connection.getAccountInfo(pubkey, this.commitment);

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
    const keyByte = keyFilterBytes(AccountKey.ShopItem);
    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
      commitment: this.commitment,
      filters: [
        { memcmp: { offset: 0, bytes: keyByte } },
      ],
    });

    // Build reverse lookup: pubkey base58 -> itemId
    const pdaToId = new Map<string, number>();
    const ids = Array.from({ length: maxId }, (_, i) => i);
    const pdas = await Promise.all(ids.map((i) => deriveShopItemPda(this.gameEngine, i)));
    pdas.forEach(([pda], i) => pdaToId.set(pda.toBase58(), ids[i]!));

    return accounts
      .map(({ pubkey, account }) => {
        const parsed = parseShopItem(account);
        const itemId = pdaToId.get(pubkey.toBase58());
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
    const keyByte = keyFilterBytes(AccountKey.ShopBundle);
    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
      commitment: this.commitment,
      filters: [
        { memcmp: { offset: 0, bytes: keyByte } },
      ],
    });

    // Build reverse lookup: pubkey base58 -> bundleId
    const pdaToId = new Map<string, number>();
    const ids = Array.from({ length: maxId }, (_, i) => i);
    const pdas = await Promise.all(ids.map((i) => deriveBundlePda(this.gameEngine, i)));
    pdas.forEach(([pda], i) => pdaToId.set(pda.toBase58(), ids[i]!));

    return accounts
      .map(({ pubkey, account }) => {
        const parsed = parseBundle(account);
        const bundleId = pdaToId.get(pubkey.toBase58());
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

    const entries = await Promise.all(
      Array.from({ length: maxId }, (_, i) => i).map(async (i) => ({
        id: i,
        pubkey: (await deriveFlashSalePda(this.gameEngine, i))[0],
      })),
    );

    const infos = await this.connection.getMultipleAccountsInfo(
      entries.map(e => e.pubkey),
      this.commitment,
    );

    const results: (BulkFetchResult<FlashSaleAccount> & { saleId: number })[] = [];
    for (let i = 0; i < infos.length; i++) {
      const entry = entries[i];
      if (infos[i] && entry) {
        const parsed = parseFlashSale(infos[i]!);
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
    const entries = await Promise.all(
      slots.map(async (slot) => ({
        slot,
        pubkey: (await deriveDailyDealPda(this.gameEngine, slot))[0],
      })),
    );

    const infos = await this.connection.getMultipleAccountsInfo(
      entries.map((e) => e.pubkey),
      this.commitment,
    );

    const results: (BulkFetchResult<DailyDealAccount> & { slot: number })[] = [];
    for (let i = 0; i < infos.length; i++) {
      const entry = entries[i];
      if (infos[i] && entry) {
        const parsed = parseDailyDeal(infos[i]!);
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
    parse: (account: AccountInfo<Uint8Array>) => T | null,
  ): Promise<BulkFetchResult<T>[]> {
    const keyByte = keyFilterBytes(key);
    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
      commitment: this.commitment,
      filters: [{ memcmp: { offset: 0, bytes: keyByte } }],
    });
    return accounts
      .map(({ pubkey, account }) => {
        const parsed = parse(account);
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
    wallet: PublicKey,
    pdaToId?: Map<string, number>,
  ): Promise<(BulkFetchResult<PlayerPurchaseAccount> & { itemId: number })[]> {
    const resolvedIndex = pdaToId ?? (await derivePlayerPurchaseIndex(wallet));
    const accounts = await this.fetchAllByKey(AccountKey.PlayerPurchase, parsePlayerPurchase);
    return accounts
      .map(({ pubkey, account }) => {
        const itemId = resolvedIndex.get(pubkey.toBase58());
        return itemId !== undefined ? { pubkey, account, itemId } : null;
      })
      .filter((r): r is BulkFetchResult<PlayerPurchaseAccount> & { itemId: number } => r !== null);
  }

  /**
   * Fetch multiple accounts in a single RPC call.
   */
  async fetchMultiple(pubkeys: PublicKey[]): Promise<(Uint8Array | null)[]> {
    const accounts = await this.connection.getMultipleAccountsInfo(pubkeys, this.commitment);
    return accounts.map(a => a?.data ?? null);
  }

  // Bulk Account Fetching (getProgramAccounts)

  /**
   * Fetch all team member slots for a team.
   *
   * @param team - The team pubkey
   * @returns Array of team member slots
   */
  async fetchTeamMembers(team: PublicKey): Promise<BulkFetchResult<TeamMemberSlot>[]> {
    const keyByte = keyFilterBytes(AccountKey.TeamMemberSlot);
    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
      commitment: this.commitment,
      filters: [
        { memcmp: { offset: 0, bytes: keyByte } },
        { memcmp: { offset: 1, bytes: team.toBase58() } },
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
    const keyByte = keyFilterBytes(AccountKey.TeamInvite);
    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
      commitment: this.commitment,
      filters: [
        { memcmp: { offset: 0, bytes: keyByte } },
        { memcmp: { offset: 1, bytes: team.toBase58() } },
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
    const keyByte = keyFilterBytes(AccountKey.Loot);
    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
      commitment: this.commitment,
      filters: [
        { memcmp: { offset: 0, bytes: keyByte } },
        // owner is at offset 1 (after account_key u8)
        { memcmp: { offset: 1, bytes: owner.toBase58() } },
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
    const keyByte = keyFilterBytes(AccountKey.Encounter);
    // cityId is u16 at offset 48 (1 account_key + 32 game_engine + 7 padding + 8 id)
    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
      commitment: this.commitment,
      filters: [
        { memcmp: { offset: 0, bytes: keyByte } },
        { memcmp: { offset: 1, bytes: this.gameEngine.toBase58() } },
        { memcmp: { offset: 48, bytes: u16leFilterBytes(cityId) } },
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
      results = results.filter(r => r.account.health > 0n);
    }

    return results;
  }

  /**
   * Fetch all LocationAccounts for a city (occupancy grid).
   *
   * Memcmp offsets mirror LocationAccount layout in state/location.ts:
   *   account_key (1) + game_engine (32) + 3 pad + grid_lat (4) + grid_long (4)
   *   = city_id u16 @ offset 44.
   *
   * @param cityId - The city ID
   * @param options - Fetch options
   * @returns Array of locations
   */
  async fetchLocationsInCity(
    cityId: number,
    options?: FetchLocationsOptions
  ): Promise<BulkFetchResult<LocationAccount>[]> {
    const keyByte = keyFilterBytes(AccountKey.Location);
    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
      commitment: this.commitment,
      filters: [
        { memcmp: { offset: 0, bytes: keyByte } },
        { memcmp: { offset: 1, bytes: this.gameEngine.toBase58() } },
        { memcmp: { offset: 44, bytes: u16leFilterBytes(cityId) } },
      ],
    });

    let results = accounts
      .map(({ pubkey, account }) => {
        const parsed = parseLocation(account);
        return parsed ? { pubkey, account: parsed } : null;
      })
      .filter((r): r is BulkFetchResult<LocationAccount> => r !== null);

    if (options?.occupiedOnly) {
      results = results.filter(r => r.account.occupantType !== 0);
    }

    return results;
  }

  /**
   * Fetch every EventAccount in this kingdom (any status).
   *
   * game_engine pubkey sits at offset 1 (right after the 1-byte account_key
   * discriminator), so a single memcmp + a dataSize filter is enough to scope
   * the result to one kingdom.
   *
   * @returns Array of events
   */
  async fetchKingdomEvents(): Promise<BulkFetchResult<EventAccount>[]> {
    const keyByte = keyFilterBytes(AccountKey.Event);
    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
      commitment: this.commitment,
      filters: [
        { dataSize: EVENT_ACCOUNT_SIZE },
        { memcmp: { offset: 0, bytes: keyByte } },
        { memcmp: { offset: 1, bytes: this.gameEngine.toBase58() } },
      ],
    });

    return accounts
      .map(({ pubkey, account }) => {
        const parsed = parseEvent(account);
        return parsed ? { pubkey, account: parsed } : null;
      })
      .filter((r): r is BulkFetchResult<EventAccount> => r !== null);
  }

  /**
   * Fetch the given player's EventParticipation for a set of event IDs.
   *
   * Derives one PDA per event id, then batches them through
   * getMultipleAccountsInfo so the whole roster is one RPC.
   *
   * @param eventIds - Event IDs to check
   * @param playerOwner - Wallet owner whose participations we want
   * @returns Array of present participations (missing PDAs are dropped)
   */
  async fetchPlayerEventParticipations(
    eventIds: ReadonlyArray<bigint | number>,
    playerOwner: PublicKey,
  ): Promise<BulkFetchResult<EventParticipation>[]> {
    if (eventIds.length === 0) return [];

    const pdas = await Promise.all(
      eventIds.map(async (id) => {
        const [pda] = await deriveEventParticipationPda(this.gameEngine, BigInt(id), playerOwner);
        return pda;
      }),
    );

    const infos = await this.connection.getMultipleAccountsInfo(pdas, this.commitment);

    const out: BulkFetchResult<EventParticipation>[] = [];
    for (let i = 0; i < infos.length; i++) {
      const info = infos[i];
      if (!info) continue;
      const parsed = parseEventParticipation(info);
      if (parsed) out.push({ pubkey: pdas[i]!, account: parsed });
    }
    return out;
  }

  /**
   * Fetch all active rallies.
   *
   * @param options - Filter options
   * @returns Array of rallies
   */
  async fetchActiveRallies(options?: FetchRalliesOptions): Promise<BulkFetchResult<RallyAccount>[]> {
    const keyByte = keyFilterBytes(AccountKey.Rally);
    const filters: Array<{ dataSize: number } | { memcmp: { offset: number; bytes: string } }> = [
      { memcmp: { offset: 0, bytes: keyByte } },
      { memcmp: { offset: 1, bytes: this.gameEngine.toBase58() } },
    ];

    // Filter by team if specified (team is at offset 80: 1 account_key + 32 game_engine + 7 pad + 8 id + 32 creator)
    if (options?.team) {
      filters.push({ memcmp: { offset: 80, bytes: options.team.toBase58() } });
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

    // rallyCreator at offset 16 (1 account_key + 7 padding + 8 rallyId)
    const rpKeyByte = keyFilterBytes(AccountKey.RallyParticipant);
    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
      commitment: this.commitment,
      filters: [
        { memcmp: { offset: 0, bytes: rpKeyByte } },
        { memcmp: { offset: 16, bytes: rallyData.creator.toBase58() } },
      ],
    });

    // Parse and filter by matching rallyId
    return accounts
      .map(({ pubkey, account }) => {
        const parsed = parseRallyParticipant(account);
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
    const keyByte = keyFilterBytes(AccountKey.ArenaParticipant);
    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
      commitment: this.commitment,
      filters: [
        { memcmp: { offset: 0, bytes: keyByte } },
        { memcmp: { offset: 1, bytes: this.gameEngine.toBase58() } },
        // seasonId at offset 68 (1 account_key + 32 game_engine + 32 player + 3 padding)
        { memcmp: { offset: 68, bytes: u32leFilterBytes(seasonId) } },
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
    const keyByte = keyFilterBytes(AccountKey.Reinforcement);
    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
      commitment: this.commitment,
      filters: [
        { memcmp: { offset: 0, bytes: keyByte } },
        { memcmp: { offset: 1, bytes: this.gameEngine.toBase58() } },
        // sender is at offset 33 (1 account_key + 32 game_engine)
        { memcmp: { offset: 33, bytes: sender.toBase58() } },
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
    const keyByte = keyFilterBytes(AccountKey.Reinforcement);
    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
      commitment: this.commitment,
      filters: [
        { memcmp: { offset: 0, bytes: keyByte } },
        { memcmp: { offset: 1, bytes: this.gameEngine.toBase58() } },
        // destination is at offset 65 (1 account_key + 32 game_engine + 32 sender)
        { memcmp: { offset: 65, bytes: recipient.toBase58() } },
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
    const keyByte = keyFilterBytes(AccountKey.Player);
    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
      commitment: this.commitment,
      filters: [
        { memcmp: { offset: 0, bytes: keyByte } },
        { memcmp: { offset: 1, bytes: this.gameEngine.toBase58() } },
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
    const keyByte = keyFilterBytes(AccountKey.Expedition);

    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
      commitment: this.commitment,
      filters: [
        { memcmp: { offset: 0, bytes: keyByte } },
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
    const keyByte = keyFilterBytes(AccountKey.City);

    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
      commitment: this.commitment,
      filters: [
        { memcmp: { offset: 0, bytes: keyByte }, },
        { memcmp: { offset: 1, bytes: this.gameEngine.toBase58() } },
      ],
    });
    console.log(`Fetched ${accounts.length} city accounts`);

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
    const keyByte = keyFilterBytes(AccountKey.Team);

    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
      commitment: this.commitment,
      filters: [
        { memcmp: { offset: 0, bytes: keyByte } },
        { memcmp: { offset: 1, bytes: this.gameEngine.toBase58() } },
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

  /**
   * Fetch every castle in this kingdom.
   *
   * Castle accounts are AccountKey 40 with the gameEngine pubkey at offset 1
   * (after the discriminator). Used by the realm map to draw castles as
   * spatial entities — each one carries its own lat/long on the account.
   */
  async fetchAllCastles(): Promise<BulkFetchResult<CastleAccount>[]> {
    const keyByte = keyFilterBytes(AccountKey.Castle);
    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
      commitment: this.commitment,
      filters: [
        { memcmp: { offset: 0, bytes: keyByte } },
        { memcmp: { offset: 1, bytes: this.gameEngine.toBase58() } },
      ],
    });
    return accounts
      .map(({ pubkey, account }) => {
        const parsed = parseCastle(account);
        return parsed ? { pubkey, account: parsed } : null;
      })
      .filter((r): r is BulkFetchResult<CastleAccount> => r !== null);
  }

  /**
   * Fetch all hero templates.
   */
  async fetchAllHeroTemplates(): Promise<BulkFetchResult<HeroTemplateAccount>[]> {
    const keyByte = keyFilterBytes(AccountKey.HeroTemplate);

    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
      commitment: this.commitment,
      filters: [
        { memcmp: { offset: 0, bytes: keyByte } },
        { dataSize: HERO_TEMPLATE_SIZE },
      ],
    });

    return accounts
      .map(({ pubkey, account }) => {
        const parsed = parseHeroTemplate(account);
        return parsed ? { pubkey, account: parsed } : null;
      })
      .filter((r): r is BulkFetchResult<HeroTemplateAccount> => r !== null);
  }

  // Transaction Building

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
      // v3 types recentBlockhash as a branded Blockhash; the option is a plain
      // string blockhash, safe to brand.
      tx.recentBlockhash = options.recentBlockhash as Blockhash;
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

    // Prepend the compute-budget prefix. This is exactly
    // COMPUTE_BUDGET_PREFIX_IX_COUNT instructions — if you add or remove one,
    // update that constant: callers offset on-tx instruction indices by it.
    const computeBudgetPrefix = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: computeUnitPrice }),
    ];
    if (computeBudgetPrefix.length !== COMPUTE_BUDGET_PREFIX_IX_COUNT) {
      throw new Error('COMPUTE_BUDGET_PREFIX_IX_COUNT is out of sync with buildVersionedTransaction');
    }
    const allInstructions = [...computeBudgetPrefix, ...instructions];

    // Get recent blockhash
    const blockhash = options?.recentBlockhash ??
      (await this.connection.getLatestBlockhash(this.commitment)).blockhash;

    // Create message (v3 types recentBlockhash as a branded Blockhash)
    const message = new TransactionMessage({
      payerKey: feePayer,
      recentBlockhash: blockhash as Blockhash,
      instructions: allInstructions,
    }).compileToV0Message(options?.lookupTables);

    return new VersionedTransaction(message);
  }

  // Simulation

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
      // unitsConsumed is bigint in v3 RPC responses
      unitsConsumed: result.value.unitsConsumed !== undefined ? Number(result.value.unitsConsumed) : null,
      events,
    };
  }

  // Transaction Sending

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

    // Send transaction (legacy Transaction.serialize is async in v3; awaiting a
    // sync VersionedTransaction.serialize() is a no-op)
    const signature = await this.connection.sendRawTransaction(
      await transaction.serialize(),
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
    return this.connection.sendRawTransaction(await transaction.serialize(), options);
  }

  // Utilities

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
    // getSlot returns a bigint Slot in v3
    return Number(await this.connection.getSlot(this.commitment));
  }

  /**
   * Get the current block time.
   */
  async getBlockTime(): Promise<number | null> {
    const slot = await this.getSlot();
    // getBlockTime returns a bigint UnixTimestamp (or null) in v3
    const blockTime = await this.connection.getBlockTime(slot);
    return blockTime !== null ? Number(blockTime) : null;
  }

  /**
   * Get SOL balance of an account (lamports).
   */
  async getBalance(pubkey: PublicKey): Promise<number> {
    // getBalance returns lamports as a bigint Lamports type in v3
    return Number(await this.connection.getBalance(pubkey, this.commitment));
  }

  /**
   * Airdrop SOL (devnet/testnet only).
   */
  async requestAirdrop(pubkey: PublicKey, lamports: number): Promise<string> {
    return this.connection.requestAirdrop(pubkey, lamports);
  }
}

// Helper Functions

/**
 * Create a client for mainnet.
 */
export function createMainnetClient(options?: Partial<NovusMundusClientOptions>): NovusMundusClient {
  return new NovusMundusClient({
    connection: new Connection('https://api.mainnet-beta.solana.com'),
    commitment: 'confirmed',
    computeUnits: 400_000,
    computeUnitPrice: 10_000,
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
    computeUnits: 400_000,
    computeUnitPrice: 10_000,
    ...options,
  });
}
