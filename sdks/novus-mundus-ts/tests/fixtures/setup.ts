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

import {
  createInitGameEngineInstruction,
  createInitCityInstruction,
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

export const CITIES = [
  { id: 1, name: 'Novus Prime', lat: 40.7128, lon: -74.0060 },       // New York
  { id: 2, name: 'Solana City', lat: 37.7749, lon: -122.4194 },      // San Francisco
  { id: 3, name: 'Epoch Harbor', lat: 51.5074, lon: -0.1278 },       // London
  { id: 4, name: 'Validator Point', lat: 35.6762, lon: 139.6503 },   // Tokyo
  { id: 5, name: 'Stake Station', lat: 48.8566, lon: 2.3522 },       // Paris
  { id: 6, name: 'Block Heights', lat: -33.8688, lon: 151.2093 },    // Sydney
  { id: 7, name: 'Hash Haven', lat: 52.5200, lon: 13.4050 },         // Berlin
  { id: 8, name: 'Ledger Landing', lat: 55.7558, lon: 37.6173 },     // Moscow
  { id: 9, name: 'Consensus Cove', lat: 1.3521, lon: 103.8198 },     // Singapore
  { id: 10, name: 'Finality Falls', lat: -22.9068, lon: -43.1729 },  // Rio
  { id: 11, name: 'Merkle Meadows', lat: 19.4326, lon: -99.1332 },   // Mexico City
  { id: 12, name: 'Protocol Plains', lat: 25.2048, lon: 55.2708 },   // Dubai
  { id: 13, name: 'Shard Shore', lat: 22.3193, lon: 114.1694 },      // Hong Kong
  { id: 14, name: 'Anchor Atoll', lat: -6.2088, lon: 106.8456 },     // Jakarta
  { id: 15, name: 'Signature Summit', lat: 41.9028, lon: 12.4964 },  // Rome
  { id: 16, name: 'Cluster Creek', lat: 59.3293, lon: 18.0686 },     // Stockholm
  { id: 17, name: 'Token Terrace', lat: 31.2304, lon: 121.4737 },    // Shanghai
  { id: 18, name: 'Proof Pier', lat: 43.6532, lon: -79.3832 },       // Toronto
  { id: 19, name: 'Mint Mesa', lat: -34.6037, lon: -58.3816 },       // Buenos Aires
  { id: 20, name: 'Burn Bay', lat: 28.6139, lon: 77.2090 },          // Delhi
] as const;

/**
 * Test shop item that grants gems (for travel speedup in tests).
 * Item type 50 = grants gems to player.
 */
export const TEST_GEMS_ITEM = {
  itemId: 9999,
  itemType: 50,           // Type 50 = grants gems
  category: 4,            // Currency
  rarity: 0,              // Common
  quantityPerPurchase: 1000, // 1000 gems per purchase
  baseStatsBps: 0,
  priceSolLamports: new BN(1000), // 0.000001 SOL (basically free)
  isActive: true,
  isFeatured: false,
} as const;

// Hero stat indices for buffs
const HERO_STAT_ATTACK = 1;
const HERO_STAT_DEFENSE = 2;
const HERO_STAT_HEALTH = 3;
const HERO_STAT_CRIT = 4;

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
      { stat: HERO_STAT_HEALTH, baseBps: 1000 },
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
      { stat: HERO_STAT_HEALTH, baseBps: 800 },
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
      { stat: HERO_STAT_HEALTH, baseBps: 600 },
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
      { stat: HERO_STAT_HEALTH, baseBps: 1200 },
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
      { stat: HERO_STAT_DEFENSE, baseBps: 30 },
      { stat: HERO_STAT_HEALTH, baseBps: 500 },
      { stat: HERO_STAT_CRIT, baseBps: 1500 },
    ],
  },
];

