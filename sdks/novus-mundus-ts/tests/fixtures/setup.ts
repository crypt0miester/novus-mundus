/**
 * Global Test Setup
 *
 * Initializes the game infrastructure required for all tests.
 * This includes: GameEngine, Cities, Hero Templates, Research Templates.
 */

import {
  Connection,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  PublicKey,
  type Commitment,
} from '@solana/web3.js';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';
import { startValidator, stopValidator } from './validator';
import { startProgramLogListener, stopProgramLogListener } from '../utils/logger';

import {
  createInitGameEngineInstruction,
  createBatchCitiesInstruction,
  createCreateCollectionInstruction,
  createCreateTemplateInstruction,
  createInitializeTemplateInstruction,
  createInitializeConfigInstruction,
  createCreateItemInstruction,
  deriveGameEnginePda,
  deriveHeroCollectionPda,
  deriveHeroTemplatePda,
  deriveResearchTemplatePda,
  deriveCityPda,
  deriveShopConfigPda,
  deriveShopItemPda,
  PROGRAM_ID,
} from '../../src/index';

// ============================================================
// Configuration
// ============================================================

export interface TestConfig {
  rpcUrl: string;
  commitment: Commitment;
  skipPreflight: boolean;
  /** Whether to initialize game infrastructure if not present */
  autoSetup: boolean;
}

export const DEFAULT_CONFIG: TestConfig = {
  rpcUrl: process.env.RPC_URL || 'http://localhost:8899',
  commitment: 'confirmed',
  skipPreflight: true,
  autoSetup: true,
};

// ============================================================
// Test Context
// ============================================================

export interface TestContext {
  connection: Connection;
  config: TestConfig;
  daoAuthority: Keypair;
  treasury: Keypair;
  kingdomId: number;
  gameEngine: PublicKey;
  heroCollection: PublicKey;
  cities: Map<number, PublicKey>;
  heroTemplates: Map<number, PublicKey>;
  researchTemplates: Map<number, PublicKey>;
  shopConfig: PublicKey;
  initialized: boolean;
}

let globalContext: TestContext | null = null;

// ============================================================
// Test Data
// ============================================================

/** Cities matching Rust INITIAL_CITIES constants (IDs 0-19) */
export const CITIES = [
  { id: 0, name: 'New York', lat: 40.7128, lon: -74.0060 },
  { id: 1, name: 'Los Angeles', lat: 34.0522, lon: -118.2437 },
  { id: 2, name: 'Chicago', lat: 41.8781, lon: -87.6298 },
  { id: 3, name: 'Toronto', lat: 43.6532, lon: -79.3832 },
  { id: 4, name: 'Mexico City', lat: 19.4326, lon: -99.1332 },
  { id: 5, name: 'Miami', lat: 25.7617, lon: -80.1918 },
  { id: 6, name: 'San Francisco', lat: 37.7749, lon: -122.4194 },
  { id: 7, name: 'Vancouver', lat: 49.2827, lon: -123.1207 },
  { id: 8, name: 'Houston', lat: 29.7604, lon: -95.3698 },
  { id: 9, name: 'Seattle', lat: 47.6062, lon: -122.3321 },
  { id: 10, name: 'São Paulo', lat: -23.5505, lon: -46.6333 },
  { id: 11, name: 'Buenos Aires', lat: -34.6037, lon: -58.3816 },
  { id: 12, name: 'Rio de Janeiro', lat: -22.9068, lon: -43.1729 },
  { id: 13, name: 'Lima', lat: -12.0464, lon: -77.0428 },
  { id: 14, name: 'Bogotá', lat: 4.7110, lon: -74.0721 },
  { id: 15, name: 'London', lat: 51.5074, lon: -0.1278 },
  { id: 16, name: 'Paris', lat: 48.8566, lon: 2.3522 },
  { id: 17, name: 'Berlin', lat: 52.5200, lon: 13.4050 },
  { id: 18, name: 'Madrid', lat: 40.4168, lon: -3.7038 },
  { id: 19, name: 'Rome', lat: 41.9028, lon: 12.4964 },
] as const;

