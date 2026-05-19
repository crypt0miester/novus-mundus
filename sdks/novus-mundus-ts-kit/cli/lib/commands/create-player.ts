/**
 * create-player command — Create test players at various power tiers
 */

import {
  ComputeBudgetProgram,
  Keypair,
  Transaction,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

import type { CLIContext, ParsedArgs } from '../context';
import { loadKeypair, ensureFunded } from '../context';
import { sendWithRetry, accountExists, log } from '../helpers';
import { CITIES } from '../../data/cities';
import { PLAYER_TIERS, type PlayerTierConfig } from '../../data/player-tiers';

import {
  createInitUserInstruction,
  createInitPlayerInstruction,
  createCreateProgressInstruction,
  createCreateEstateInstruction,
  createBuyPlotInstruction,
  createPurchaseItemInstruction,
  createBuildBuildingInstruction,
  createBuildingSpeedupInstruction,
  createCompleteBuildingInstruction,
  createMintForPrizeInstruction,
  MintPurpose,
  createReservedToLockedInstruction,
  createHireUnitsInstruction,
  createPurchaseEquipmentInstruction,
  createStartResearchInstruction,
  createSpeedUpResearchInstruction,
  createCompleteResearchInstruction,
  derivePlayerPda,
  deriveEstatePda,
  BuildingType,
} from '../../../src/index';

// Gem shop item created by `novus init` (100 gems per purchase)
const GEMS_ITEM_ID = 1;

// Estate building slots: the estate starts with 1 plot; each plot = 4 slots.
const SLOTS_PER_PLOT = 4;
const INITIAL_BUILDING_SLOTS = 4;
const MAX_PLOTS = 5;

export async function handleCreatePlayer(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  // Parse flags
  const tier = getFlag(args.flags, '--tier');
  const count = parseInt(getFlag(args.flags, '--count') || '1', 10);
  const cityFlag = getFlag(args.flags, '--city');
  const startIndexFlag = getFlag(args.flags, '--start-index');

  if (!tier || !PLAYER_TIERS[tier]) {
    log.error(`Invalid or missing --tier. Options: ${Object.keys(PLAYER_TIERS).join(', ')}`);
    return;
  }

  const config = PLAYER_TIERS[tier]!;
  const startIndex = startIndexFlag
    ? parseInt(startIndexFlag, 10)
    : detectNextPlayerIndex();

  log.info(`\nCreating ${count} ${config.name} player(s) starting at index ${startIndex}\n`);

  const keysDir = path.join(__dirname, '../../../keys/players');

  for (let i = 0; i < count; i++) {
    const playerIndex = startIndex + i;
    const cityId = cityFlag !== undefined
      ? parseInt(cityFlag, 10)
      : playerIndex % CITIES.length;

    const city = CITIES.find(c => c.id === cityId);
    if (!city) {
      log.error(`City ${cityId} not found`);
      return;
    }

    log.info(`--- Player ${playerIndex} (city ${cityId}: ${city.name}) ---`);

    const keypairPath = path.join(keysDir, `player-${playerIndex}.json`);
    const playerKeypair = loadKeypair(keypairPath);

    // Airdrop SOL on localnet
    if (ctx.env === 'localnet') {
      await ensureFunded(ctx.connection, playerKeypair.publicKey).catch(() => {});
    }

    const [playerPda] = await derivePlayerPda(ctx.gameEngine, playerKeypair.publicKey);
    const [estatePda] = await deriveEstatePda(playerPda);

    // Step 1: Init user + player + research progress
    await initPlayer(ctx, playerKeypair, cityId, city.lat, city.lon, playerIndex);

    // Step 2: Estate + gems
    if (config.estate) {
      await createEstateAndBuyGems(ctx, playerKeypair, config.gemPurchases);
    }

    // Step 3: Fund NOVI — must precede buildings, since buying plots to
    // unlock building slots is paid in locked NOVI.
    if (config.noviAmount > 0) {
      await fundNovi(ctx, playerKeypair, config.noviAmount);
    }

    // Step 4: Buy plots — the estate ships with 4 slots; richer tiers need
    // more land before their buildings will fit.
    if (config.estate && config.buildings.length > INITIAL_BUILDING_SLOTS) {
      await buyPlots(ctx, playerKeypair, config.buildings.length);
    }

    // Step 5: Buildings
    if (config.buildings.length > 0) {
      await buildAll(ctx, playerKeypair, config.buildings);
    }

    // Step 6: Hire units
    for (const unit of config.units) {
      await hireUnits(ctx, playerKeypair, unit.type, unit.noviAmount);
    }

    // Step 7: Purchase equipment
    for (const equip of config.equipment) {
      await purchaseEquipment(ctx, playerKeypair, equip.type, equip.quantity);
    }

    // Step 8: Research
    if (config.research.length > 0) {
      await doResearch(ctx, playerKeypair, config.research);
    }

    log.info(`  Player ${playerIndex}: ${playerKeypair.publicKey.toBase58()}`);
    log.info(`  PDA: ${playerPda.toBase58()}\n`);
  }

  log.info(`Done — ${count} ${config.name} player(s) created.`);
}

// Flag parsing

function getFlag(flags: string[], name: string): string | undefined {
  const idx = flags.indexOf(name);
  if (idx === -1) return undefined;
  return flags[idx + 1];
}

function detectNextPlayerIndex(): number {
  const keysDir = path.join(__dirname, '../../../keys/players');
  if (!fs.existsSync(keysDir)) return 0;

  const files = fs.readdirSync(keysDir)
    .filter(f => f.startsWith('player-') && f.endsWith('.json'));

  if (files.length === 0) return 0;

  const indices = files.map(f => {
    const match = f.match(/^player-(\d+)\.json$/);
    return match ? parseInt(match[1], 10) : -1;
  }).filter(n => n >= 0);

  return indices.length > 0 ? Math.max(...indices) + 1 : 0;
}

// Step 1: Init user + player + research

async function initPlayer(
  ctx: CLIContext,
  keypair: Keypair,
  cityId: number,
  cityLat: number,
  cityLon: number,
  spawnIndex: number,
): Promise<void> {
  const [playerPda] = await derivePlayerPda(ctx.gameEngine, keypair.publicKey);

  if (await accountExists(ctx.connection, playerPda)) {
    log.skip('initPlayer [exists]');
    return;
  }

  // Offset spawn lat to avoid grid cell collision
  const spawnLat = cityLat + spawnIndex * 0.0001;

  const ixs = [
    await createInitUserInstruction({
      owner: keypair.publicKey,
      gameEngine: ctx.gameEngine,
    }),
    await createInitPlayerInstruction({
      owner: keypair.publicKey,
      gameEngine: ctx.gameEngine,
      startingCityId: cityId,
      cityLatitude: spawnLat,
      cityLongitude: cityLon,
    }),
    await createCreateProgressInstruction({
      owner: keypair.publicKey,
      gameEngine: ctx.gameEngine,
    }),
  ];

  await sendWithRetry(ctx, ixs, [keypair], { computeUnits: 600_000 });
  log.create('initUser + initPlayer + unlockResearch');
}

// Step 2: Estate + gems

async function createEstateAndBuyGems(
  ctx: CLIContext,
  keypair: Keypair,
  gemPurchases: number,
): Promise<void> {
  const [playerPda] = await derivePlayerPda(ctx.gameEngine, keypair.publicKey);
  const [estatePda] = await deriveEstatePda(playerPda);

  if (await accountExists(ctx.connection, estatePda)) {
    log.skip('estate [exists]');
    // Still buy gems if needed (player may exist but lack gems)
    if (gemPurchases > 0) {
      await buyGems(ctx, keypair, gemPurchases);
    }
    return;
  }

  // Batch: createEstate + first gem purchase
  const ixs = [
    await createCreateEstateInstruction(
      { owner: keypair.publicKey, gameEngine: ctx.gameEngine },
      { cityId: 1 }
    ),
  ];

  if (gemPurchases > 0) {
    ixs.push(await createPurchaseItemInstruction(
      {
        buyer: keypair.publicKey,
        gameEngine: ctx.gameEngine,
        itemId: GEMS_ITEM_ID,
        treasury: ctx.treasury.publicKey,
      },
      { quantity: 1 }
    ));
  }

  await sendWithRetry(ctx, ixs, [keypair]);
  log.create('estate' + (gemPurchases > 0 ? ' + gems (1)' : ''));

  // Buy remaining gems in batches
  if (gemPurchases > 1) {
    await buyGems(ctx, keypair, gemPurchases - 1);
  }
}

async function buyGems(ctx: CLIContext, keypair: Keypair, purchases: number): Promise<void> {
  for (let i = 0; i < purchases; i++) {
    const ix = await createPurchaseItemInstruction(
      {
        buyer: keypair.publicKey,
        gameEngine: ctx.gameEngine,
        itemId: GEMS_ITEM_ID,
        treasury: ctx.treasury.publicKey,
      },
      { quantity: 1 }
    );
    await sendWithRetry(ctx, ix, [keypair]);
  }
  log.create(`gems (${purchases} purchases)`);
}

// Step 5: Buildings

const builtSet = new Map<string, Set<number>>();

async function buildAll(
  ctx: CLIContext,
  keypair: Keypair,
  buildings: BuildingType[],
): Promise<void> {
  for (const buildingType of buildings) {
    await buildAndComplete(ctx, keypair, buildingType);
  }
}

async function buildAndComplete(
  ctx: CLIContext,
  keypair: Keypair,
  buildingType: BuildingType,
): Promise<void> {
  const key = keypair.publicKey.toBase58();
  const built = builtSet.get(key) ?? new Set();

  if (built.has(buildingType)) return;

  // Auto-build Mansion prerequisite
  if (buildingType !== BuildingType.Mansion && !built.has(BuildingType.Mansion)) {
    await buildAndComplete(ctx, keypair, BuildingType.Mansion);
  }

  // Single tx: build + 7x speedup(tier2) + complete
  const ixs = [
    await createBuildBuildingInstruction(
      { owner: keypair.publicKey, gameEngine: ctx.gameEngine },
      { buildingType }
    ),
  ];

  for (let i = 0; i < 7; i++) {
    ixs.push(await createBuildingSpeedupInstruction(
      { owner: keypair.publicKey, gameEngine: ctx.gameEngine },
      { buildingType, speedupTier: 2 }
    ));
  }

  ixs.push(await createCompleteBuildingInstruction(
    { owner: keypair.publicKey, gameEngine: ctx.gameEngine },
    { buildingType }
  ));

  try {
    await sendWithRetry(ctx, ixs, [keypair], { computeUnits: 400_000 });
  } catch (e: any) {
    const errCode = extractCustomError(e);

    if (errCode === 7706) {
      // BuildingAlreadyExists — skip
    } else if (errCode === 7708) {
      // ConstructionNotComplete — split into two txs
      const buildIxs = [
        await createBuildBuildingInstruction(
          { owner: keypair.publicKey, gameEngine: ctx.gameEngine },
          { buildingType }
        ),
      ];
      for (let i = 0; i < 7; i++) {
        buildIxs.push(await createBuildingSpeedupInstruction(
          { owner: keypair.publicKey, gameEngine: ctx.gameEngine },
          { buildingType, speedupTier: 2 }
        ));
      }
      await sendWithRetry(ctx, buildIxs, [keypair], { computeUnits: 400_000 });

      // Complete with extra speedups
      await completeExistingBuilding(ctx, keypair, buildingType);
    } else {
      throw e;
    }
  }

  // Wait for validator to process
  await new Promise(r => setTimeout(r, 500));

  built.add(buildingType);
  builtSet.set(key, built);
  log.create(`building: ${BuildingType[buildingType]}`);
}

async function completeExistingBuilding(
  ctx: CLIContext,
  keypair: Keypair,
  buildingType: BuildingType,
): Promise<void> {
  for (let round = 0; round < 8; round++) {
    // Try complete
    try {
      const completeIx = await createCompleteBuildingInstruction(
        { owner: keypair.publicKey, gameEngine: ctx.gameEngine },
        { buildingType }
      );
      await sendWithRetry(ctx, completeIx, [keypair], { computeUnits: 200_000 });
      return;
    } catch (e: any) {
      if (extractCustomError(e) !== 7708) throw e;
    }

    // Speedup
    try {
      const speedupIx = await createBuildingSpeedupInstruction(
        { owner: keypair.publicKey, gameEngine: ctx.gameEngine },
        { buildingType, speedupTier: 2 }
      );
      await sendWithRetry(ctx, speedupIx, [keypair], { computeUnits: 200_000 });
    } catch {
      // Speedup may fail if already at 0
    }
  }
}

// Step 3: Fund NOVI

async function fundNovi(
  ctx: CLIContext,
  keypair: Keypair,
  amount: number,
): Promise<void> {
  const MAX_PER_CALL = 100_000_000;
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
      const mintIx = await createMintForPrizeInstruction(
        {
          authority: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
          recipientOwner: keypair.publicKey,
        },
        { amount: BigInt(thisAmount), purpose }
      );
      await sendWithRetry(ctx, mintIx, [ctx.daoAuthority]);

      // Convert reserved -> locked (player signs)
      const convertIx = await createReservedToLockedInstruction(
        { owner: keypair.publicKey, gameEngine: ctx.gameEngine },
        { amount: BigInt(thisAmount) }
      );
      await sendWithRetry(ctx, convertIx, [keypair]);

      allocated += thisAmount;
      remaining -= thisAmount;
    }
  }

  log.create(`funded ${amount.toLocaleString()} NOVI`);
}

