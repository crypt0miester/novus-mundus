/**
 * Test Player Factory
 *
 * Creates and manages test players for E2E tests.
 */

import {
  Connection,
  Keypair,
  Transaction,
  PublicKey,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';

import {
  createInitPlayerInstruction,
  createInitUserInstruction,
  createHireUnitsInstruction,
  createPurchaseEquipmentInstruction,
  createCreateEstateInstruction,
  createIntercityStartInstruction,
  createIntercityCompleteInstruction,
  createIntracityStartInstruction,
  createIntracityCompleteInstruction,
  createTravelSpeedupInstruction,
  createPurchaseItemInstruction,
  createBuildBuildingInstruction,
  createUpgradeBuildingInstruction,
  createCompleteBuildingInstruction,
  createBuildingSpeedupInstruction,
  createCreateProgressInstruction,
  createStartResearchInstruction,
  createSpeedUpResearchInstruction,
  createCompleteResearchInstruction,
  createMintForPrizeInstruction,
  MintPurpose,
  createReservedToLockedInstruction,
  BuildingType,
  derivePlayerPda,
  deriveEstatePda,
  deriveUserPda,
  deriveLocationPda,
  deriveGameEnginePda,
  deriveCityPda,
  deserializePlayer,
  type PlayerAccount,
  PROGRAM_ID,
} from '../../src/index';

import { CITIES, TEST_GEMS_ITEM, TEST_FRAGMENTS_ITEM } from './setup';

import { type TestContext, airdropIfNeeded, sendTx } from './setup';

// ============================================================
// Types
// ============================================================

export interface TestPlayer {
  keypair: Keypair;
  publicKey: PublicKey;
  playerPda: PublicKey;
  playerBump: number;
  estatePda: PublicKey;
  estateBump: number;
  startingCityId: number;
  initialized: boolean;
  hasEstate: boolean;
}

export interface PlayerFactoryConfig {
  /** Number of players to pre-create */
  poolSize: number;
  /** Whether to auto-cycle through cities (each player gets unique city) */
  autoCycleCities: boolean;
  /** Starting city for all players (only used if autoCycleCities is false) */
  defaultCityId: number;
  /** Whether to auto-initialize players */
  autoInit: boolean;
  /** Whether to auto-create estates */
  autoEstate: boolean;
  /** Initial SOL balance for each player */
  initialBalance: number;
}

const DEFAULT_FACTORY_CONFIG: PlayerFactoryConfig = {
  poolSize: 10,
  autoCycleCities: true, // Each player gets a unique city to avoid spawn collision
  defaultCityId: 0,
  autoInit: true,
  autoEstate: false,
  initialBalance: 5 * LAMPORTS_PER_SOL,
};

// ============================================================
// Player Pool
// ============================================================

const KEYS_DIR = path.join(__dirname, '../../keys/players');

function ensurePlayersDir(): void {
  if (!fs.existsSync(KEYS_DIR)) {
    fs.mkdirSync(KEYS_DIR, { recursive: true });
  }
}

function loadOrCreatePlayerKeypair(index: number): Keypair {
  ensurePlayersDir();
  const filepath = path.join(KEYS_DIR, `player-${index}.json`);

  if (fs.existsSync(filepath)) {
    const secretKey = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
  }

  const keypair = Keypair.generate();
  fs.writeFileSync(filepath, JSON.stringify(Array.from(keypair.secretKey)));
  return keypair;
}

// ============================================================
// Player Factory
// ============================================================

export class PlayerFactory {
  private ctx: TestContext;
  private config: PlayerFactoryConfig;
  private players: Map<number, TestPlayer> = new Map();
  private nextIndex: number = 0;
  /** Tracks how many players have spawned per city to offset spawn location */
  private citySpawnCount: Map<number, number> = new Map();

  constructor(ctx: TestContext, config: Partial<PlayerFactoryConfig> = {}) {
    this.ctx = ctx;
    this.config = { ...DEFAULT_FACTORY_CONFIG, ...config };
  }

  /**
   * Create a new test player.
   * Each player is automatically assigned a unique city to avoid spawn location collisions.
   */
  async createPlayer(
    options: {
      cityId?: number;
      initialize?: boolean;
      createEstate?: boolean;
      customKeypair?: Keypair;
      /** Building types to auto-construct after estate creation */
      buildings?: (BuildingType | number)[];
    } = {}
  ): Promise<TestPlayer> {
    const index = this.nextIndex++;
    const keypair = options.customKeypair || loadOrCreatePlayerKeypair(index);
    const [playerPda, playerBump] = derivePlayerPda(this.ctx.gameEngine, keypair.publicKey);
    const [estatePda, estateBump] = deriveEstatePda(playerPda);

    // Auto-assign unique city if autoCycleCities is enabled and no explicit cityId
    let cityId: number;
    if (options.cityId !== undefined) {
      cityId = options.cityId;
    } else if (this.config.autoCycleCities) {
      // Cycle through available cities (0-indexed, matching Rust INITIAL_CITIES)
      cityId = index % CITIES.length;
    } else {
      cityId = this.config.defaultCityId;
    }

    const player: TestPlayer = {
      keypair,
      publicKey: keypair.publicKey,
      playerPda,
      playerBump,
      estatePda,
      estateBump,
      startingCityId: cityId,
      initialized: false,
      hasEstate: false,
    };

    // Airdrop SOL
    await airdropIfNeeded(
      this.ctx.connection,
      keypair.publicKey,
      this.config.initialBalance
    );

    const shouldInit = options.initialize ?? this.config.autoInit;
    const shouldEstate = options.createEstate ?? this.config.autoEstate;

    if (shouldInit) {
      // Batch: initUser + initPlayer + unlockResearch in ONE transaction
      console.log(`[PlayerFactory] Initializing player ${index} (city ${cityId})`);
      await this.initializePlayerBatched(player);

      // Batch: createEstate + buyGems in ONE transaction
      // Always buy gems to unlock EXT_INVENTORY (required for team/rally/etc)
      if (shouldEstate) {
        await this.createEstateBatched(player, true);
      }

      // Buildings: each is already a single tx (build + 7×speedup + complete)
      if (options.buildings && player.hasEstate) {
        for (const buildingType of options.buildings) {
          await this.buildAndCompleteBuilding(player, buildingType);
        }
      }
    }

    this.players.set(index, player);
    return player;
  }

  /**
   * Create multiple players at once.
   */
  async createPlayers(
    count: number,
    options: {
      cityId?: number;
      initialize?: boolean;
      createEstate?: boolean;
    } = {}
  ): Promise<TestPlayer[]> {
    const players: TestPlayer[] = [];
    for (let i = 0; i < count; i++) {
      const player = await this.createPlayer(options);
      players.push(player);
    }
    return players;
  }

  /**
   * Batched init: initUser + initPlayer + unlockResearch in ONE transaction.
   * Within a single Solana tx, instructions execute sequentially and see
   * state changes from previous instructions.
   */
  async initializePlayerBatched(player: TestPlayer): Promise<void> {
    if (player.initialized) return;

    // Check if already initialized on-chain
    const accountInfo = await this.ctx.connection.getAccountInfo(player.playerPda);
    if (accountInfo !== null && accountInfo.data.length > 0) {
      player.initialized = true;
      return;
    }

    const city = CITIES.find(c => c.id === player.startingCityId);
    if (!city) throw new Error(`City ${player.startingCityId} not found`);

    const spawnIndex = this.citySpawnCount.get(player.startingCityId) ?? 0;
    this.citySpawnCount.set(player.startingCityId, spawnIndex + 1);
    const spawnLat = city.lat + spawnIndex * 0.0001;
    const spawnLon = city.lon;

    const tx = new Transaction();

    // 1. Init user (creates user PDA)
    tx.add(createInitUserInstruction({
      owner: player.publicKey,
      gameEngine: this.ctx.gameEngine,
    }));

    // 2. Init player (reads user PDA created above)
    tx.add(createInitPlayerInstruction({
      owner: player.publicKey,
      gameEngine: this.ctx.gameEngine,
      startingCityId: player.startingCityId,
      cityLatitude: spawnLat,
      cityLongitude: spawnLon,
    }));

    // 3. Unlock research (reads player PDA created above)
    tx.add(createCreateProgressInstruction({
      owner: player.publicKey,
      gameEngine: this.ctx.gameEngine,
    }));

    // Request extra compute for 3 account-creating instructions
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }));

    await sendTx(this.ctx.connection, tx, [player.keypair], this.ctx.config);
    player.initialized = true;
  }

  /**
   * Batched estate: createEstate + buyGems in ONE transaction.
   */
  async createEstateBatched(player: TestPlayer, includeGems: boolean = false): Promise<void> {
    if (player.hasEstate) return;

    const accountInfo = await this.ctx.connection.getAccountInfo(player.estatePda);
    if (accountInfo !== null && accountInfo.data.length > 0) {
      player.hasEstate = true;
      return;
    }

    const tx = new Transaction();

    // 1. Create estate
    tx.add(createCreateEstateInstruction(
      { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
      { cityId: 1 }
    ));

    // 2. Buy gems (for building speedups)
    if (includeGems) {
      tx.add(createPurchaseItemInstruction(
        {
          buyer: player.publicKey,
          gameEngine: this.ctx.gameEngine,
          itemId: TEST_GEMS_ITEM.itemId,
          treasury: this.ctx.treasury.publicKey,
        },
        { quantity: 10 }
      ));
      this.playerGemsReady.add(player.publicKey.toBase58());
    }

    await sendTx(this.ctx.connection, tx, [player.keypair], this.ctx.config);
    player.hasEstate = true;
  }

  /**
   * Initialize a player account on-chain.
   */
  async initializePlayer(player: TestPlayer): Promise<void> {
    if (player.initialized) {
      return;
    }

    // Check if already initialized
    const accountInfo = await this.ctx.connection.getAccountInfo(player.playerPda);
    if (accountInfo !== null && accountInfo.data.length > 0) {
      player.initialized = true;
      return;
    }

    // Look up city coordinates for spawn location PDA
    const city = CITIES.find(c => c.id === player.startingCityId);
    if (!city) {
      throw new Error(`City ${player.startingCityId} not found in CITIES`);
    }

    // Offset spawn location per player so each gets a unique grid cell.
    // Grid precision is 10000, so 0.0001 degrees = 1 grid cell (~11m).
    const spawnIndex = this.citySpawnCount.get(player.startingCityId) ?? 0;
    this.citySpawnCount.set(player.startingCityId, spawnIndex + 1);
    const spawnLat = city.lat + spawnIndex * 0.0001;
    const spawnLon = city.lon;

    const ix = createInitPlayerInstruction({
      owner: player.publicKey,
      gameEngine: this.ctx.gameEngine,
      startingCityId: player.startingCityId,
      cityLatitude: spawnLat,
      cityLongitude: spawnLon,
    });

    const tx = new Transaction().add(ix);
    await sendTx(this.ctx.connection, tx, [player.keypair], this.ctx.config);
    player.initialized = true;
  }

  /**
   * Initialize a user account for the player (subscription/reserved NOVI).
   */
  async initializeUser(player: TestPlayer): Promise<void> {
    const [userPda] = deriveUserPda(player.publicKey);

    // Check if already initialized
    const accountInfo = await this.ctx.connection.getAccountInfo(userPda);
    if (accountInfo !== null && accountInfo.data.length > 0) {
      return;
    }

    const ix = createInitUserInstruction({
      owner: player.publicKey,
      gameEngine: this.ctx.gameEngine,
    });

    const tx = new Transaction().add(ix);
    await sendTx(this.ctx.connection, tx, [player.keypair], this.ctx.config);
  }

  /**
   * Unlock EXT_RESEARCH extension by creating research progress.
   * This is the first extension in the user journey.
   */
  async unlockResearch(player: TestPlayer): Promise<void> {
    if (!player.initialized) {
      throw new Error('Player must be initialized before unlocking research');
    }

    const ix = createCreateProgressInstruction({
      owner: player.publicKey,
      gameEngine: this.ctx.gameEngine,
    });

    const tx = new Transaction().add(ix);
    try {
      await sendTx(this.ctx.connection, tx, [player.keypair], this.ctx.config);
    } catch (e: any) {
      console.error('[unlockResearch] Failed:', e.transactionMessage || e.message);
      if (e.getLogs) {
        const logs = await e.getLogs(this.ctx.connection);
        console.error('[unlockResearch] Logs:', logs);
      }
      throw e;
    }
  }

  /**
   * Create estate for a player.
   */
  async createPlayerEstate(player: TestPlayer): Promise<void> {
    if (!player.initialized) {
      throw new Error('Player must be initialized before creating estate');
    }

    if (player.hasEstate) {
      return;
    }

    // Check if already exists
    const accountInfo = await this.ctx.connection.getAccountInfo(player.estatePda);
    if (accountInfo !== null && accountInfo.data.length > 0) {
      player.hasEstate = true;
      return;
    }

    const ix = createCreateEstateInstruction(
      { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
      { cityId: 1 }
    );

    const tx = new Transaction().add(ix);
    await sendTx(this.ctx.connection, tx, [player.keypair], this.ctx.config);
    player.hasEstate = true;
  }

  /**
   * Get player account data.
   */
  async getPlayerAccount(player: TestPlayer): Promise<PlayerAccount | null> {
    const accountInfo = await this.ctx.connection.getAccountInfo(player.playerPda);
    if (!accountInfo || accountInfo.data.length === 0) {
      return null;
    }
    return deserializePlayer(accountInfo.data);
  }

  /**
   * Hire units for a player.
   */
  async hireUnits(
    player: TestPlayer,
    unitType: number,
    noviAmount: BN | number
  ): Promise<void> {
    const ix = createHireUnitsInstruction(
      { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
      { unitType, noviAmount: new BN(noviAmount) }
    );

    const tx = new Transaction().add(ix);
    await sendTx(this.ctx.connection, tx, [player.keypair], this.ctx.config);
  }

  /**
   * Purchase equipment for a player.
   */
  async purchaseEquipment(
    player: TestPlayer,
    equipmentType: number,
    quantity: BN | number
  ): Promise<void> {
    const ix = createPurchaseEquipmentInstruction(
      { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
      { equipmentType, quantity: new BN(quantity), payWithCash: false }
    );

    const tx = new Transaction().add(ix);
    await sendTx(this.ctx.connection, tx, [player.keypair], this.ctx.config);
  }

  /**
   * Start intercity travel for a player.
   * Note: Travel takes time - use completeIntercityTravel after waiting.
   */
  async startIntercityTravel(
    player: TestPlayer,
    originCityId: number,
    destinationCityId: number,
    originGridLat: number,
    originGridLong: number,
    destGridLat?: number,
    destGridLong?: number
  ): Promise<void> {
    const [originLocation] = deriveLocationPda(this.ctx.gameEngine, originCityId, originGridLat, originGridLong);
    // Use provided destination grid coords, or default to city center
    const destCity = CITIES[destinationCityId]!;
    const GRID_PRECISION = 10000.0;
    const finalDestGridLat = destGridLat ?? Math.round(destCity.lat * GRID_PRECISION);
    const finalDestGridLong = destGridLong ?? Math.round(destCity.lon * GRID_PRECISION);
    const [destinationLocation] = deriveLocationPda(this.ctx.gameEngine, destinationCityId, finalDestGridLat, finalDestGridLong);

    const ix = createIntercityStartInstruction({
      owner: player.publicKey,
      gameEngine: this.ctx.gameEngine,
      originCityId,
      destinationCityId,
      destGridLat: finalDestGridLat,
      destGridLong: finalDestGridLong,
      originLocation,
      destinationLocation,
      originCreatorRefund: player.publicKey,
    });

    const tx = new Transaction().add(ix);
    await sendTx(this.ctx.connection, tx, [player.keypair], this.ctx.config);
  }

  /**
   * Complete intercity travel for a player.
   * Note: Will fail if travel time hasn't elapsed.
   */
  async completeIntercityTravel(
    player: TestPlayer,
    originCityId: number,
    destinationCityId: number,
    destGridLat: number,
    destGridLong: number
  ): Promise<void> {
    const [destinationLocation] = deriveLocationPda(this.ctx.gameEngine, destinationCityId, destGridLat, destGridLong);

    const ix = createIntercityCompleteInstruction({
      owner: player.publicKey,
      gameEngine: this.ctx.gameEngine,
      originCityId,
      destinationCityId,
      destinationLocation,
    });

    const tx = new Transaction().add(ix);
    await sendTx(this.ctx.connection, tx, [player.keypair], this.ctx.config);
  }

  /**
   * Start intracity travel for a player (within same city).
   * Note: Travel takes time - use completeIntracityTravel after waiting.
   */
  async startIntracityTravel(
    player: TestPlayer,
    cityId: number,
    originGridLat: number,
    originGridLong: number,
    destLat: number,
    destLong: number
  ): Promise<void> {
    // Convert f64 coords to grid: grid = round(coord * 10000)
    const destGridLat = Math.round(destLat * 10000);
    const destGridLong = Math.round(destLong * 10000);
    const [originLocation] = deriveLocationPda(this.ctx.gameEngine, cityId, originGridLat, originGridLong);
    const [destinationLocation] = deriveLocationPda(this.ctx.gameEngine, cityId, destGridLat, destGridLong);

    const ix = createIntracityStartInstruction(
      {
        owner: player.publicKey,
        gameEngine: this.ctx.gameEngine,
        cityId,
        originLocation,
        destinationLocation,
        originCreatorRefund: this.ctx.gameEngine,
      },
      { destinationLat: destLat, destinationLong: destLong }
    );

    const tx = new Transaction().add(ix);
    await sendTx(this.ctx.connection, tx, [player.keypair], this.ctx.config);
  }

  /**
   * Complete intracity travel for a player.
   * Note: Will fail if travel time hasn't elapsed.
   * @param destGridLat - Destination grid latitude
   * @param destGridLong - Destination grid longitude
   */
  async completeIntracityTravel(
    player: TestPlayer,
    cityId: number,
    destGridLat: number,
    destGridLong: number
  ): Promise<void> {
    const [destinationLocation] = deriveLocationPda(this.ctx.gameEngine, cityId, destGridLat, destGridLong);

    const ix = createIntracityCompleteInstruction({
      owner: player.publicKey,
      gameEngine: this.ctx.gameEngine,
      cityId,
      destinationLocation,
    });

    const tx = new Transaction().add(ix);
    await sendTx(this.ctx.connection, tx, [player.keypair], this.ctx.config);
  }

  /**
   * Get a player's current location from their on-chain account.
   */
  async getPlayerLocation(player: TestPlayer): Promise<{
    cityId: number;
    lat: number;
    long: number;
    gridLat: number;
    gridLong: number;
  } | null> {
    const account = await this.getPlayerAccount(player);
    if (!account) return null;

    return {
      cityId: account.currentCity,
      lat: account.currentLat,
      long: account.currentLong,
      // Grid coords are lat/long * 10000
      gridLat: Math.round(account.currentLat * 10000),
      gridLong: Math.round(account.currentLong * 10000),
    };
  }

  /**
   * Buy gems for a player from the test shop item.
   * Used for travel speedup in tests.
   */
  async buyGems(player: TestPlayer, purchases: number = 1): Promise<void> {
    // Debug: check player account state before purchase
    const preInfo = await this.ctx.connection.getAccountInfo(player.playerPda);
    if (preInfo) {
      console.log(`[buyGems] PRE: data_len=${preInfo.data.length} lamports=${preInfo.lamports}`);
    }

    const ix = createPurchaseItemInstruction(
      {
        buyer: player.publicKey,
        gameEngine: this.ctx.gameEngine,
        itemId: TEST_GEMS_ITEM.itemId,
        treasury: this.ctx.treasury.publicKey,
      },
      { quantity: purchases }
    );

    const tx = new Transaction().add(ix);
    try {
      await sendTx(this.ctx.connection, tx, [player.keypair], this.ctx.config);
    } catch (e: any) {
      console.error('[buyGems] Failed:', e.transactionMessage || e.message);
      if (e.getLogs) {
        const logs = await e.getLogs(this.ctx.connection);
        console.error('[buyGems] Logs:', logs);
      }
      throw e;
    }
  }

  /**
   * Buy fragments for hero level-up.
   * Each purchase gives 100 fragments.
   */
  async buyFragments(player: TestPlayer, purchases: number = 1): Promise<void> {
    const ix = createPurchaseItemInstruction(
      {
        buyer: player.publicKey,
        gameEngine: this.ctx.gameEngine,
        itemId: TEST_FRAGMENTS_ITEM.itemId,
        treasury: this.ctx.treasury.publicKey,
      },
      { quantity: purchases }
    );

    const tx = new Transaction().add(ix);
    await sendTx(this.ctx.connection, tx, [player.keypair], this.ctx.config);
  }

  /**
   * Complete a research type: start → speedup → complete.
   * Requires: player initialized, estate with Academy (Lv 1+), research progress PDA created.
   */
  async completeResearch(player: TestPlayer, researchType: number): Promise<void> {
    // Ensure gems for speedup
    const playerKey = player.publicKey.toBase58();
    if (!this.playerGemsReady.has(playerKey)) {
      await this.buyGems(player, 10);
      this.playerGemsReady.add(playerKey);
    }

    // Start research
    const startIx = createStartResearchInstruction({
      gameEngine: this.ctx.gameEngine,
      owner: player.publicKey,
      researchType,
    });
    await sendTx(this.ctx.connection, new Transaction().add(startIx), [player.keypair], this.ctx.config);

    // Speedup to completion (0 = complete all remaining)
    const speedupIx = createSpeedUpResearchInstruction(
      { gameEngine: this.ctx.gameEngine, owner: player.publicKey, researchType },
      { speedUpSeconds: new BN(0) }
    );
    await sendTx(this.ctx.connection, new Transaction().add(speedupIx), [player.keypair], this.ctx.config);

    // Complete research
    const completeIx = createCompleteResearchInstruction({
      gameEngine: this.ctx.gameEngine,
      payer: player.publicKey,
      playerOwner: player.publicKey,
      researchType,
    });
    await sendTx(this.ctx.connection, new Transaction().add(completeIx), [player.keypair], this.ctx.config);
  }

  /**
   * Speed up current travel using gems.
   * Tier 1 = 50% time remains, Tier 2 = 25% time remains.
   */
  async speedupTravel(player: TestPlayer, tier: 1 | 2 = 2): Promise<void> {
    const ix = createTravelSpeedupInstruction(
      { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
      { speedupTier: tier }
    );

    const tx = new Transaction().add(ix);
    await sendTx(this.ctx.connection, tx, [player.keypair], this.ctx.config);
  }

  /** Track which buildings each player has built (for prerequisite handling) */
  private playerBuildings = new Map<string, Set<number>>();
  /** Track which players have already purchased gems (avoid redundant buys) */
  private playerGemsReady = new Set<string>();

  /**
   * Build a building and instantly complete it in a SINGLE transaction.
   * Automatically builds prerequisite buildings (Mansion) if needed.
   *
   * Uses tier 2 speedup (25% remains) × 7 applications within the same tx.
   * All instructions share the same Clock::get() timestamp, so after 7 speedups
   * integer truncation brings remaining to 0, allowing immediate completion.
   *
   * Single tx: build + 7×speedup_tier2 + complete = 9 instructions
   */
  async buildAndCompleteBuilding(player: TestPlayer, buildingType: BuildingType | number): Promise<void> {
    const playerKey = player.publicKey.toBase58();
    const built = this.playerBuildings.get(playerKey) ?? new Set();

    // Skip if already built (in-memory)
    if (built.has(buildingType as number)) {
      return;
    }

    // Check on-chain estate for existing building
    const estateInfo = await this.ctx.connection.getAccountInfo(player.estatePda);
    if (estateInfo && estateInfo.data.length > 0) {
      // Scan building slots (last portion of account data)
      // Each BuildingSlot is 36 bytes: [building_type(u8), status(u8), ...]
      // Status 0 = Empty, anything else = building exists
      const SLOT_SIZE = 36;
      const MAX_SLOTS = 20;
      const slotsData = estateInfo.data.slice(estateInfo.data.length - MAX_SLOTS * SLOT_SIZE);
      for (let i = 0; i < MAX_SLOTS; i++) {
        const offset = i * SLOT_SIZE;
        const slotType = slotsData[offset]!;
        const slotStatus = slotsData[offset + 1]!;
        if (slotType === (buildingType as number) && slotStatus !== 0) {
          built.add(buildingType as number);
          this.playerBuildings.set(playerKey, built);
          return;
        }
      }
    }

    // Auto-build Mansion prerequisite if not already built
    if (buildingType !== BuildingType.Mansion && !built.has(BuildingType.Mansion)) {
      await this.buildAndCompleteBuilding(player, BuildingType.Mansion);
    }

    // Ensure player has gems for speedup (buy once, not per-building)
    if (!this.playerGemsReady.has(playerKey)) {
      await this.buyGems(player, 10);
      this.playerGemsReady.add(playerKey);
    }

    // Two-phase build: (1) build + 7×speedup, (2) more speedups + complete
    // Phase 1 always succeeds. Phase 2 handles longer build times that need extra speedups.
    const tx1 = new Transaction();
    tx1.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));

    // 1. Build
    tx1.add(createBuildBuildingInstruction(
      { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
      { buildingType }
    ));

    // 2. Speedup ×7 (tier 2: 25% remains each time)
    for (let i = 0; i < 7; i++) {
      tx1.add(createBuildingSpeedupInstruction(
        { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
        { buildingType, speedupTier: 2 }
      ));
    }

    // 3. Complete (may fail for longer builds where 7 speedups isn't enough)
    tx1.add(createCompleteBuildingInstruction(
      { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
      { buildingType }
    ));

    try {
      await sendTx(this.ctx.connection, tx1, [player.keypair], this.ctx.config);
    } catch (e: any) {
      const errCode = this.extractCustomError(e);
      if (errCode === 7706) {
        // BuildingAlreadyExists — fully built, just skip
        console.log(`[buildAndCompleteBuilding] Building ${buildingType} already exists, continuing`);
      } else if (errCode === 7708) {
        // ConstructionNotComplete — first tx rolled back, need to split into two txs
        console.log(`[buildAndCompleteBuilding] Building ${buildingType} needs split build...`);

        // Tx A: build + 7×speedup (no complete)
        const txA = new Transaction();
        txA.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
        txA.add(createBuildBuildingInstruction(
          { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
          { buildingType }
        ));
        for (let i = 0; i < 7; i++) {
          txA.add(createBuildingSpeedupInstruction(
            { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
            { buildingType, speedupTier: 2 }
          ));
        }
        await sendTx(this.ctx.connection, txA, [player.keypair], this.ctx.config);

        // Tx B: remaining speedups + complete
        await this.completeExistingBuilding(player, buildingType);
      } else {
        throw e;
      }
    }

    // Wait for validator to produce a new block after heavy building tx
    await new Promise(r => setTimeout(r, 1500));

    // Track built buildings for prerequisite handling
    built.add(buildingType as number);
    this.playerBuildings.set(playerKey, built);
  }

  /**
   * Extract Custom error code from a SendTransactionError.
   * Returns the numeric code or null if not found.
   */
  private extractCustomError(e: any): number | null {
    const txMsg = e?.transactionMessage ?? '';
    const match = txMsg.match(/"Custom":(\d+)/);
    return match?.[1] ? parseInt(match[1], 10) : null;
  }

  /**
   * Complete an already-started building with 1 extra speedup + complete.
   * Used when the first build+7xspeedup+complete tx fails with ConstructionNotComplete
   * (the tx rolled back, so we split: txA = build+7xspeedup, txB = 1xspeedup+complete).
   */
  private async completeExistingBuilding(player: TestPlayer, buildingType: BuildingType | number): Promise<void> {
    // After 7 speedups, remaining is ~5s. Each retry does 1 speedup + complete.
    // Speedup reduces remaining by 75% (tier 2: 25% remains).
    // When remaining < 4s, speedup truncates to 0 → complete succeeds.
    // Strategy: try 1 speedup + complete per round. If speedup causes InvalidParameter
    // (already at 0), just try complete alone. Retry up to 8 times.
    for (let round = 0; round < 8; round++) {
      // First, try complete alone (in case construction already ended)
      try {
        const completeTx = new Transaction();
        completeTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));
        completeTx.add(createCompleteBuildingInstruction(
          { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
          { buildingType }
        ));
        await sendTx(this.ctx.connection, completeTx, [player.keypair], this.ctx.config);
        return; // Success!
      } catch (e: any) {
        const errCode = this.extractCustomError(e);
        if (errCode !== 7708) {
          throw e; // Unexpected error
        }
        // ConstructionNotComplete — need more speedups
      }

      // Send 1 speedup to reduce remaining time
      try {
        const speedupTx = new Transaction();
        speedupTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));
        speedupTx.add(createBuildingSpeedupInstruction(
          { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
          { buildingType, speedupTier: 2 }
        ));
        await sendTx(this.ctx.connection, speedupTx, [player.keypair], this.ctx.config);
      } catch {
        // Speedup may fail with InvalidParameter if already at 0 — that's fine
      }
    }
  }

  /**
   * Upgrade a building to the specified level using upgrade + speedup + complete cycles.
   * Each cycle: upgrade + 7×speedup_tier2 + complete (same pattern as buildAndCompleteBuilding).
   * Buys additional gems as needed for speedup costs.
   */
  async upgradeAndCompleteBuilding(
    player: TestPlayer,
    buildingType: BuildingType | number,
    toLevel: number
  ): Promise<void> {
    // Buy extra gems for all the speedup cycles (10 gems per purchase × 5 purchases = 50 gems)
    for (let i = 0; i < 5; i++) {
      await this.buyGems(player, 10);
    }

    // Each cycle upgrades by 1 level. Repeat until we reach toLevel.
    for (let level = 2; level <= toLevel; level++) {
      const tx = new Transaction();
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));

      // 1. Start upgrade
      tx.add(createUpgradeBuildingInstruction(
        { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
        { buildingType }
      ));

      // 2. Speedup ×7 (tier 2: 25% remains each time)
      for (let i = 0; i < 7; i++) {
        tx.add(createBuildingSpeedupInstruction(
          { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
          { buildingType, speedupTier: 2 }
        ));
      }

      // 3. Complete
      tx.add(createCompleteBuildingInstruction(
        { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
        { buildingType }
      ));

      try {
        await sendTx(this.ctx.connection, tx, [player.keypair], this.ctx.config);
      } catch (e: any) {
        const errCode = this.extractCustomError(e);
        if (errCode === 7708) {
          // ConstructionNotComplete — split build
          const txA = new Transaction();
          txA.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
          txA.add(createUpgradeBuildingInstruction(
            { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
            { buildingType }
          ));
          for (let i = 0; i < 7; i++) {
            txA.add(createBuildingSpeedupInstruction(
              { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
              { buildingType, speedupTier: 2 }
            ));
          }
          await sendTx(this.ctx.connection, txA, [player.keypair], this.ctx.config);
          await this.completeExistingBuilding(player, buildingType);
        } else {
          throw e;
        }
      }

      // Brief wait between upgrade levels
      await new Promise(r => setTimeout(r, 500));
    }
  }

  /**
   * Fund a player with additional locked NOVI via DAO minting.
   * Uses mintForPrize across multiple allocation purposes, then converts
   * reserved NOVI to locked NOVI.
   *
   * Allocation caps: Development 150M, Liquidity 200M, Marketing 100M,
   * Partnership 50M, Treasury 50M, Prize 50M = 600M total.
   */
  async fundNovi(player: TestPlayer, amount: number): Promise<void> {
    const MAX_PER_CALL = 100_000_000; // 100M per proposal cap
    const purposes: { purpose: MintPurpose; cap: number }[] = [
      { purpose: MintPurpose.Development, cap: 150_000_000 },
      { purpose: MintPurpose.Liquidity,   cap: 200_000_000 },
      { purpose: MintPurpose.Marketing,   cap: 100_000_000 },
      { purpose: MintPurpose.Partnership, cap: 50_000_000 },
      { purpose: MintPurpose.Treasury,    cap: 50_000_000 },
      { purpose: MintPurpose.Prize,       cap: 50_000_000 },
    ];

    let remaining = amount;
    for (const { purpose, cap } of purposes) {
      if (remaining <= 0) break;
      let allocated = 0;
      while (allocated < cap && remaining > 0) {
        const thisAmount = Math.min(MAX_PER_CALL, cap - allocated, remaining);

        // Mint to reserved_novi (DAO signs)
        const mintTx = new Transaction().add(
          createMintForPrizeInstruction(
            { authority: this.ctx.daoAuthority.publicKey, gameEngine: this.ctx.gameEngine, recipientOwner: player.publicKey },
            { amount: new BN(thisAmount), purpose }
          )
        );
        await sendTx(this.ctx.connection, mintTx, [this.ctx.daoAuthority], this.ctx.config);

        // Convert reserved → locked (player signs)
        const convertTx = new Transaction().add(
          createReservedToLockedInstruction(
            { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
            { amount: new BN(thisAmount) }
          )
        );
        await sendTx(this.ctx.connection, convertTx, [player.keypair], this.ctx.config);

        allocated += thisAmount;
        remaining -= thisAmount;
      }
    }
  }

  /**
   * Move a player to another player's location for combat testing.
   * Uses gems to speedup travel for instant movement.
   *
   * Flow:
   * 1. Buy gems (for speedup costs)
   * 2. If different cities: intercity travel with speedup
   * 3. Complete intercity travel
   * 4. If needed: intracity travel to get within 10m
   */
  async movePlayerToPlayer(
    mover: TestPlayer,
    target: TestPlayer
  ): Promise<void> {
    const moverLocation = await this.getPlayerLocation(mover);
    const targetLocation = await this.getPlayerLocation(target);

    if (!moverLocation || !targetLocation) {
      throw new Error('Could not get player locations');
    }

    // Buy gems for speedup (1000 gems per purchase should be plenty)
    await this.buyGems(mover, 1);

    // If in different cities, need intercity travel first
    if (moverLocation.cityId !== targetLocation.cityId) {
      // Offset destination by +1 gridLong to avoid colliding with target player's cell
      // (Use longitude offset to avoid collision with factory's latitude-based spawn offsets)
      const destGridLat = targetLocation.gridLat;
      const destGridLong = targetLocation.gridLong + 2;

      // Start intercity travel to offset cell near target
      await this.startIntercityTravel(
        mover,
        moverLocation.cityId,
        targetLocation.cityId,
        moverLocation.gridLat,
        moverLocation.gridLong,
        destGridLat,
        destGridLong
      );

      // Speedup travel repeatedly (tier 2 = 25% time remains per application)
      // Need ~12 applications to reduce multi-hour intercity travel to under 1s
      for (let i = 0; i < 12; i++) {
        try {
          await this.speedupTravel(mover, 2);
        } catch {
          break; // Already fast enough
        }
      }

      // Delay to let remaining time elapse
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Complete intercity travel at the offset destination
      await this.completeIntercityTravel(
        mover,
        moverLocation.cityId,
        targetLocation.cityId,
        destGridLat,
        destGridLong
      );
    }

    // Now in same city - move to adjacent cell for combat range
    // Use longitude offset to avoid colliding with factory's latitude-based spawn positions
    const adjacentLat = targetLocation.gridLat;
    const adjacentLong = targetLocation.gridLong + 1; // ~11m offset
    // Get current location after potential intercity travel
    const currentLocation = await this.getPlayerLocation(mover);
    const currentGridLat = currentLocation?.gridLat || moverLocation.gridLat;
    const currentGridLong = currentLocation?.gridLong || moverLocation.gridLong;

    await this.startIntracityTravel(
      mover,
      targetLocation.cityId,
      currentGridLat,
      currentGridLong,
      adjacentLat / 10000, // Convert grid to f64 (grid = round(coord * 10000))
      adjacentLong / 10000  // Convert grid to f64
    );

    // Speedup intracity travel
    for (let i = 0; i < 10; i++) {
      try {
        await this.speedupTravel(mover, 2);
      } catch {
        break;
      }
    }

    // Delay to let remaining time elapse
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Complete intracity travel
    await this.completeIntracityTravel(
      mover,
      targetLocation.cityId,
      adjacentLat,
      adjacentLong
    );
  }

  /**
   * Get a player by index.
   */
  getPlayer(index: number): TestPlayer | undefined {
    return this.players.get(index);
  }

  /**
   * Get all created players.
   */
  getAllPlayers(): TestPlayer[] {
    return Array.from(this.players.values());
  }

  /**
   * Clear player pool (for test isolation).
   */
  clear(): void {
    this.players.clear();
    this.nextIndex = 0;
    this.citySpawnCount.clear();
  }
}

// ============================================================
// Pre-configured Player Scenarios
// ============================================================

export interface CombatReadyPlayers {
  attacker: TestPlayer;
  defender: TestPlayer;
}

export interface TeamReadyPlayers {
  leader: TestPlayer;
  members: TestPlayer[];
}

export interface RallyReadyPlayers {
  creator: TestPlayer;
  participants: TestPlayer[];
  target: TestPlayer;
}

/**
 * Create two players ready for combat testing.
 * Players start in different cities (to avoid spawn collision) but
 * the attacker is moved to within combat range of the defender.
 *
 * Attacker has more offensive units, defender has more defensive units.
 *
 * @param options.moveToRange - If true (default), moves attacker within combat range of defender
 */
export async function createCombatReadyPlayers(
  factory: PlayerFactory,
  options: { moveToRange?: boolean } = {}
): Promise<CombatReadyPlayers> {
  const moveToRange = options.moveToRange ?? true;

  // Create defender first (in city 1) - needs Barracks for units, Market for equipment
  const defender = await factory.createPlayer({ initialize: true, cityId: 1, createEstate: true, buildings: [BuildingType.Barracks, BuildingType.Market, BuildingType.Stables] });

  // Create attacker in a DIFFERENT city (to avoid spawn collision) - needs Stables for travel
  const attacker = await factory.createPlayer({ initialize: true, cityId: 2, createEstate: true, buildings: [BuildingType.Barracks, BuildingType.Market, BuildingType.Stables] });

  // Give attacker more operatives
  await factory.hireUnits(attacker, 0, 100); // operative unit 1
  await factory.hireUnits(attacker, 1, 50);  // operative unit 2
  await factory.purchaseEquipment(attacker, 0, 50); // melee weapons
  await factory.purchaseEquipment(attacker, 1, 30); // ranged weapons

  // Give defender more defensives
  await factory.hireUnits(defender, 0, 150); // defensive unit 1
  await factory.hireUnits(defender, 1, 75);  // defensive unit 2
  await factory.purchaseEquipment(defender, 3, 100); // armor

  // Move attacker to within combat range of defender
  if (moveToRange) {
    await factory.movePlayerToPlayer(attacker, defender);
  }

  return { attacker, defender };
}

/**
 * Create players ready for team testing.
 * Each player is in a different city (auto-cycled) to avoid spawn collision.
 */
export async function createTeamReadyPlayers(
  factory: PlayerFactory,
  memberCount: number = 3
): Promise<TeamReadyPlayers> {
  // Each player gets auto-assigned a unique city
  const leader = await factory.createPlayer({ initialize: true });
  const members: TestPlayer[] = [];

  for (let i = 0; i < memberCount; i++) {
    const member = await factory.createPlayer({ initialize: true });
    members.push(member);
  }

  return { leader, members };
}

/**
 * Create players ready for rally testing.
 * Each player is in a different city (auto-cycled) to avoid spawn collision.
 *
 * NOTE: Rally participants may need to travel to rally point depending on rally rules.
 * Use factory.movePlayerToPlayer() if needed.
 */
export async function createRallyReadyPlayers(
  factory: PlayerFactory,
  participantCount: number = 3
): Promise<RallyReadyPlayers> {
  // Creator needs estate + Barracks (for units) + Market (for equipment) + Citadel (to CREATE rallies) + Stables (for travel)
  // Extension chain: Research → Inventory (estate+gems) → Team → Rally
  const creator = await factory.createPlayer({
    initialize: true,
    createEstate: true,
    buildings: [BuildingType.Barracks, BuildingType.Market, BuildingType.Citadel, BuildingType.Stables],
  });

  const participants: TestPlayer[] = [];

  for (let i = 0; i < participantCount; i++) {
    // Participants need estate+gems (for EXT_INVENTORY → EXT_TEAM) + Barracks (for units) + Stables (for travel) to JOIN rallies
    const participant = await factory.createPlayer({
      initialize: true,
      createEstate: true,
      buildings: [BuildingType.Barracks, BuildingType.Stables],
    });
    // Give each participant some defensive units (type 0 = defensive_unit_1)
    await factory.hireUnits(participant, 0, 50000);
    participants.push(participant);
  }

  // Create a strong defender as target (needs Barracks for units, Market for equipment, Stables for travel)
  const target = await factory.createPlayer({
    initialize: true,
    createEstate: true,
    buildings: [BuildingType.Barracks, BuildingType.Market, BuildingType.Stables],
  });
  await factory.hireUnits(target, 0, 100000);
  await factory.hireUnits(target, 1, 50000);
  await factory.purchaseEquipment(target, 3, 300);

  // Give creator defensive units (type 0 = defensive_unit_1) and equipment
  // Use large NOVI amount to ensure enough units are produced
  await factory.hireUnits(creator, 0, 50000);
  await factory.purchaseEquipment(creator, 0, 50);

  return { creator, participants, target };
}