/** Remaining cities matching Rust INITIAL_CITIES constants (IDs 20-49) */
export const OTHER_CITIES = [
  // Europe (continued)
  { id: 20, name: 'Amsterdam', lat: 52.3676, lon: 4.9041 },
  { id: 21, name: 'Moscow', lat: 55.7558, lon: 37.6173 },
  { id: 22, name: 'Istanbul', lat: 41.0082, lon: 28.9784 },
  { id: 23, name: 'Athens', lat: 37.9838, lon: 23.7275 },
  { id: 24, name: 'Vienna', lat: 48.2082, lon: 16.3738 },

  // Africa
  { id: 25, name: 'Cairo', lat: 30.0444, lon: 31.2357 },
  { id: 26, name: 'Lagos', lat: 6.5244, lon: 3.3792 },
  { id: 27, name: 'Johannesburg', lat: -26.2041, lon: 28.0473 },
  { id: 28, name: 'Nairobi', lat: -1.2921, lon: 36.8219 },
  { id: 29, name: 'Casablanca', lat: 33.5731, lon: -7.5898 },

  // Middle East
  { id: 30, name: 'Dubai', lat: 25.2048, lon: 55.2708 },
  { id: 31, name: 'Tel Aviv', lat: 32.0853, lon: 34.7818 },
  { id: 32, name: 'Riyadh', lat: 24.7136, lon: 46.6753 },

  // Asia - East
  { id: 33, name: 'Tokyo', lat: 35.6762, lon: 139.6503 },
  { id: 34, name: 'Seoul', lat: 37.5665, lon: 126.9780 },
  { id: 35, name: 'Beijing', lat: 39.9042, lon: 116.4074 },
  { id: 36, name: 'Shanghai', lat: 31.2304, lon: 121.4737 },
  { id: 37, name: 'Hong Kong', lat: 22.3193, lon: 114.1694 },
  { id: 38, name: 'Taipei', lat: 25.0330, lon: 121.5654 },
  { id: 39, name: 'Osaka', lat: 34.6937, lon: 135.5023 },

  // Asia - South & Southeast
  { id: 40, name: 'Singapore', lat: 1.3521, lon: 103.8198 },
  { id: 41, name: 'Mumbai', lat: 19.0760, lon: 72.8777 },
  { id: 42, name: 'Delhi', lat: 28.7041, lon: 77.1025 },
  { id: 43, name: 'Bangkok', lat: 13.7563, lon: 100.5018 },
  { id: 44, name: 'Jakarta', lat: -6.2088, lon: 106.8456 },
  { id: 45, name: 'Manila', lat: 14.5995, lon: 120.9842 },

  // Oceania
  { id: 46, name: 'Sydney', lat: -33.8688, lon: 151.2093 },
  { id: 47, name: 'Melbourne', lat: -37.8136, lon: 144.9631 },
  { id: 48, name: 'Auckland', lat: -36.8485, lon: 174.7633 },

  // Neo Cities
  { id: 49, name: 'Neo Tokyo', lat: 35.6762, lon: 139.6503 },
] as const;

/** All 50 cities (CITIES + OTHER_CITIES) */
export const ALL_CITIES = [...CITIES, ...OTHER_CITIES] as const;

/**
 * Test shop item that grants gems (for travel speedup in tests).
 * Item type 50 = grants gems to player.
 */
export const TEST_GEMS_ITEM = {
  itemId: 9999,
  itemType: 50,           // Type 50 = grants gems
  category: 1,            // Consumable (ShopCategory only has 0-3)
  rarity: 0,              // Common
  quantityPerPurchase: 1000, // 1000 gems per purchase
  baseStatsBps: 0,
  priceSolLamports: new BN(1000), // 0.000001 SOL (basically free)
  isActive: true,
  isFeatured: false,
} as const;

/**
 * Test shop item that grants fragments (for hero level-up in tests).
 * Item type 52 = grants fragments to player.
 */
export const TEST_FRAGMENTS_ITEM = {
  itemId: 9998,
  itemType: 52,           // Type 52 = grants fragments
  category: 1,            // Consumable
  rarity: 0,              // Common
  quantityPerPurchase: 100, // 100 fragments per purchase
  baseStatsBps: 0,
  priceSolLamports: new BN(1000), // 0.000001 SOL (basically free)
  isActive: true,
  isFeatured: false,
} as const;

/**
 * Test shop item that grants common materials (for forge crafting in tests).
 * Item type 200 = grants common_materials to player.
 */
