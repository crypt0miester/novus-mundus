/**
 * Local Game Setup Script
 *
 * Initializes all game infrastructure for local testing.
 * Run with: bun run scripts/setup-local.ts
 */

import {
  Connection,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  PublicKey,
} from '@solana/web3.js';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';

// Import SDK
import {
  createInitGameEngineInstruction,
  createInitCityInstruction,
  createInitPlayerInstruction,
  createCreateCollectionInstruction,
  createCreateTemplateInstruction,
  createInitializeTemplateInstruction,
  deriveGameEnginePda,
  deriveHeroCollectionPda,
  deriveHeroTemplatePda,
  deriveResearchTemplatePda,
  deriveCityPda,
  derivePlayerPda,
} from '../src/index.ts';

// ============================================================
// Configuration
// ============================================================

const CONFIG = {
  rpcUrl: process.env.RPC_URL || 'http://localhost:8899',
  commitment: 'confirmed' as const,
  skipPreflight: true,
};

// ============================================================
// Test Data
// ============================================================

/** Cities to create */
const CITIES = [
  { id: 1, name: 'Novus Prime', lat: 40.7128, lon: -74.0060 },
  { id: 2, name: 'Solana City', lat: 37.7749, lon: -122.4194 },
  { id: 3, name: 'Epoch Harbor', lat: 51.5074, lon: -0.1278 },
];

/** Hero templates to create */
const HERO_TEMPLATES = [
  {
    templateId: 1,
    name: 'Warrior',
    rarity: 0, // Common
    heroClass: 0, // Melee
    baseAttack: 100,
    baseDefense: 80,
    baseHealth: 1000,
    baseCritBps: 500, // 5%
    mintPriceLamports: new BN(LAMPORTS_PER_SOL / 10), // 0.1 SOL
    maxSupply: 0, // unlimited
    minPlayerLevel: 1,
    requiredEventId: 0,
    enabled: true,
    metadataUri: 'https://arweave.net/warrior-metadata',
  },
  {
    templateId: 2,
    name: 'Archer',
    rarity: 0, // Common
    heroClass: 1, // Ranged
    baseAttack: 120,
    baseDefense: 50,
    baseHealth: 800,
    baseCritBps: 800, // 8%
    mintPriceLamports: new BN(LAMPORTS_PER_SOL / 10),
    maxSupply: 0,
    minPlayerLevel: 1,
    requiredEventId: 0,
    enabled: true,
    metadataUri: 'https://arweave.net/archer-metadata',
  },
  {
    templateId: 3,
    name: 'Mage',
    rarity: 0, // Common
    heroClass: 2, // Magic
    baseAttack: 150,
    baseDefense: 40,
    baseHealth: 600,
    baseCritBps: 600, // 6%
    mintPriceLamports: new BN(LAMPORTS_PER_SOL / 10),
    maxSupply: 0,
    minPlayerLevel: 1,
    requiredEventId: 0,
    enabled: true,
    metadataUri: 'https://arweave.net/mage-metadata',
  },
  {
    templateId: 4,
    name: 'Paladin',
    rarity: 1, // Rare
    heroClass: 0, // Melee
    baseAttack: 130,
    baseDefense: 100,
    baseHealth: 1200,
    baseCritBps: 700, // 7%
    mintPriceLamports: new BN(LAMPORTS_PER_SOL / 2), // 0.5 SOL
    maxSupply: 1000,
    minPlayerLevel: 5,
    requiredEventId: 0,
    enabled: true,
    metadataUri: 'https://arweave.net/paladin-metadata',
  },
];

/** Research templates - basic tech tree */
const RESEARCH_TEMPLATES = [
  {
    researchType: 0,
    category: 0, // Battle
    baseCost: new BN(100), // 10 NOVI
    baseDuration: new BN(300), // 5 minutes
    buffType: 0, // Attack
    buffPerLevelBps: 200, // +2% per level
    maxLevel: 10,
    requiredPlayerLevel: 1,
    prerequisiteType: -1, // None
    prerequisiteLevel: 0,
  },
  {
    researchType: 1,
    category: 0, // Battle
    baseCost: new BN(200),
    baseDuration: new BN(600), // 10 minutes
    buffType: 1, // Defense
    buffPerLevelBps: 200,
    maxLevel: 10,
    requiredPlayerLevel: 1,
    prerequisiteType: 0, // Requires Attack I
    prerequisiteLevel: 3,
  },
  {
    researchType: 2,
    category: 1, // Economy
    baseCost: new BN(100),
    baseDuration: new BN(300),
    buffType: 4, // Resource Rate
    buffPerLevelBps: 300, // +3% per level
    maxLevel: 10,
    requiredPlayerLevel: 1,
    prerequisiteType: -1,
    prerequisiteLevel: 0,
  },
  {
    researchType: 3,
    category: 1, // Economy
    baseCost: new BN(150),
    baseDuration: new BN(450),
    buffType: 5, // Capacity
    buffPerLevelBps: 500, // +5% per level
    maxLevel: 10,
    requiredPlayerLevel: 2,
    prerequisiteType: 2, // Requires Resource I
    prerequisiteLevel: 2,
  },
  {
    researchType: 4,
    category: 2, // Growth
    baseCost: new BN(200),
    baseDuration: new BN(600),
    buffType: 6, // XP Rate
    buffPerLevelBps: 200, // +2% per level
    maxLevel: 10,
    requiredPlayerLevel: 3,
    prerequisiteType: -1,
    prerequisiteLevel: 0,
  },
];