// Step 4: Buy plots — each plot unlocks 4 more building slots

async function buyPlots(
  ctx: CLIContext,
  keypair: Keypair,
  buildingCount: number,
): Promise<void> {
  const plotsNeeded = Math.min(
    Math.ceil(buildingCount / SLOTS_PER_PLOT),
    MAX_PLOTS,
  );
  const plotsToBuy = plotsNeeded - 1; // the estate already ships with 1 plot

  for (let i = 0; i < plotsToBuy; i++) {
    const ix = await createBuyPlotInstruction({
      owner: keypair.publicKey,
      gameEngine: ctx.gameEngine,
    });
    await sendWithRetry(ctx, ix, [keypair]);
  }

  if (plotsToBuy > 0) log.create(`bought ${plotsToBuy} plot(s)`);
}

// Step 6: Hire units

async function hireUnits(
  ctx: CLIContext,
  keypair: Keypair,
  unitType: number,
  noviAmount: number,
): Promise<void> {
  const ix = await createHireUnitsInstruction(
    { owner: keypair.publicKey, gameEngine: ctx.gameEngine },
    { unitType, noviAmount: BigInt(noviAmount) }
  );
  await sendWithRetry(ctx, ix, [keypair]);
  log.create(`units type=${unitType} (${noviAmount} NOVI)`);
}