export const TEST_MATERIALS_ITEM = {
  itemId: 9997,
  itemType: 200,          // Type 200 = grants common_materials
  category: 1,            // Consumable
  rarity: 0,              // Common
  quantityPerPurchase: 100, // 100 common materials per purchase
  baseStatsBps: 0,
  priceSolLamports: new BN(1000), // 0.000001 SOL (basically free)
  isActive: true,
  isFeatured: false,
} as const;

// Hero stat indices for buffs (must match Rust BuffStat enum)
const HERO_STAT_ATTACK = 1;   // AttackPower
const HERO_STAT_DEFENSE = 2;  // DefensePower
const HERO_STAT_ECONOMY = 3;  // CashCollectionRate
const HERO_STAT_CRIT = 7;     // CriticalHitChance
const HERO_STAT_LOOT = 15;    // LootBonus
const HERO_STAT_ENCOUNTER = 14; // EncounterDamage

export const HERO_TEMPLATES = [
  {
    templateId: 1,
    name: 'Warrior',
    heroType: 0,  // Common
    category: 0,  // Warrior class
    mintCostSol: new BN(LAMPORTS_PER_SOL / 10),
    supplyCap: 0,
    enabled: true,
    eventExclusive: false,
    requiredPlayerLevel: 1,
    meditationCityId: 0,
    buffs: [
      { stat: HERO_STAT_ATTACK, baseBps: 100 },
      { stat: HERO_STAT_DEFENSE, baseBps: 80 },
      { stat: HERO_STAT_ECONOMY, baseBps: 1000 },
      { stat: HERO_STAT_CRIT, baseBps: 500 },
    ],
  },
  {
    templateId: 2,
    name: 'Archer',
    heroType: 0,
    category: 1,  // Archer class
    mintCostSol: new BN(LAMPORTS_PER_SOL / 10),
    supplyCap: 0,
    enabled: true,
    eventExclusive: false,
    requiredPlayerLevel: 1,
    meditationCityId: 0,
    buffs: [
      { stat: HERO_STAT_ATTACK, baseBps: 120 },
      { stat: HERO_STAT_DEFENSE, baseBps: 50 },
      { stat: HERO_STAT_ENCOUNTER, baseBps: 800 },
      { stat: HERO_STAT_CRIT, baseBps: 800 },
    ],
  },
  {
    templateId: 3,
    name: 'Mage',
    heroType: 0,
    category: 2,  // Mage class
    mintCostSol: new BN(LAMPORTS_PER_SOL / 10),
    supplyCap: 0,
    enabled: true,
    eventExclusive: false,
    requiredPlayerLevel: 1,
    meditationCityId: 0,
    buffs: [
      { stat: HERO_STAT_ATTACK, baseBps: 150 },
      { stat: HERO_STAT_DEFENSE, baseBps: 40 },
      { stat: HERO_STAT_LOOT, baseBps: 600 },
      { stat: HERO_STAT_CRIT, baseBps: 600 },
    ],
  },
  {
    templateId: 4,
    name: 'Paladin',
    heroType: 1,  // Uncommon
    category: 0,
    mintCostSol: new BN(LAMPORTS_PER_SOL / 2),
    supplyCap: 1000,
    enabled: true,
    eventExclusive: false,
    requiredPlayerLevel: 5,
    meditationCityId: 0,
    buffs: [
      { stat: HERO_STAT_ATTACK, baseBps: 130 },
      { stat: HERO_STAT_DEFENSE, baseBps: 100 },
      { stat: HERO_STAT_ECONOMY, baseBps: 1200 },
      { stat: HERO_STAT_CRIT, baseBps: 700 },
    ],
  },
  {
    templateId: 5,
    name: 'Assassin',
    heroType: 1,
    category: 1,
    mintCostSol: new BN(LAMPORTS_PER_SOL / 2),
    supplyCap: 1000,
    enabled: true,
    eventExclusive: false,
    requiredPlayerLevel: 5,
    meditationCityId: 0,
    buffs: [
      { stat: HERO_STAT_ATTACK, baseBps: 180 },
      { stat: HERO_STAT_ENCOUNTER, baseBps: 30 },
      { stat: HERO_STAT_LOOT, baseBps: 500 },
      { stat: HERO_STAT_CRIT, baseBps: 1500 },
    ],
  },
];