// ============================================================
// Utility Functions
// ============================================================

function loadKeypair(filepath: string): Keypair {
  const fullPath = path.resolve(filepath);
  if (!fs.existsSync(fullPath)) {
    console.log(`Creating new keypair at ${fullPath}`);
    const keypair = Keypair.generate();
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, JSON.stringify(Array.from(keypair.secretKey)));
    return keypair;
  }
  const secretKey = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

async function airdropIfNeeded(
  connection: Connection,
  pubkey: PublicKey,
  minBalance: number = 10 * LAMPORTS_PER_SOL
): Promise<void> {
  const balance = await connection.getBalance(pubkey);
  if (balance < minBalance) {
    const needed = minBalance - balance;
    console.log(`Airdropping ${needed / LAMPORTS_PER_SOL} SOL to ${pubkey.toBase58()}`);
    const sig = await connection.requestAirdrop(pubkey, needed);
    await connection.confirmTransaction(sig, 'confirmed');
  }
}

async function sendTx(
  connection: Connection,
  tx: Transaction,
  signers: Keypair[],
  label: string
): Promise<string> {
  try {
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.feePayer = signers[0].publicKey;
    const sig = await sendAndConfirmTransaction(connection, tx, signers, {
      skipPreflight: CONFIG.skipPreflight,
      commitment: CONFIG.commitment,
    });
    console.log(`  ${label}: ${sig}`);
    return sig;
  } catch (error) {
    console.error(`  ${label}: FAILED`);
    throw error;
  }
}

// ============================================================
// Setup Functions
// ============================================================

async function setupGameEngine(
  connection: Connection,
  daoAuthority: Keypair,
  treasury: PublicKey
): Promise<void> {
  console.log('\n=== Phase 1: Game Engine ===');

  const [gameEnginePda] = deriveGameEnginePda();

  // Check if already initialized
  const info = await connection.getAccountInfo(gameEnginePda);
  if (info !== null) {
    console.log('  Game Engine already initialized');
    return;
  }

  const ix = createInitGameEngineInstruction({
    authority: daoAuthority.publicKey,
    treasuryWallet: treasury,
  });

  const tx = new Transaction().add(ix);
  await sendTx(connection, tx, [daoAuthority], 'InitGameEngine');
}

async function setupHeroCollection(
  connection: Connection,
  daoAuthority: Keypair
): Promise<void> {
  console.log('\n=== Phase 2: Hero Collection ===');

  const [heroCollectionPda] = deriveHeroCollectionPda();

  // Check if already initialized
  const info = await connection.getAccountInfo(heroCollectionPda);
  if (info !== null) {
    console.log('  Hero Collection already initialized');
    return;
  }

  const ix = createCreateCollectionInstruction(
    {
      payer: daoAuthority.publicKey,
      daoAuthority: daoAuthority.publicKey,
    },
    {
      name: 'Novus Mundus Heroes',
      uri: 'https://arweave.net/collection-metadata',
    }
  );

  const tx = new Transaction().add(ix);
  await sendTx(connection, tx, [daoAuthority], 'CreateHeroCollection');
}

async function setupHeroTemplates(
  connection: Connection,
  daoAuthority: Keypair
): Promise<void> {
  console.log('\n=== Phase 3: Hero Templates ===');

  for (const template of HERO_TEMPLATES) {
    const [templatePda] = deriveHeroTemplatePda(template.templateId);

    // Check if already initialized
    const info = await connection.getAccountInfo(templatePda);
    if (info !== null) {
      console.log(`  Template ${template.name} already initialized`);
      continue;
    }

    const ix = createCreateTemplateInstruction(
      {
        payer: daoAuthority.publicKey,
        daoAuthority: daoAuthority.publicKey,
      },
      template
    );

    const tx = new Transaction().add(ix);
    await sendTx(connection, tx, [daoAuthority], `CreateTemplate: ${template.name}`);
  }
}