// Step 7: Purchase equipment

async function purchaseEquipment(
  ctx: CLIContext,
  keypair: Keypair,
  equipmentType: number,
  quantity: number,
): Promise<void> {
  const ix = await createPurchaseEquipmentInstruction(
    { owner: keypair.publicKey, gameEngine: ctx.gameEngine },
    { equipmentType, quantity: BigInt(quantity), payWithCash: false }
  );
  await sendWithRetry(ctx, ix, [keypair]);
  log.create(`equipment type=${equipmentType} qty=${quantity}`);
}

// Step 8: Research (start + speedup + complete per level)

async function doResearch(
  ctx: CLIContext,
  keypair: Keypair,
  research: { type: number; targetLevel: number }[],
): Promise<void> {
  for (const r of research) {
    for (let level = 1; level <= r.targetLevel; level++) {
      // Start
      const startIx = await createStartResearchInstruction({
        gameEngine: ctx.gameEngine,
        owner: keypair.publicKey,
        researchType: r.type,
      });
      await sendWithRetry(ctx, startIx, [keypair]);

      // Speedup to completion (0 = complete all remaining)
      const speedupIx = await createSpeedUpResearchInstruction(
        { gameEngine: ctx.gameEngine, owner: keypair.publicKey, researchType: r.type },
        { speedUpSeconds: 0n }
      );
      await sendWithRetry(ctx, speedupIx, [keypair]);

      // Complete
      const completeIx = await createCompleteResearchInstruction({
        gameEngine: ctx.gameEngine,
        payer: keypair.publicKey,
        playerOwner: keypair.publicKey,
        researchType: r.type,
      });
      await sendWithRetry(ctx, completeIx, [keypair]);
    }
    log.create(`research type=${r.type} Lv${r.targetLevel}`);
  }
}

// Helpers

function extractCustomError(e: any): number | null {
  const txMsg = e?.transactionMessage ?? e?.message ?? '';
  const match = txMsg.match(/"Custom":(\d+)/);
  return match?.[1] ? parseInt(match[1], 10) : null;
}