export const RESEARCH_TEMPLATES = [
  {
    researchType: 0,
    category: 0,
    maxLevel: 10,
    baseTimeSeconds: 300,
    baseCost: new BN(100),
    buffType: 0,
    buffPerLevelBps: 200,
    prerequisiteType: -1,
    prerequisiteLevel: 0,
    gemCostPerMinute: 1,
  },
  {
    researchType: 1,
    category: 0,
    maxLevel: 10,
    baseTimeSeconds: 600,
    baseCost: new BN(200),
    buffType: 1,
    buffPerLevelBps: 200,
    prerequisiteType: 0,
    prerequisiteLevel: 3,
    gemCostPerMinute: 2,
  },
  {
    researchType: 2,
    category: 1,
    maxLevel: 10,
    baseTimeSeconds: 300,
    baseCost: new BN(100),
    buffType: 4,
    buffPerLevelBps: 300,
    prerequisiteType: -1,
    prerequisiteLevel: 0,
    gemCostPerMinute: 1,
  },
  {
    researchType: 3,
    category: 1,
    maxLevel: 10,
    baseTimeSeconds: 450,
    baseCost: new BN(150),
    buffType: 5,
    buffPerLevelBps: 500,
    prerequisiteType: 2,
    prerequisiteLevel: 2,
    gemCostPerMinute: 2,
  },
  {
    researchType: 4,
    category: 2,
    maxLevel: 10,
    baseTimeSeconds: 600,
    baseCost: new BN(200),
    buffType: 6,
    buffPerLevelBps: 200,
    prerequisiteType: -1,
    prerequisiteLevel: 0,
    gemCostPerMinute: 2,
  },
  // DailyRewardsSystem research (buff_type 20 sets has_daily_rewards on level 1)
  {
    researchType: 20,
    category: 0,            // Battle category = Academy Lv 1 sufficient
    maxLevel: 10,
    baseTimeSeconds: 60,    // Short for testing
    baseCost: new BN(100),
    buffType: 20,           // DailyRewardsSystem → sets has_daily_rewards on level 1
    buffPerLevelBps: 200,
    prerequisiteType: -1,
    prerequisiteLevel: 0,
    gemCostPerMinute: 1,
  },
  // Growth research templates for expedition unlock (category=0 Battle for test convenience
  // so only Academy Lv 1 is needed, but buff_type 21/22 still sets has_mining/has_fishing)
  {
    researchType: 21,
    category: 0,            // Battle category = Academy Lv 1 sufficient
    maxLevel: 10,
    baseTimeSeconds: 60,    // Short for testing
    baseCost: new BN(100),
    buffType: 21,           // MiningOperations → sets has_mining on level 1
    buffPerLevelBps: 200,
    prerequisiteType: -1,
    prerequisiteLevel: 0,
    gemCostPerMinute: 1,
  },
  {
    researchType: 22,
    category: 0,            // Battle category = Academy Lv 1 sufficient
    maxLevel: 10,
    baseTimeSeconds: 60,    // Short for testing
    baseCost: new BN(100),
    buffType: 22,           // FishingIndustry → sets has_fishing on level 1
    buffPerLevelBps: 200,
    prerequisiteType: -1,
    prerequisiteLevel: 0,
    gemCostPerMinute: 1,
  },
] as const;

// ============================================================
// Keypair Management
// ============================================================

const KEYS_DIR = path.join(__dirname, '../../keys');

function ensureKeysDir(): void {
  if (!fs.existsSync(KEYS_DIR)) {
    fs.mkdirSync(KEYS_DIR, { recursive: true });
  }
}

function loadOrCreateKeypair(name: string): Keypair {
  ensureKeysDir();
  const filepath = path.join(KEYS_DIR, `${name}.json`);

  if (fs.existsSync(filepath)) {
    const secretKey = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
  }

  const keypair = Keypair.generate();
  fs.writeFileSync(filepath, JSON.stringify(Array.from(keypair.secretKey)));
  return keypair;
}

// ============================================================
// Transaction Utilities
// ============================================================

export async function airdropIfNeeded(
  connection: Connection,
  pubkey: PublicKey,
  minBalance: number = 10 * LAMPORTS_PER_SOL
): Promise<void> {
  const balance = await connection.getBalance(pubkey);
  if (balance < minBalance) {
    const needed = Math.min(minBalance - balance, 2 * LAMPORTS_PER_SOL);
    try {
      const sig = await connection.requestAirdrop(pubkey, needed);
      await connection.confirmTransaction(sig, 'confirmed');
    } catch (err) {
      // Ignore airdrop failures on non-local networks
      console.warn(`Airdrop failed for ${pubkey.toBase58()}: ${err}`);
    }
  }
}

