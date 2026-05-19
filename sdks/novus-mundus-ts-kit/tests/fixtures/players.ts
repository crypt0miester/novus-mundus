/**
 * Test Player Factory
 *
 * Creates and manages test players for E2E tests.
 */

import {
  generateKeyPairSigner,
  type Address,
  type KeyPairSigner,
} from '@solana/kit';

/** Lamports in one SOL (web3.js `LAMPORTS_PER_SOL` replacement). */
const LAMPORTS_PER_SOL = 1_000_000_000;

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
  createBuyPlotInstruction,
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
import { advanceTime } from './time';

import { type TestContext, airdropIfNeeded } from './setup';
import { sendInstructions } from '../utils/transactions';

// Types

export interface TestPlayer {
  keypair: KeyPairSigner;
  publicKey: Address;
  playerPda: Address;
  playerBump: number;
  estatePda: Address;
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

// Player Pool

/**
 * Create a fresh player keypair signer.
 *
 * NOTE: kit's `KeyPairSigner` does not expose a raw secret-key byte array,
 * so the old `keys/players/*.json` persistence is not reproducible here.
 * Tests do not rely on stable keys, so each run generates fresh ones.
 */
async function loadOrCreatePlayerKeypair(_index: number): Promise<KeyPairSigner> {
  return generateKeyPairSigner();
}

// Player Factory

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
      customKeypair?: KeyPairSigner;
      /** Building types to auto-construct after estate creation */
      buildings?: (BuildingType | number)[];
    } = {}
  ): Promise<TestPlayer> {
    const index = this.nextIndex++;
    const keypair = options.customKeypair || (await loadOrCreatePlayerKeypair(index));
    const [playerPda, playerBump] = await derivePlayerPda(this.ctx.gameEngine, keypair.address);
    const [estatePda, estateBump] = await deriveEstatePda(playerPda);

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
      publicKey: keypair.address,
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
      this.ctx.svm,
      keypair.address,
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
    const accountInfo = await this.ctx.svm.getAccount(player.playerPda);
    if (accountInfo.exists && accountInfo.data.length > 0) {
      player.initialized = true;
      return;
    }

    const city = CITIES.find(c => c.id === player.startingCityId);
    if (!city) throw new Error(`City ${player.startingCityId} not found`);

    const spawnIndex = this.citySpawnCount.get(player.startingCityId) ?? 0;
    this.citySpawnCount.set(player.startingCityId, spawnIndex + 1);
    const spawnLat = city.lat + spawnIndex * 0.0001;
    const spawnLon = city.lon;

    await sendInstructions(
      this.ctx.svm,
      await Promise.all([
        // 1. Init user (creates user PDA)
        createInitUserInstruction({
          owner: player.publicKey,
          gameEngine: this.ctx.gameEngine,
        }),
        // 2. Init player (reads user PDA created above)
        createInitPlayerInstruction({
          owner: player.publicKey,
          gameEngine: this.ctx.gameEngine,
          startingCityId: player.startingCityId,
          cityLatitude: spawnLat,
          cityLongitude: spawnLon,
        }),
        // 3. Unlock research (reads player PDA created above)
        createCreateProgressInstruction({
          owner: player.publicKey,
          gameEngine: this.ctx.gameEngine,
        }),
      ]),
      [player.keypair],
      // Request extra compute for 3 account-creating instructions
      { computeUnits: 600_000 },
    );
    player.initialized = true;
  }

  /**
   * Batched estate: createEstate + buyGems in ONE transaction.
   */
  async createEstateBatched(player: TestPlayer, includeGems: boolean = false): Promise<void> {
    if (player.hasEstate) return;

    const accountInfo = await this.ctx.svm.getAccount(player.estatePda);
    if (accountInfo.exists && accountInfo.data.length > 0) {
      player.hasEstate = true;
      return;
    }

    const ixs = [
      // 1. Create estate
      await createCreateEstateInstruction(
        { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
        { cityId: 1 }
      ),
    ];

    // 2. Buy gems (for building speedups)
    if (includeGems) {
      ixs.push(await createPurchaseItemInstruction(
        {
          buyer: player.publicKey,
          gameEngine: this.ctx.gameEngine,
          itemId: TEST_GEMS_ITEM.itemId,
          treasury: this.ctx.treasury.address,
        },
        { quantity: 10 }
      ));
      this.playerGemsReady.add(player.publicKey);
    }

    await sendInstructions(this.ctx.svm, ixs, [player.keypair]);
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
    const accountInfo = await this.ctx.svm.getAccount(player.playerPda);
    if (accountInfo.exists && accountInfo.data.length > 0) {
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

    const ix = await createInitPlayerInstruction({
      owner: player.publicKey,
      gameEngine: this.ctx.gameEngine,
      startingCityId: player.startingCityId,
      cityLatitude: spawnLat,
      cityLongitude: spawnLon,
    });

    await sendInstructions(this.ctx.svm, [ix], [player.keypair]);
    player.initialized = true;
  }

  /**
   * Initialize a user account for the player (subscription/reserved NOVI).
   */
  async initializeUser(player: TestPlayer): Promise<void> {
    const [userPda] = await deriveUserPda(player.publicKey);

    // Check if already initialized
    const accountInfo = await this.ctx.svm.getAccount(userPda);
    if (accountInfo.exists && accountInfo.data.length > 0) {
      return;
    }

    const ix = await createInitUserInstruction({
      owner: player.publicKey,
      gameEngine: this.ctx.gameEngine,
    });

    await sendInstructions(this.ctx.svm, [ix], [player.keypair]);
  }

  /**
   * Unlock EXT_RESEARCH extension by creating research progress.
   * This is the first extension in the user journey.
   */
  async unlockResearch(player: TestPlayer): Promise<void> {
    if (!player.initialized) {
      throw new Error('Player must be initialized before unlocking research');
    }

    const ix = await createCreateProgressInstruction({
      owner: player.publicKey,
      gameEngine: this.ctx.gameEngine,
    });

    try {
      await sendInstructions(this.ctx.svm, [ix], [player.keypair]);
    } catch (e: any) {
      console.error('[unlockResearch] Failed:', e.transactionMessage || e.message);
      if (e.getLogs) {
        const logs = await e.getLogs(this.ctx.svm);
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
    const accountInfo = await this.ctx.svm.getAccount(player.estatePda);
    if (accountInfo.exists && accountInfo.data.length > 0) {
      player.hasEstate = true;
      return;
    }

    const ix = await createCreateEstateInstruction(
      { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
      { cityId: 1 }
    );

    await sendInstructions(this.ctx.svm, [ix], [player.keypair]);
    player.hasEstate = true;
  }

  /**
   * Get player account data.
   */
  async getPlayerAccount(player: TestPlayer): Promise<PlayerAccount | null> {
    const accountInfo = await this.ctx.svm.getAccount(player.playerPda);
    if (!accountInfo.exists || accountInfo.data.length === 0) {
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
    noviAmount: bigint | number
  ): Promise<void> {
    const ix = await createHireUnitsInstruction(
      { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
      { unitType, noviAmount: BigInt(noviAmount) }
    );

    await sendInstructions(this.ctx.svm, [ix], [player.keypair]);
  }

  /**
   * Purchase equipment for a player.
   */
  async purchaseEquipment(
    player: TestPlayer,
    equipmentType: number,
    quantity: bigint | number
  ): Promise<void> {
    const ix = await createPurchaseEquipmentInstruction(
      { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
      { equipmentType, quantity: BigInt(quantity), payWithCash: false }
    );

    await sendInstructions(this.ctx.svm, [ix], [player.keypair]);
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
    const [originLocation] = await deriveLocationPda(this.ctx.gameEngine, originCityId, originGridLat, originGridLong);
    // Use provided destination grid coords, or default to city center
    const destCity = CITIES[destinationCityId]!;
    const GRID_PRECISION = 10000.0;
    const finalDestGridLat = destGridLat ?? Math.round(destCity.lat * GRID_PRECISION);
    const finalDestGridLong = destGridLong ?? Math.round(destCity.lon * GRID_PRECISION);
    const [destinationLocation] = await deriveLocationPda(this.ctx.gameEngine, destinationCityId, finalDestGridLat, finalDestGridLong);

    const ix = await createIntercityStartInstruction({
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

    await sendInstructions(this.ctx.svm, [ix], [player.keypair]);
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
    const [destinationLocation] = await deriveLocationPda(this.ctx.gameEngine, destinationCityId, destGridLat, destGridLong);

    const ix = await createIntercityCompleteInstruction({
      owner: player.publicKey,
      gameEngine: this.ctx.gameEngine,
      originCityId,
      destinationCityId,
      destinationLocation,
    });

    await sendInstructions(this.ctx.svm, [ix], [player.keypair]);
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
    const [originLocation] = await deriveLocationPda(this.ctx.gameEngine, cityId, originGridLat, originGridLong);
    const [destinationLocation] = await deriveLocationPda(this.ctx.gameEngine, cityId, destGridLat, destGridLong);

    const ix = await createIntracityStartInstruction(
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

    await sendInstructions(this.ctx.svm, [ix], [player.keypair]);
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
    const [destinationLocation] = await deriveLocationPda(this.ctx.gameEngine, cityId, destGridLat, destGridLong);

    const ix = await createIntracityCompleteInstruction({
      owner: player.publicKey,
      gameEngine: this.ctx.gameEngine,
      cityId,
      destinationLocation,
    });

    await sendInstructions(this.ctx.svm, [ix], [player.keypair]);
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
    const preInfo = await this.ctx.svm.getAccount(player.playerPda);
    if (preInfo.exists) {
      console.log(`[buyGems] PRE: data_len=${preInfo.data.length} lamports=${preInfo.lamports}`);
    }

    const ix = await createPurchaseItemInstruction(
      {
        buyer: player.publicKey,
        gameEngine: this.ctx.gameEngine,
        itemId: TEST_GEMS_ITEM.itemId,
        treasury: this.ctx.treasury.address,
      },
      { quantity: purchases }
    );

    try {
      await sendInstructions(this.ctx.svm, [ix], [player.keypair]);
    } catch (e: any) {
      console.error('[buyGems] Failed:', e.transactionMessage || e.message);
      if (e.getLogs) {
        const logs = await e.getLogs(this.ctx.svm);
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
    const ix = await createPurchaseItemInstruction(
      {
        buyer: player.publicKey,
        gameEngine: this.ctx.gameEngine,
        itemId: TEST_FRAGMENTS_ITEM.itemId,
        treasury: this.ctx.treasury.address,
      },
      { quantity: purchases }
    );

    await sendInstructions(this.ctx.svm, [ix], [player.keypair]);
  }

  /**
   * Complete a research type: start → speedup → complete.
   * Requires: player initialized, estate with Academy (Lv 1+), research progress PDA created.
   */
  async completeResearch(player: TestPlayer, researchType: number): Promise<void> {
    // Ensure gems for speedup
    const playerKey = player.publicKey;
    if (!this.playerGemsReady.has(playerKey)) {
      await this.buyGems(player, 10);
      this.playerGemsReady.add(playerKey);
    }

    // Start research
    const startIx = await createStartResearchInstruction({
      gameEngine: this.ctx.gameEngine,
      owner: player.publicKey,
      researchType,
    });
    await sendInstructions(this.ctx.svm, [startIx], [player.keypair]);

    // Speedup to completion (0 = complete all remaining)
    const speedupIx = await createSpeedUpResearchInstruction(
      { gameEngine: this.ctx.gameEngine, owner: player.publicKey, researchType },
      { speedUpSeconds: 0n }
    );
    await sendInstructions(this.ctx.svm, [speedupIx], [player.keypair]);

    // Complete research
    const completeIx = await createCompleteResearchInstruction({
      gameEngine: this.ctx.gameEngine,
      payer: player.publicKey,
      playerOwner: player.publicKey,
      researchType,
    });
    await sendInstructions(this.ctx.svm, [completeIx], [player.keypair]);
  }

  /**
   * Speed up current travel using gems.
   * Tier 1 = 50% time remains, Tier 2 = 25% time remains.
   */
  async speedupTravel(player: TestPlayer, tier: 1 | 2 = 2): Promise<void> {
    const ix = await createTravelSpeedupInstruction(
      { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
      { speedupTier: tier }
    );

    await sendInstructions(this.ctx.svm, [ix], [player.keypair]);
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
    const playerKey = player.publicKey;
    const built = this.playerBuildings.get(playerKey) ?? new Set();

    // Skip if already built (in-memory)
    if (built.has(buildingType as number)) {
      return;
    }

    // Check on-chain estate for existing building
    const estateInfo = await this.ctx.svm.getAccount(player.estatePda);
    if (estateInfo.exists && estateInfo.data.length > 0) {
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
    const tx1Ixs = [
      // 1. Build
      await createBuildBuildingInstruction(
        { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
        { buildingType }
      ),
    ];

    // 2. Speedup ×7 (tier 2: 25% remains each time)
    for (let i = 0; i < 7; i++) {
      tx1Ixs.push(await createBuildingSpeedupInstruction(
        { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
        { buildingType, speedupTier: 2 }
      ));
    }

    // 3. Complete (may fail for longer builds where 7 speedups isn't enough)
    tx1Ixs.push(await createCompleteBuildingInstruction(
      { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
      { buildingType }
    ));

    try {
      await sendInstructions(this.ctx.svm, tx1Ixs, [player.keypair], { computeUnits: 400_000 });
    } catch (e: any) {
      const errCode = this.extractCustomError(e);
      if (errCode === 7705) {
        // BuildingSlotFull — buy an extra plot and retry
        console.log(`[buildAndCompleteBuilding] Building slots full, buying extra plot...`);
        await sendInstructions(
          this.ctx.svm,
          [await createBuyPlotInstruction({ owner: player.publicKey, gameEngine: this.ctx.gameEngine })],
          [player.keypair],
        );
        return this.buildAndCompleteBuilding(player, buildingType);
      } else if (errCode === 7706) {
        // BuildingAlreadyExists — fully built, just skip
        console.log(`[buildAndCompleteBuilding] Building ${buildingType} already exists, continuing`);
      } else if (errCode === 7708) {
        // ConstructionNotComplete — first tx rolled back, need to split into two txs
        console.log(`[buildAndCompleteBuilding] Building ${buildingType} needs split build...`);

        // Tx A: build + 7×speedup (no complete)
        const txAIxs = [
          await createBuildBuildingInstruction(
            { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
            { buildingType }
          ),
        ];
        for (let i = 0; i < 7; i++) {
          txAIxs.push(await createBuildingSpeedupInstruction(
            { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
            { buildingType, speedupTier: 2 }
          ));
        }
        await sendInstructions(this.ctx.svm, txAIxs, [player.keypair], { computeUnits: 400_000 });

        // Tx B: remaining speedups + complete
        await this.completeExistingBuilding(player, buildingType);
      } else {
        throw e;
      }
    }

    // Track built buildings for prerequisite handling
    built.add(buildingType as number);
    this.playerBuildings.set(playerKey, built);
  }

  /**
   * Extract Custom error code from a SendTransactionError.
   * Returns the numeric code or null if not found.
   */
  private extractCustomError(e: any): number | null {
    const msg = e?.message ?? '';
    // Match "(7706):" from "BuildingAlreadyExists (7706): ..." format
    const nameMatch = msg.match(/\((\d+)\):/);
    if (nameMatch?.[1]) return parseInt(nameMatch[1], 10);
    // Match "custom program error: 0x1e1a" hex format
    const hexMatch = msg.match(/custom program error: 0x([0-9a-f]+)/i);
    if (hexMatch?.[1]) return parseInt(hexMatch[1], 16);
    // Match "Custom(7706)" from raw LiteSVM format
    const customMatch = msg.match(/Custom\((\d+)\)/);
    if (customMatch?.[1]) return parseInt(customMatch[1], 10);
    return null;
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
        await sendInstructions(
          this.ctx.svm,
          [await createCompleteBuildingInstruction(
            { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
            { buildingType }
          )],
          [player.keypair],
          { computeUnits: 200_000 },
        );
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
        await sendInstructions(
          this.ctx.svm,
          [await createBuildingSpeedupInstruction(
            { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
            { buildingType, speedupTier: 2 }
          )],
          [player.keypair],
          { computeUnits: 200_000 },
        );
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
      // 1. Start upgrade
      const txIxs = [
        await createUpgradeBuildingInstruction(
          { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
          { buildingType }
        ),
      ];

      // 2. Speedup ×7 (tier 2: 25% remains each time)
      for (let i = 0; i < 7; i++) {
        txIxs.push(await createBuildingSpeedupInstruction(
          { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
          { buildingType, speedupTier: 2 }
        ));
      }

      // 3. Complete
      txIxs.push(await createCompleteBuildingInstruction(
        { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
        { buildingType }
      ));

      try {
        await sendInstructions(this.ctx.svm, txIxs, [player.keypair], { computeUnits: 400_000 });
      } catch (e: any) {
        const errCode = this.extractCustomError(e);
        if (errCode === 7708) {
          // ConstructionNotComplete — split build
          const txAIxs = [
            await createUpgradeBuildingInstruction(
              { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
              { buildingType }
            ),
          ];
          for (let i = 0; i < 7; i++) {
            txAIxs.push(await createBuildingSpeedupInstruction(
              { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
              { buildingType, speedupTier: 2 }
            ));
          }
          await sendInstructions(this.ctx.svm, txAIxs, [player.keypair], { computeUnits: 400_000 });
          await this.completeExistingBuilding(player, buildingType);
        } else {
          throw e;
        }
      }

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
        await sendInstructions(
          this.ctx.svm,
          [await createMintForPrizeInstruction(
            { authority: this.ctx.daoAuthority.address, gameEngine: this.ctx.gameEngine, recipientOwner: player.publicKey },
            { amount: BigInt(thisAmount), purpose }
          )],
          [this.ctx.daoAuthority],
        );

        // Convert reserved → locked (player signs)
        await sendInstructions(
          this.ctx.svm,
          [await createReservedToLockedInstruction(
            { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
            { amount: BigInt(thisAmount) }
          )],
          [player.keypair],
        );

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

      // Advance LiteSVM clock past travel arrival time
      await advanceTime(this.ctx.svm, 5);

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

    // Advance LiteSVM clock past travel arrival time
    await advanceTime(this.ctx.svm, 5);

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

// Pre-configured Player Scenarios

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
  const defender = await factory.createPlayer({ initialize: true, cityId: 1, createEstate: true, buildings: [BuildingType.Barracks, BuildingType.Market, BuildingType.TransportBay] });

  // Create attacker in a DIFFERENT city (to avoid spawn collision) - needs Stables for travel
  const attacker = await factory.createPlayer({ initialize: true, cityId: 2, createEstate: true, buildings: [BuildingType.Barracks, BuildingType.Market, BuildingType.TransportBay] });

  // Give attacker more operatives. Use ≥ 500 NOVI per hire — both the Consuming
  // and Hiring time-of-day multipliers compound (each can be 0.618), so 100 NOVI
  // can still floor to 0 units at unfavorable times (~0.382 effective). 500 is
  // safely above that threshold and matches the lifecycle helper's choice.
  await factory.hireUnits(attacker, 0, 500); // defensive unit 1
  await factory.hireUnits(attacker, 1, 500); // defensive unit 2
  await factory.purchaseEquipment(attacker, 0, 50); // melee weapons
  await factory.purchaseEquipment(attacker, 1, 30); // ranged weapons

  // Give defender more defensives
  await factory.hireUnits(defender, 0, 500); // defensive unit 1
  await factory.hireUnits(defender, 1, 500); // defensive unit 2
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
    buildings: [BuildingType.Barracks, BuildingType.Market, BuildingType.Citadel, BuildingType.TransportBay],
  });

  const participants: TestPlayer[] = [];

  for (let i = 0; i < participantCount; i++) {
    // Participants need estate+gems (for EXT_INVENTORY → EXT_TEAM) + Barracks (for units) + Stables (for travel) to JOIN rallies
    const participant = await factory.createPlayer({
      initialize: true,
      createEstate: true,
      buildings: [BuildingType.Barracks, BuildingType.TransportBay],
    });
    // Give each participant some defensive units (type 0 = defensive_unit_1)
    await factory.hireUnits(participant, 0, 50000);
    participants.push(participant);
  }

  // Create a strong defender as target (needs Barracks for units, Market for equipment, Stables for travel)
  const target = await factory.createPlayer({
    initialize: true,
    createEstate: true,
    buildings: [BuildingType.Barracks, BuildingType.Market, BuildingType.TransportBay],
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