async function setupCities(
  connection: Connection,
  daoAuthority: Keypair
): Promise<void> {
  console.log('\n=== Phase 4: Cities ===');

  for (const city of CITIES) {
    const [cityPda] = deriveCityPda(city.id);

    // Check if already initialized
    const info = await connection.getAccountInfo(cityPda);
    if (info !== null) {
      console.log(`  City ${city.name} already initialized`);
      continue;
    }

    const ix = createInitCityInstruction({
      authority: daoAuthority.publicKey,
      cityId: city.id,
      latitude: city.lat,
      longitude: city.lon,
      name: city.name,
    });

    const tx = new Transaction().add(ix);
    await sendTx(connection, tx, [daoAuthority], `InitCity: ${city.name}`);
  }
}

async function setupResearchTemplates(
  connection: Connection,
  daoAuthority: Keypair
): Promise<void> {
  console.log('\n=== Phase 5: Research Templates ===');

  for (const template of RESEARCH_TEMPLATES) {
    const [templatePda] = deriveResearchTemplatePda(template.researchType);

    // Check if already initialized
    const info = await connection.getAccountInfo(templatePda);
    if (info !== null) {
      console.log(`  Research type ${template.researchType} already initialized`);
      continue;
    }

    const ix = createInitializeTemplateInstruction(
      {
        payer: daoAuthority.publicKey,
        daoAuthority: daoAuthority.publicKey,
      },
      template
    );

    const tx = new Transaction().add(ix);
    await sendTx(connection, tx, [daoAuthority], `InitResearch: Type ${template.researchType}`);
  }
}

async function setupTestPlayer(
  connection: Connection,
  playerKeypair: Keypair,
  startingCityId: number = 1
): Promise<void> {
  console.log('\n=== Phase 6: Test Player ===');

  const [playerPda] = derivePlayerPda(playerKeypair.publicKey);

  // Check if already initialized
  const info = await connection.getAccountInfo(playerPda);
  if (info !== null) {
    console.log('  Player already initialized');
    return;
  }

  const ix = createInitPlayerInstruction({
    owner: playerKeypair.publicKey,
    startingCityId,
  });

  const tx = new Transaction().add(ix);
  await sendTx(connection, tx, [playerKeypair], 'InitPlayer');
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log('==============================================');
  console.log('  Novus Mundus Local Setup');
  console.log('==============================================');
  console.log(`RPC: ${CONFIG.rpcUrl}`);

  // Connect
  const connection = new Connection(CONFIG.rpcUrl, CONFIG.commitment);

  // Load/create keypairs
  const keysDir = path.join(__dirname, '../keys');
  const daoAuthority = loadKeypair(path.join(keysDir, 'dao-authority.json'));
  const treasury = loadKeypair(path.join(keysDir, 'treasury.json'));
  const testPlayer = loadKeypair(path.join(keysDir, 'test-player.json'));

  console.log(`\nDAO Authority: ${daoAuthority.publicKey.toBase58()}`);
  console.log(`Treasury: ${treasury.publicKey.toBase58()}`);
  console.log(`Test Player: ${testPlayer.publicKey.toBase58()}`);

  // Airdrop SOL for transactions
  await airdropIfNeeded(connection, daoAuthority.publicKey, 50 * LAMPORTS_PER_SOL);
  await airdropIfNeeded(connection, testPlayer.publicKey, 10 * LAMPORTS_PER_SOL);

  // Run setup phases
  await setupGameEngine(connection, daoAuthority, treasury.publicKey);
  await setupHeroCollection(connection, daoAuthority);
  await setupHeroTemplates(connection, daoAuthority);
  await setupCities(connection, daoAuthority);
  await setupResearchTemplates(connection, daoAuthority);
  await setupTestPlayer(connection, testPlayer, 1);

  console.log('\n==============================================');
  console.log('  Setup Complete!');
  console.log('==============================================');

  // Print PDAs for reference
  const [gameEnginePda] = deriveGameEnginePda();
  const [heroCollectionPda] = deriveHeroCollectionPda();
  const [city1Pda] = deriveCityPda(1);
  const [playerPda] = derivePlayerPda(testPlayer.publicKey);

  console.log('\nPDA Addresses:');
  console.log(`  GameEngine: ${gameEnginePda.toBase58()}`);
  console.log(`  HeroCollection: ${heroCollectionPda.toBase58()}`);
  console.log(`  City 1: ${city1Pda.toBase58()}`);
  console.log(`  TestPlayer: ${playerPda.toBase58()}`);
}

main().catch((error) => {
  console.error('Setup failed:', error);
  process.exit(1);
});