export async function sendTx(
  connection: Connection,
  tx: Transaction,
  signers: Keypair[],
  config: TestConfig
): Promise<string> {
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = signers[0]!.publicKey;
  try {
    return await sendAndConfirmTransaction(connection, tx, signers, {
      skipPreflight: config.skipPreflight,
      commitment: config.commitment,
    });
  } catch (error: any) {
    // Resolve Custom error codes to human-readable names
    const msg = error?.message ?? '';
    const match = msg.match(/custom program error: (0x[0-9a-fA-F]+)/i);
    if (match?.[1]) {
      const code = parseInt(match[1], 16);
      const { GameError, parseErrorMessage } = await import('../../src/errors');
      const name = GameError[code] || `Custom:${code}`;
      const description = parseErrorMessage(code);
      error.message = `${name} (${code}): ${description}\n${msg}`;
    }
    throw error;
  }
}

export async function accountExists(
  connection: Connection,
  pubkey: PublicKey
): Promise<boolean> {
  const info = await connection.getAccountInfo(pubkey);
  return info !== null && info.data.length > 0;
}

// ============================================================
// Setup Functions
// ============================================================

async function setupGameEngine(ctx: TestContext): Promise<void> {
  if (await accountExists(ctx.connection, ctx.gameEngine)) {
    return;
  }

  const ix = createInitGameEngineInstruction({
    authority: ctx.daoAuthority.publicKey,
    treasuryWallet: ctx.treasury.publicKey,
    kingdomId: ctx.kingdomId,
  });

  const tx = new Transaction().add(ix);
  await sendTx(ctx.connection, tx, [ctx.daoAuthority], ctx.config);
}

async function setupShopConfig(ctx: TestContext): Promise<void> {
  if (await accountExists(ctx.connection, ctx.shopConfig)) {
    return;
  }

  const ix = createInitializeConfigInstruction(
    {
      payer: ctx.daoAuthority.publicKey,
      daoAuthority: ctx.daoAuthority.publicKey,
      gameEngine: ctx.gameEngine,
    },
    {}
  );

  const tx = new Transaction().add(ix);
  await sendTx(ctx.connection, tx, [ctx.daoAuthority], ctx.config);
}

async function setupTestGemsItem(ctx: TestContext): Promise<void> {
  const [gemsItemPda] = deriveShopItemPda(ctx.gameEngine, TEST_GEMS_ITEM.itemId);

  if (await accountExists(ctx.connection, gemsItemPda)) {
    return;
  }

  const ix = createCreateItemInstruction(
    {
      payer: ctx.daoAuthority.publicKey,
      daoAuthority: ctx.daoAuthority.publicKey,
      gameEngine: ctx.gameEngine,
    },
    TEST_GEMS_ITEM
  );

  const tx = new Transaction().add(ix);
  try {
    await sendTx(ctx.connection, tx, [ctx.daoAuthority], ctx.config);
  } catch (err) {
    // Item may already exist
    console.warn(`Test gems item setup failed: ${err}`);
  }
}

async function setupTestFragmentsItem(ctx: TestContext): Promise<void> {
  const [fragmentsItemPda] = deriveShopItemPda(ctx.gameEngine, TEST_FRAGMENTS_ITEM.itemId);

  if (await accountExists(ctx.connection, fragmentsItemPda)) {
    return;
  }

  const ix = createCreateItemInstruction(
    {
      payer: ctx.daoAuthority.publicKey,
      daoAuthority: ctx.daoAuthority.publicKey,
      gameEngine: ctx.gameEngine,
    },
    TEST_FRAGMENTS_ITEM
  );

  const tx = new Transaction().add(ix);
  try {
    await sendTx(ctx.connection, tx, [ctx.daoAuthority], ctx.config);
  } catch (err) {
    console.warn(`Test fragments item setup failed: ${err}`);
  }
}