export const RESEARCH_TEMPLATES = [
  {
    researchType: 0,
    category: 0,
    baseCost: new BN(100),
    baseDuration: new BN(300),
    buffType: 0,
    buffPerLevelBps: 200,
    maxLevel: 10,
    requiredPlayerLevel: 1,
    prerequisiteType: -1,
    prerequisiteLevel: 0,
  },
  {
    researchType: 1,
    category: 0,
    baseCost: new BN(200),
    baseDuration: new BN(600),
    buffType: 1,
    buffPerLevelBps: 200,
    maxLevel: 10,
    requiredPlayerLevel: 1,
    prerequisiteType: 0,
    prerequisiteLevel: 3,
  },
  {
    researchType: 2,
    category: 1,
    baseCost: new BN(100),
    baseDuration: new BN(300),
    buffType: 4,
    buffPerLevelBps: 300,
    maxLevel: 10,
    requiredPlayerLevel: 1,
    prerequisiteType: -1,
    prerequisiteLevel: 0,
  },
  {
    researchType: 3,
    category: 1,
    baseCost: new BN(150),
    baseDuration: new BN(450),
    buffType: 5,
    buffPerLevelBps: 500,
    maxLevel: 10,
    requiredPlayerLevel: 2,
    prerequisiteType: 2,
    prerequisiteLevel: 2,
  },
  {
    researchType: 4,
    category: 2,
    baseCost: new BN(200),
    baseDuration: new BN(600),
    buffType: 6,
    buffPerLevelBps: 200,
    maxLevel: 10,
    requiredPlayerLevel: 3,
    prerequisiteType: -1,
    prerequisiteLevel: 0,
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
  return await sendAndConfirmTransaction(connection, tx, signers, {
    skipPreflight: config.skipPreflight,
    commitment: config.commitment,
  });
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
  for (const template of HERO_TEMPLATES) {
    const [templatePda] = deriveHeroTemplatePda(template.templateId);
    ctx.heroTemplates.set(template.templateId, templatePda);

    if (await accountExists(ctx.connection, templatePda)) {
      continue;
    }

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
  }
}

async function setupCities(ctx: TestContext): Promise<void> {
  for (const city of CITIES) {
    const [cityPda] = deriveCityPda(ctx.gameEngine, city.id);
    ctx.cities.set(city.id, cityPda);

    if (await accountExists(ctx.connection, cityPda)) {
      continue;
    }

    const ix = createInitCityInstruction(
      {
        authority: ctx.daoAuthority.publicKey,
        gameEngine: ctx.gameEngine,
      },
      {
        cityId: city.id,
        name: city.name,
        latitude: city.lat,
        longitude: city.lon,
        radiusKm: 10, // Default 10km radius
        cityType: 0,  // Capital type
      }
    );

    const tx = new Transaction().add(ix);
    await sendTx(ctx.connection, tx, [ctx.daoAuthority], ctx.config);
  }
}

async function setupResearchTemplates(ctx: TestContext): Promise<void> {
  for (const template of RESEARCH_TEMPLATES) {
    const [templatePda] = deriveResearchTemplatePda(template.researchType);
    ctx.researchTemplates.set(template.researchType, templatePda);

    if (await accountExists(ctx.connection, templatePda)) {
      continue;
    }

    const ix = createInitializeTemplateInstruction(
      {
        payer: ctx.daoAuthority.publicKey,
        daoAuthority: ctx.daoAuthority.publicKey,
        gameEngine: ctx.gameEngine,
      },
      template
    );

    const tx = new Transaction().add(ix);
    try {
      await sendTx(ctx.connection, tx, [ctx.daoAuthority], ctx.config);
    } catch (err) {
      // Template may already exist
    }
  }
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
    console.log('[setup] Airdropping SOL to DAO authority...');
    await airdropIfNeeded(connection, daoAuthority.publicKey, 50 * LAMPORTS_PER_SOL);

    console.log('[setup] Initializing GameEngine...');
    await setupGameEngine(ctx);

    console.log('[setup] Initializing ShopConfig...');
    await setupShopConfig(ctx);

    try {
      console.log('[setup] Creating Hero Collection...');
      await setupHeroCollection(ctx);
    } catch (err) {
      console.warn(`[setup] Hero collection setup failed (MPL Core CPI): ${err}`);
    }

    try {
      console.log(`[setup] Creating ${HERO_TEMPLATES.length} Hero Templates...`);
      await setupHeroTemplates(ctx);
    } catch (err) {
      console.warn(`[setup] Hero templates setup failed: ${err}`);
    }

    console.log(`[setup] Initializing ${CITIES.length} Cities...`);
    await setupCities(ctx);

    console.log(`[setup] Initializing ${RESEARCH_TEMPLATES.length} Research Templates...`);
    await setupResearchTemplates(ctx);

    await setupTestGemsItem(ctx);
    console.log('[setup] All infrastructure ready.');

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
  return await getGlobalContext();
}

export async function afterAllTests(): Promise<void> {
  stopValidator();
}
