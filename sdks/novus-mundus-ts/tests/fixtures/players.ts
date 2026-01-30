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
} from '@solana/web3.js';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';

import {
  createInitPlayerInstruction,
  createHireUnitsInstruction,
  createPurchaseEquipmentInstruction,
  createCreateEstateInstruction,
  createIntercityStartInstruction,
  createIntercityCompleteInstruction,
  createIntracityStartInstruction,
  createIntracityCompleteInstruction,
  createTravelSpeedupInstruction,
  createPurchaseItemInstruction,
  derivePlayerPda,
  deriveEstatePda,
  deriveLocationPda,
  deriveGameEnginePda,
  deriveCityPda,
  deserializePlayer,
  type PlayerAccount,
  PROGRAM_ID,
} from '../../src/index';

import { CITIES, TEST_GEMS_ITEM } from './setup';

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
  defaultCityId: 1,
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
    } = {}
  ): Promise<TestPlayer> {
    const index = this.nextIndex++;
    const keypair = options.customKeypair || loadOrCreatePlayerKeypair(index);
    const [playerPda, playerBump] = derivePlayerPda(this.ctx.gameEngine, keypair.publicKey);
    const [estatePda, estateBump] = deriveEstatePda(keypair.publicKey);

    // Auto-assign unique city if autoCycleCities is enabled and no explicit cityId
    let cityId: number;
    if (options.cityId !== undefined) {
      cityId = options.cityId;
    } else if (this.config.autoCycleCities) {
      // Cycle through available cities (1-indexed, mod by CITIES.length)
      cityId = (index % CITIES.length) + 1;
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

    // Initialize player if requested
    const shouldInit = options.initialize ?? this.config.autoInit;
    if (shouldInit) {
      await this.initializePlayer(player);
    }

    // Create estate if requested
    const shouldEstate = options.createEstate ?? this.config.autoEstate;
    if (shouldEstate && player.initialized) {
      await this.createPlayerEstate(player);
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
    originGridLong: number
  ): Promise<void> {
    const [originLocation] = deriveLocationPda(this.ctx.gameEngine, originCityId, originGridLat, originGridLong);
    // Destination location will be derived based on city center
    const [destinationLocation] = deriveLocationPda(this.ctx.gameEngine, destinationCityId, 0, 0);

    const ix = createIntercityStartInstruction({
      owner: player.publicKey,
      gameEngine: this.ctx.gameEngine,
      originCityId,
      destinationCityId,
      originLocation,
      destinationLocation,
      originCreatorRefund: this.ctx.gameEngine,
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
    // Grid coords are different from actual lat/long
    const destGridLat = Math.floor(destLat / 100);
    const destGridLong = Math.floor(destLong / 100);
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
    await sendTx(this.ctx.connection, tx, [player.keypair], this.ctx.config);
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
      // Start intercity travel
      await this.startIntercityTravel(
        mover,
        moverLocation.cityId,
        targetLocation.cityId,
        moverLocation.gridLat,
        moverLocation.gridLong
      );

      // Speedup travel (tier 2 = 25% time remains)
      try {
        await this.speedupTravel(mover, 2);
      } catch {
        // May fail if travel time is already very short
      }

      // Speedup again if needed (reduces to ~6% of original)
      try {
        await this.speedupTravel(mover, 2);
      } catch {
        // May fail if already fast enough
      }

      // Small delay to let remaining time elapse
      await new Promise(resolve => setTimeout(resolve, 100));

      // Complete intercity travel
      await this.completeIntercityTravel(
        mover,
        moverLocation.cityId,
        targetLocation.cityId,
        targetLocation.gridLat,
        targetLocation.gridLong
      );
    }

    // Now in same city - move to adjacent cell for combat range
    // Use intracity travel to get within 10m of target
    const adjacentLat = targetLocation.gridLat + 1; // ~11m offset, within 10m range
    const adjacentLong = targetLocation.gridLong;
    // Get current location after potential intercity travel
    const currentLocation = await this.getPlayerLocation(mover);
    const currentGridLat = currentLocation?.gridLat || moverLocation.gridLat;
    const currentGridLong = currentLocation?.gridLong || moverLocation.gridLong;

    await this.startIntracityTravel(
      mover,
      targetLocation.cityId,
      currentGridLat,
      currentGridLong,
      adjacentLat * 100 + 50, // Convert grid to approx lat
      adjacentLong * 100 + 50  // Convert grid to approx long
    );

    // Speedup intracity travel
    try {
      await this.speedupTravel(mover, 2);
    } catch {
      // May fail if travel time is already very short
    }

    // Small delay
    await new Promise(resolve => setTimeout(resolve, 100));

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

  // Create defender first (in city 1)
  const defender = await factory.createPlayer({ initialize: true, cityId: 1 });

  // Create attacker in a DIFFERENT city (to avoid spawn collision)
  const attacker = await factory.createPlayer({ initialize: true, cityId: 2 });

  // Give attacker more operatives
  await factory.hireUnits(attacker, 3, 100); // operative unit 1
  await factory.hireUnits(attacker, 4, 50);  // operative unit 2
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
  // Each player gets auto-assigned a unique city
  const creator = await factory.createPlayer({ initialize: true });
  const participants: TestPlayer[] = [];

  for (let i = 0; i < participantCount; i++) {
    const participant = await factory.createPlayer({ initialize: true });
    // Give each participant some operatives
    await factory.hireUnits(participant, 3, 50);
    participants.push(participant);
  }

  // Create a strong defender as target
  const target = await factory.createPlayer({ initialize: true });
  await factory.hireUnits(target, 0, 500);
  await factory.hireUnits(target, 1, 250);
  await factory.purchaseEquipment(target, 3, 300);

  // Give creator operatives too
  await factory.hireUnits(creator, 3, 100);
  await factory.purchaseEquipment(creator, 0, 50);

  return { creator, participants, target };
}