async function setupTestMaterialsItem(ctx: TestContext): Promise<void> {
  const [materialsItemPda] = deriveShopItemPda(ctx.gameEngine, TEST_MATERIALS_ITEM.itemId);

  if (await accountExists(ctx.connection, materialsItemPda)) {
    return;
  }

  const ix = createCreateItemInstruction(
    {
      payer: ctx.daoAuthority.publicKey,
      daoAuthority: ctx.daoAuthority.publicKey,
      gameEngine: ctx.gameEngine,
    },
    TEST_MATERIALS_ITEM
  );

  const tx = new Transaction().add(ix);
  try {
    await sendTx(ctx.connection, tx, [ctx.daoAuthority], ctx.config);
  } catch (err) {
    console.warn(`Test materials item setup failed: ${err}`);
  }
}

async function setupHeroCollection(ctx: TestContext): Promise<void> {
  if (await accountExists(ctx.connection, ctx.heroCollection)) {
    return;
  }

  const ix = createCreateCollectionInstruction({
    daoAuthority: ctx.daoAuthority.publicKey,
    gameEngine: ctx.gameEngine,
  });

  const tx = new Transaction().add(ix);
  await sendTx(ctx.connection, tx, [ctx.daoAuthority], ctx.config);
}

async function setupHeroTemplates(ctx: TestContext): Promise<void> {
  // Populate map and collect templates that need creation
  const toCreate: typeof HERO_TEMPLATES = [];
  for (const template of HERO_TEMPLATES) {
    const [templatePda] = deriveHeroTemplatePda(template.templateId);
    ctx.heroTemplates.set(template.templateId, templatePda);
    if (!(await accountExists(ctx.connection, templatePda))) {
      toCreate.push(template);
    }
  }

  // Create all missing templates in parallel
  await Promise.all(toCreate.map(async (template) => {
    const ix = createCreateTemplateInstruction(
      { daoAuthority: ctx.daoAuthority.publicKey, gameEngine: ctx.gameEngine },
      template
    );
    const tx = new Transaction().add(ix);
    try {
      await sendTx(ctx.connection, tx, [ctx.daoAuthority], ctx.config);
    } catch (err) {
      // Template may already exist
    }
  }));
}

async function setupCities(ctx: TestContext): Promise<void> {
  const BATCH_SIZE = 8;

  // Populate ctx.cities map with PDAs
  for (const city of CITIES) {
    const [cityPda] = deriveCityPda(ctx.gameEngine, city.id);
    ctx.cities.set(city.id, cityPda);
  }

  // Check if first city already exists (all-or-nothing with --reset)
  const [firstCityPda] = deriveCityPda(ctx.gameEngine, CITIES[0].id);
  if (await accountExists(ctx.connection, firstCityPda)) {
    return;
  }

  // Create all city batches in parallel
  const batchPromises = [];
  for (let i = 0; i < CITIES.length; i += BATCH_SIZE) {
    const batchCount = Math.min(BATCH_SIZE, CITIES.length - i);
    const startCityId = CITIES[i]!.id;

    const cityAccounts: PublicKey[] = [];
    for (let j = 0; j < batchCount; j++) {
      const [cityPda] = deriveCityPda(ctx.gameEngine, startCityId + j);
      cityAccounts.push(cityPda);
    }

    const batchCities = CITIES.slice(i, i + batchCount).map(c => ({
      name: c.name,
      lat: c.lat,
      lon: c.lon,
      radiusKm: 50,
      cityType: 0,
    }));

    const ix = createBatchCitiesInstruction(
      {
        authority: ctx.daoAuthority.publicKey,
        gameEngine: ctx.gameEngine,
        cityAccounts,
      },
      {
        startCityId,
        cities: batchCities,
      }
    );

    const tx = new Transaction().add(ix);
    batchPromises.push(sendTx(ctx.connection, tx, [ctx.daoAuthority], ctx.config));
  }

  await Promise.all(batchPromises);
}

async function setupResearchTemplates(ctx: TestContext): Promise<void> {
  // Populate map and collect templates that need creation
  const toCreate = [];
  for (const template of RESEARCH_TEMPLATES) {
    const [templatePda] = deriveResearchTemplatePda(template.researchType);
    ctx.researchTemplates.set(template.researchType, templatePda);
    if (!(await accountExists(ctx.connection, templatePda))) {
      toCreate.push(template);
    }
  }

  // Create all missing templates in parallel
  await Promise.all(toCreate.map(async (template) => {
    const ix = createInitializeTemplateInstruction(
      {
        daoAuthority: ctx.daoAuthority.publicKey,
        gameEngine: ctx.gameEngine,
      },
      template
    );

    // Retry up to 3 times (blockhash/timing issues on fresh validator)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const tx = new Transaction().add(ix);
        await sendTx(ctx.connection, tx, [ctx.daoAuthority], ctx.config);
        break; // success
      } catch (err: any) {
        const msg = err?.transactionMessage || err?.message || '';
        if (msg.includes('already in use')) break; // already exists
        if (attempt === 2) {
          console.error(`[setup] Research template ${template.researchType} FAILED after 3 attempts:`, msg);
        }
        // Wait before retry
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }));
}

// ============================================================
// Main Setup
// ============================================================

/** Default kingdom ID for tests */
export const DEFAULT_KINGDOM_ID = 0;

export async function setupTestContext(
  config: Partial<TestConfig> = {},
  kingdomId: number = DEFAULT_KINGDOM_ID
): Promise<TestContext> {
  const fullConfig: TestConfig = { ...DEFAULT_CONFIG, ...config };

  const connection = new Connection(fullConfig.rpcUrl, fullConfig.commitment);
  const daoAuthority = loadOrCreateKeypair('dao-authority');
  const treasury = loadOrCreateKeypair('treasury');

  const [gameEngine] = deriveGameEnginePda(kingdomId);
  const [heroCollection] = deriveHeroCollectionPda();
  const [shopConfig] = deriveShopConfigPda(gameEngine);

  const ctx: TestContext = {
    connection,
    config: fullConfig,
    daoAuthority,
    treasury,
    kingdomId,
    gameEngine,
    heroCollection,
    cities: new Map(),
    heroTemplates: new Map(),
    researchTemplates: new Map(),
    shopConfig,
    initialized: false,
  };

  if (fullConfig.autoSetup) {
    const t0 = performance.now();

    // Phase 1: Airdrops (parallel)
    console.log('[setup] Airdropping SOL...');
    await Promise.all([
      airdropIfNeeded(connection, daoAuthority.publicKey, 50 * LAMPORTS_PER_SOL),
      airdropIfNeeded(connection, treasury.publicKey, 1 * LAMPORTS_PER_SOL),
    ]);

    // Phase 2: GameEngine + ShopConfig (sequential - ShopConfig depends on GameEngine)
    console.log('[setup] Initializing GameEngine + ShopConfig...');
    await setupGameEngine(ctx);
    await setupShopConfig(ctx);

    // Phase 3: Everything else in parallel (all depend only on GameEngine existing)
    console.log('[setup] Initializing cities, heroes, research, shop items (parallel)...');
    const results = await Promise.allSettled([
      setupCities(ctx),
      setupHeroCollection(ctx).then(() => setupHeroTemplates(ctx)),
      setupResearchTemplates(ctx),
      setupTestGemsItem(ctx),
      setupTestFragmentsItem(ctx),
      setupTestMaterialsItem(ctx),
    ]);

    for (const r of results) {
      if (r.status === 'rejected') {
        console.warn(`[setup] Non-critical setup failed: ${r.reason}`);
      }
    }

    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    console.log(`[setup] All infrastructure ready in ${elapsed}s.`);

    ctx.initialized = true;
  }

  return ctx;
}

export async function getGlobalContext(): Promise<TestContext> {
  if (!globalContext) {
    globalContext = await setupTestContext();
  }
  return globalContext;
}

export function resetGlobalContext(): void {
  globalContext = null;
}

// ============================================================
// Test Lifecycle Helpers
// ============================================================

export async function beforeAllTests(): Promise<TestContext> {
  // Start (or restart) the validator with --reset so every run is fresh
  await startValidator();
  // Force re-setup since validator was reset
  globalContext = null;
  const ctx = await getGlobalContext();

  // Start real-time program log listener (WebSocket)
  startProgramLogListener(ctx.connection, PROGRAM_ID);

  return ctx;
}

export async function afterAllTests(): Promise<void> {
  if (globalContext) {
    stopProgramLogListener(globalContext.connection);
  }
  stopValidator();
}

// Clean up on SIGINT (Cmd+C) so WebSocket doesn't hang
process.on('SIGINT', () => {
  if (globalContext) {
    stopProgramLogListener(globalContext.connection);
  }
  stopValidator();
  process.exit(1);
});
