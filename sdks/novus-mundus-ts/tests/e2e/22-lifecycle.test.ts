/**
 * Full Game Lifecycle Test
 *
 * Single it() block covering all 24 game systems with 6 players.
 * 300s timeout. Mixed assertions: strict for economy/state, success-only for probabilistic.
 *
 * Extension Unlock Chain (critical ordering):
 *   createResearchProgress  → EXT_RESEARCH  (done in initializePlayerBatched)
 *   purchaseItem            → EXT_INVENTORY (done in createEstateBatched with gems)
 *   teamCreate/acceptInvite → EXT_TEAM
 *   rallyCreate/Join        → EXT_RALLY     (requires EXT_TEAM + Citadel)
 *   heroLock                → EXT_HEROES    (requires EXT_RALLY + Sanctuary)
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Keypair, PublicKey, Transaction, ComputeBudgetProgram } from '@solana/web3.js';

import {
  // Economy
  createUpdateLockedNoviInstruction,
  createCollectResourcesInstruction,
  createPurchaseStaminaInstruction,
  createVaultTransferInstruction,

  // Combat
  createAttackPlayerInstruction,
  createAttackEncounterInstruction,

  // Encounter
  createSpawnEncounterInstruction,

  // Estate
  createDailyActivityInstruction,
  createBuyPlotInstruction,

  // Research
  createStartResearchInstruction,
  createCompleteResearchInstruction,
  createSpeedUpResearchInstruction,

  // Team
  createTeamCreateInstruction,
  createTeamInviteInstruction,
  createTeamAcceptInviteInstruction,
  createTeamDepositTreasuryInstruction,
  createTeamSetMotdInstruction,
  createTeamUpdateSettingsInstruction,

  // Rally
  createRallyCreateInstruction,
  createRallyJoinInstruction,
  createRallyCancelInstruction,

  // Reinforcement
  createSendReinforcementInstruction,
  createProcessArrivalInstruction,
  createRecallReinforcementInstruction,
  createProcessReturnInstruction,
  createReinforcementSpeedupInstruction,

  // Expedition
  createExpeditionStartInstruction,
  createExpeditionStrikeInstruction,
  createExpeditionClaimInstruction,
  createExpeditionAbortInstruction,
  createExpeditionSpeedupInstruction,

  // Forge
  createInitializeForgeInstruction,
  createStartCraftInstruction,
  createStrikeInstruction,
  createEquipInstruction,

  // Sanctuary
  createStartMeditationInstruction,
  createClaimMeditationInstruction,
  createSpeedupMeditationInstruction,

  // Arena
  createCreateSeasonInstruction,
  createJoinSeasonInstruction,
  createUpdateLoadoutInstruction,
  createChallengePlayerInstruction,
  createClaimArenaDailyRewardInstruction,

  // Dungeon
  createCreateDungeonTemplateInstruction,
  createAttackInstruction,
  createFleeInstruction,

  // Castle
  createCreateCastleInstruction,
  createClaimVacantCastleInstruction,
  createUpdateCastleStatusInstruction,
  createAppointCourtInstruction,
  createJoinGarrisonInstruction,
  createClaimCastleRewardsInstruction,

  // Event
  createCreateEventInstruction,
  createJoinEventInstruction,

  // Shop
  createPurchaseItemInstruction,
  createCreateBundleInstruction,
  createCreateFlashSaleInstruction,
  createPurchaseBundleInstruction,
  createPurchaseFlashSaleInstruction,
  createPurchaseNoviInstruction,

  // Subscription
  createPurchaseSubscriptionInstruction,
  createDowngradeExpiredInstruction,

  // Token
  createReservedToLockedInstruction,

  // Progression
  createClaimDailyRewardInstruction,

  // Loot
  createClaimLootInstruction,

  // PDAs
  deriveNoviMintPda,
  deriveTeamPda,
  deriveRallyPda,
  deriveReinforcementPda,
  deriveEstatePda,
  deriveEncounterPda,
  deriveExpeditionPda,
  deriveLootPda,
  deriveCastlePda,
  deriveEventParticipationPda,
  deriveShopItemPda,

  // Enums
  BuildingType,
} from '../../src/index';

import {
  type TestContext,
  beforeAllTests,
  airdropIfNeeded,
  sendTx,
  CITIES,
  TEST_GEMS_ITEM,
  TEST_FRAGMENTS_ITEM,
  TEST_MATERIALS_ITEM,
} from '../fixtures/setup';

import { PlayerFactory, type TestPlayer } from '../fixtures/players';
import { HeroFactory, type TestHero } from '../fixtures/heroes';
import { enterDungeonIx } from '../fixtures/dungeon';
import {
  fetchPlayer,
  snapshotPlayer,
  diffPlayerSnapshots,
  accountExists,
  fetchTeam,
  fetchTeamById,
  fetchRally,
  fetchReinforcement,
  fetchExpedition,
  fetchEncounter,
  fetchArenaSeason,
  fetchArenaParticipant,
  fetchCastleRaw,
  fetchDungeonRunRaw,
  fetchEvent,
} from '../utils/accounts';
import { sendTransaction, sendInstruction, buildTransaction } from '../utils/transactions';
import { log } from '../utils/logger';
import { getCurrentTimestamp, advanceTime } from '../fixtures/time';

// Test

// Player-snapshot diff values are `bigint` post web3.js v3 migration, which
// `JSON.stringify` refuses to serialize — stringify bigints as decimal for logs.
const jstr = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));

describe('Full Game Lifecycle', () => {
  let ctx: TestContext;
  let factory: PlayerFactory;
  let heroFactory: HeroFactory;

  // 6 players
  let alpha: TestPlayer;
  let bravo: TestPlayer;
  let charlie: TestPlayer;
  let delta: TestPlayer;
  let echo: TestPlayer;
  let foxtrot: TestPlayer;

  // Heroes (set in Layer 8)
  let alphaWarrior: TestHero;
  let alphaArcher: TestHero;
  let alphaMage: TestHero;
  let bravoWarrior: TestHero;
  let echoWarrior: TestHero;

  // Admin-created IDs
  const CASTLE_CITY_ID = 0;
  const CASTLE_ID = 0;
  const ARENA_CITY_ID = 0;
  const ARENA_SEASON_ID = 0;
  const DUNGEON_TEMPLATE_ID = 0;
  const EVENT_ID = 0;
  const TEAM_ID = Date.now(); // unique team ID
  const RALLY_ID = 1;
  const BUNDLE_ID = 7001;

  beforeAll(async () => {
    log.section('Full Game Lifecycle - Setup');
    ctx = await beforeAllTests();
    factory = new PlayerFactory(ctx, { autoInit: false, autoEstate: false });
    heroFactory = new HeroFactory(ctx);

    // ── Admin Bootstrap ──
    log.step('Admin: Creating castle');
    const castleIx = await createCreateCastleInstruction(
      { daoAuthority: ctx.daoAuthority.publicKey, gameEngine: ctx.gameEngine },
      {
        cityId: CASTLE_CITY_ID,
        castleId: CASTLE_ID,
        tier: 2, // Tier 2 supports court (3 positions)
        latitude: Math.round(CITIES[0]!.lat * 10000),
        longitude: Math.round(CITIES[0]!.lon * 10000),
        minLevel: 1,
        minNetworthMillions: 0,
        minTroopsThousands: 0,
        name: 'TestCastle',
      }
    );
    await sendTx(ctx.svm, new Transaction().add(castleIx), [ctx.daoAuthority], ctx.config);
    log.txSuccess('Castle created');

    log.step('Admin: Creating arena season');
    const arenaIx = await createCreateSeasonInstruction(
      {
        authority: ctx.daoAuthority.publicKey,
        gameEngine: ctx.gameEngine,
        seasonId: ARENA_SEASON_ID,
      },
      {
        masterPrizePool: 100_000,
        dailyPrizePool: 100_000,
        dailyDistributionCap: 50_000,
        minLevelRequired: 1,
      }
    );
    await sendTx(ctx.svm, new Transaction().add(arenaIx), [ctx.daoAuthority], ctx.config);
    log.txSuccess('Arena season created');

    log.step('Admin: Creating dungeon template');
    const dungeonIx = await createCreateDungeonTemplateInstruction(
      {
        daoAuthority: ctx.daoAuthority.publicKey,
        gameEngine: ctx.gameEngine,
      },
      {
        templateId: DUNGEON_TEMPLATE_ID,
        name: 'TestDungeon',
        theme: 0,
        totalFloors: 3,
        roomsPerFloor: 5,
        checkpointInterval: 3,
        minPlayerLevel: 1,
        requiredBuildingLevel: 0,
        staminaCost: 0,
        bossPowerMultiplier: 15000,
        floorPower: [100, 150, 200, 250, 300, 350, 400, 450, 500, 550],
        combatWeight: 4000,
        treasureWeight: 2000,
        campWeight: 1500,
        restWeight: 1500,
        trapWeight: 1000,
        darknessBaseBps: 0,
        darknessPerFloorBps: 0,
        timeLimitSeconds: 0,
        baseXpPerRoom: 100,
        baseNoviPerFloor: 50,
        completionBonusBps: 5000,
        rewardScalingBps: 10000,
      }
    );
    await sendTx(ctx.svm, new Transaction().add(dungeonIx), [ctx.daoAuthority], ctx.config);
    log.txSuccess('Dungeon template created');

    {
      log.step('Admin: Creating event');
      const now = Math.floor(Date.now() / 1000);
      const eventIx = await createCreateEventInstruction(
        {
          authority: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
          eventId: EVENT_ID,
        },
        {
          name: 'LifecycleEvent',
          startTime: now - 3600,
          endTime: now + 604800, // 7 days (to survive all advanceTime calls during test)
          eventType: 0,
          minLevel: 1,
          minReputation: 0,
          requiredSubscriptionTier: 0,
          prizeType: 0,
          prizeAmount: 10000,
          autoActivate: true,
        }
      );
      await sendTx(ctx.svm, new Transaction().add(eventIx), [ctx.daoAuthority], ctx.config);
      log.txSuccess('Event created');
    }

    {
      log.step('Admin: Creating bundle');
      const bundleIx = await createCreateBundleInstruction(
        {
          payer: ctx.daoAuthority.publicKey,
          daoAuthority: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
        },
        {
          bundleId: BUNDLE_ID,
          tier: 1,
          category: 0,
          requiresSubscription: 0,
          savingsBps: 1000,
          priceSolLamports: BigInt(5000),
          availableFrom: BigInt(0),
          availableUntil: BigInt(0),
          isActive: true,
          items: [
            { itemId: TEST_GEMS_ITEM.itemId, quantity: 5 },
            { itemId: TEST_FRAGMENTS_ITEM.itemId, quantity: 5 },
          ],
        }
      );
      await sendTx(ctx.svm, new Transaction().add(bundleIx), [ctx.daoAuthority], ctx.config);
      log.txSuccess('Bundle created');
    }

    {
      log.step('Admin: Creating flash sale');
      const onChainNow = await getCurrentTimestamp(ctx.svm);
      const flashIx = await createCreateFlashSaleInstruction(
        {
          payer: ctx.daoAuthority.publicKey,
          daoAuthority: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
          saleId: 0, // First flash sale
        },
        {
          itemId: TEST_GEMS_ITEM.itemId,
          isBundle: false,
          discountBps: 2000,
          startsAt: BigInt(onChainNow + 2), // Starts in 2s — active well before Layer 4
          durationSecs: 3600, // 1 hour (min=3600, max=21600)
          maxStock: 100,
        }
      );
      await sendTx(ctx.svm, new Transaction().add(flashIx), [ctx.daoAuthority], ctx.config);
      log.txSuccess('Flash sale created');
    }
  });

  afterAll(() => {
    factory.clear();
    heroFactory.clear();
  });

  // Single lifecycle test

  it('runs the complete game lifecycle across all 24 systems', async () => {

    // ══════════════════════════════════════════════════════════
    // Layer 1: Player Init (STRICT)
    // ══════════════════════════════════════════════════════════
    log.section('Layer 1: Player Init');

    alpha = await factory.createPlayer({ cityId: 0, initialize: true });
    bravo = await factory.createPlayer({ cityId: 0, initialize: true });
    charlie = await factory.createPlayer({ cityId: 2, initialize: true });
    delta = await factory.createPlayer({ cityId: 3, initialize: true });
    echo = await factory.createPlayer({ cityId: 4, initialize: true });
    foxtrot = await factory.createPlayer({ cityId: 0, initialize: true });

    // Verify all players exist
    for (const p of [alpha, bravo, charlie, delta, echo, foxtrot]) {
      const account = await fetchPlayer(ctx.svm, p.playerPda);
      expect(account).not.toBeNull();
      expect(account!.level).toBe(1);
    }
    log.txSuccess('All 6 players initialized and verified');

    // ══════════════════════════════════════════════════════════
    // Layer 2: Estate + Buildings (STRICT)
    // EXT_RESEARCH already unlocked (from initializePlayerBatched)
    // EXT_INVENTORY unlocked here (from purchaseItem in createEstateBatched)
    // ══════════════════════════════════════════════════════════
    log.section('Layer 2: Estate + Buildings');

    // Create estates for all players (with gems for building speedups)
    for (const p of [alpha, bravo, charlie, delta, echo, foxtrot]) {
      await factory.createEstateBatched(p, true);
      expect(p.hasEstate).toBe(true);
    }
    log.txSuccess('All estates created');

    // Alpha: Buy plots 2+3 → 12 slots (3 plots × 4)
    log.step('Alpha: Buying extra plots');
    {
      const buyPlotIx1 = await createBuyPlotInstruction({
        owner: alpha.publicKey,
        gameEngine: ctx.gameEngine,
      });
      await sendTx(ctx.svm, new Transaction().add(buyPlotIx1), [alpha.keypair], ctx.config);
      log.txSuccess('Alpha: bought plot 2');

      const buyPlotIx2 = await createBuyPlotInstruction({
        owner: alpha.publicKey,
        gameEngine: ctx.gameEngine,
      });
      await sendTx(ctx.svm, new Transaction().add(buyPlotIx2), [alpha.keypair], ctx.config);
      log.txSuccess('Alpha: bought plot 3');
    }

    // Bravo: Buy plot 2 → 8 slots (2 plots × 4)
    log.step('Bravo: Buying extra plot');
    {
      const buyPlotIx = await createBuyPlotInstruction({
        owner: bravo.publicKey,
        gameEngine: ctx.gameEngine,
      });
      await sendTx(ctx.svm, new Transaction().add(buyPlotIx), [bravo.keypair], ctx.config);
      log.txSuccess('Bravo: bought plot 2');
    }

    // Alpha: 12 buildings (Mansion + 11 needed for full lifecycle, 12 slots = 3 plots × 4)
    // Camp for operatives, Stables for travel, Mine/Dock for expeditions
    for (const b of [
      BuildingType.Mansion, BuildingType.Barracks, BuildingType.Camp,
      BuildingType.Market, BuildingType.Vault, BuildingType.Academy,
      BuildingType.MeditationChamber, BuildingType.Citadel, BuildingType.Forge,
      BuildingType.Dock, BuildingType.TransportBay, BuildingType.Mine,
    ]) {
      await factory.buildAndCompleteBuilding(alpha, b);
      log.txSuccess(`Alpha built ${BuildingType[b]}`);
    }

    // Bravo: 6 buildings (Mansion, Barracks, Camp, Market, Sanctuary, Arena)
    for (const b of [
      BuildingType.Mansion, BuildingType.Barracks, BuildingType.Camp, BuildingType.Market,
      BuildingType.MeditationChamber, BuildingType.Arena,
    ]) {
      await factory.buildAndCompleteBuilding(bravo, b);
    }
    log.txSuccess('Bravo: all buildings constructed');

    // Charlie: 4 buildings (Mansion, Barracks, Camp, Stables)
    for (const b of [BuildingType.Mansion, BuildingType.Barracks, BuildingType.Camp, BuildingType.TransportBay]) {
      await factory.buildAndCompleteBuilding(charlie, b);
    }

    // Delta: 3 buildings (Mansion, Barracks, Camp)
    for (const b of [BuildingType.Mansion, BuildingType.Barracks, BuildingType.Camp]) {
      await factory.buildAndCompleteBuilding(delta, b);
    }

    // Echo: 5 buildings (Mansion, Barracks, Camp, Arena, Catacombs)
    for (const b of [BuildingType.Mansion, BuildingType.Barracks, BuildingType.Camp, BuildingType.Arena, BuildingType.DungeonEntry]) {
      await factory.buildAndCompleteBuilding(echo, b);
    }

    // Foxtrot: 3 buildings (Mansion, Barracks, Camp)
    for (const b of [BuildingType.Mansion, BuildingType.Barracks, BuildingType.Camp]) {
      await factory.buildAndCompleteBuilding(foxtrot, b);
    }

    log.txSuccess('All buildings constructed');

    // ══════════════════════════════════════════════════════════
    // Layer 3: Economy (STRICT)
    // ══════════════════════════════════════════════════════════
    log.section('Layer 3: Economy');

    // Alpha: updateLockedNovi
    const beforeNovi = await snapshotPlayer(ctx.svm, alpha.playerPda);
    {
      const ix = await createUpdateLockedNoviInstruction({
        owner: alpha.publicKey,
        gameEngine: ctx.gameEngine,
      });
      await sendTx(ctx.svm, new Transaction().add(ix), [alpha.keypair], ctx.config);
      log.txSuccess('Alpha: updateLockedNovi');
    }
    const afterNovi = await snapshotPlayer(ctx.svm, alpha.playerPda);
    if (beforeNovi && afterNovi) {
      const diff = diffPlayerSnapshots(beforeNovi, afterNovi);
      log.info(`lockedNovi diff: ${Object.keys(diff.changes).join(', ') || 'none (fresh player)'}`);
    }

    // All players: hireUnits (Barracks/Camp now built for all)
    // Use 500+ NOVI per call to clear the InsufficientPower threshold even
    // when the time-of-day Hiring multiplier penalizes (e.g. DeepNight 0.618x).
    log.step('Hiring units for all players');
    await factory.hireUnits(alpha, 0, 500);
    await factory.hireUnits(alpha, 1, 500);
    await factory.hireUnits(alpha, 3, 500);
    await factory.hireUnits(alpha, 4, 500);
    log.txSuccess('Alpha: units hired');

    await factory.hireUnits(bravo, 0, 500);
    await factory.hireUnits(bravo, 1, 500);
    log.txSuccess('Bravo: units hired');

    await factory.hireUnits(charlie, 0, 500);
    log.txSuccess('Charlie: units hired');

    await factory.hireUnits(delta, 0, 500);
    await factory.hireUnits(delta, 1, 500);
    log.txSuccess('Delta: units hired');

    await factory.hireUnits(echo, 0, 500);
    await factory.hireUnits(echo, 1, 500);
    log.txSuccess('Echo: units hired');

    await factory.hireUnits(foxtrot, 0, 500);
    log.txSuccess('Foxtrot: units hired');

    // Alpha: collectResources (cash)
    {
      const before = await snapshotPlayer(ctx.svm, alpha.playerPda);
      const ix = await createCollectResourcesInstruction(
        { owner: alpha.publicKey, gameEngine: ctx.gameEngine },
        { noviAmount: 50, collectionType: 0 }
      );
      await sendTx(ctx.svm, new Transaction().add(ix), [alpha.keypair], ctx.config);
      const after = await snapshotPlayer(ctx.svm, alpha.playerPda);
      if (before && after) {
        const diff = diffPlayerSnapshots(before, after);
        log.info(`Cash change: ${jstr(diff.changes['cashOnHand'] ?? 'no change')}`);
      }
      log.txSuccess('Alpha: collectResources (cash)');
    }

    // Alpha: purchaseEquipment (Market now built)
    {
      const before = await snapshotPlayer(ctx.svm, alpha.playerPda);
      await factory.purchaseEquipment(alpha, 0, 50); // melee
      await factory.purchaseEquipment(alpha, 1, 50); // ranged
      const after = await snapshotPlayer(ctx.svm, alpha.playerPda);
      if (before && after) {
        const diff = diffPlayerSnapshots(before, after);
        log.info(`Equipment purchased, fields changed: ${Object.keys(diff.changes).join(', ')}`);
      }
      log.txSuccess('Alpha: equipment purchased');
    }

    // Alpha: purchaseStamina
    {
      const ix = await createPurchaseStaminaInstruction(
        { owner: alpha.publicKey, gameEngine: ctx.gameEngine },
        { amount: 50 }
      );
      await sendTx(ctx.svm, new Transaction().add(ix), [alpha.keypair], ctx.config);
      log.txSuccess('Alpha: purchaseStamina');
    }

    // Alpha: vaultTransfer (deposit) — Vault now built
    {
      const before = await snapshotPlayer(ctx.svm, alpha.playerPda);
      const ix = await createVaultTransferInstruction(
        { owner: alpha.publicKey, gameEngine: ctx.gameEngine },
        { amount: 1000, toVault: true }
      );
      await sendTx(ctx.svm, new Transaction().add(ix), [alpha.keypair], ctx.config);
      const after = await snapshotPlayer(ctx.svm, alpha.playerPda);
      if (before && after) {
        const diff = diffPlayerSnapshots(before, after);
        log.info(`Vault transfer: ${jstr(diff.changes['cashInVault'] ?? 'no change')}`);
      }
      log.txSuccess('Alpha: vaultTransfer (deposit)');
    }

    // ══════════════════════════════════════════════════════════
    // Layer 4: Shop (STRICT item, SUCCESS bundle/flash)
    // ══════════════════════════════════════════════════════════
    log.section('Layer 4: Shop');

    // Purchase item (gems) — EXT_INVENTORY already unlocked from createEstateBatched
    {
      const before = await snapshotPlayer(ctx.svm, alpha.playerPda);
      const ix = await createPurchaseItemInstruction(
        {
          buyer: alpha.publicKey,
          gameEngine: ctx.gameEngine,
          itemId: TEST_GEMS_ITEM.itemId,
          treasury: ctx.treasury.publicKey,
        },
        { quantity: 1 }
      );
      await sendTx(ctx.svm, new Transaction().add(ix), [alpha.keypair], ctx.config);
      const after = await snapshotPlayer(ctx.svm, alpha.playerPda);
      log.txSuccess('Alpha: purchaseItem (gems)');
    }

    {
      // Purchase bundle
      const [gemsItemPda] = await deriveShopItemPda(ctx.gameEngine, TEST_GEMS_ITEM.itemId);
      const [fragmentsItemPda] = await deriveShopItemPda(ctx.gameEngine, TEST_FRAGMENTS_ITEM.itemId);
      const ix = await createPurchaseBundleInstruction(
        {
          buyer: alpha.publicKey,
          gameEngine: ctx.gameEngine,
          bundleId: BUNDLE_ID,
          treasury: ctx.treasury.publicKey,
          shopItemAccounts: [gemsItemPda, fragmentsItemPda],
        }
      );
      await sendTx(ctx.svm, new Transaction().add(ix), [alpha.keypair], ctx.config);
      log.txSuccess('Alpha: purchaseBundle');
    }

    {
      // Advance time so flash sale becomes active (startsAt = onChainNow + 2 in beforeAll)
      await advanceTime(ctx.svm, 5);
      // Purchase flash sale
      const [gemsItemPda] = await deriveShopItemPda(ctx.gameEngine, TEST_GEMS_ITEM.itemId);
      const ix = await createPurchaseFlashSaleInstruction(
        {
          buyer: alpha.publicKey,
          gameEngine: ctx.gameEngine,
          saleId: 0,
          itemOrBundle: gemsItemPda,
          treasury: ctx.treasury.publicKey,
        },
        { quantity: 1 }
      );
      await sendTx(ctx.svm, new Transaction().add(ix), [alpha.keypair], ctx.config);
      log.txSuccess('Alpha: purchaseFlashSale');
    }

    // ══════════════════════════════════════════════════════════
    // Layer 5: Team (STRICT — unlocks EXT_TEAM)
    // ══════════════════════════════════════════════════════════
    log.section('Layer 5: Team');

    let teamPda: PublicKey;
    [teamPda] = await deriveTeamPda(ctx.gameEngine, TEAM_ID);

    // Alpha: createTeam → unlocks EXT_TEAM for Alpha
    {
      const ix = await createTeamCreateInstruction(
        {
          owner: alpha.publicKey,
          gameEngine: ctx.gameEngine,
          teamId: TEAM_ID,
        },
        { name: 'LifecycleTeam' }
      );
      await sendTx(ctx.svm, new Transaction().add(ix), [alpha.keypair], ctx.config);
      const teamExists = await accountExists(ctx.svm, teamPda);
      expect(teamExists).toBe(true);
      log.txSuccess('Alpha: team created');
    }

    // Invite + accept: Bravo (slot 1) → unlocks EXT_TEAM for Bravo
    {
      const inviteBravoIx = await createTeamInviteInstruction({
        inviter: alpha.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId: TEAM_ID,
        inviterSlotIndex: 0,
        inviteePlayer: bravo.playerPda,
        leaderPlayer: alpha.playerPda,
      });
      await sendTx(ctx.svm, new Transaction().add(inviteBravoIx), [alpha.keypair], ctx.config);

      const acceptBravoIx = await createTeamAcceptInviteInstruction({
        owner: bravo.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId: TEAM_ID,
        slotIndex: 1,
        inviteRefund: alpha.publicKey,
        leaderPlayer: alpha.playerPda,
      });
      await sendTx(ctx.svm, new Transaction().add(acceptBravoIx), [bravo.keypair], ctx.config);
      log.txSuccess('Bravo: accepted invite (slot 1)');
    }

    // Invite + accept: Charlie (slot 2) → unlocks EXT_TEAM for Charlie
    {
      const inviteCharlieIx = await createTeamInviteInstruction({
        inviter: alpha.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId: TEAM_ID,
        inviterSlotIndex: 0,
        inviteePlayer: charlie.playerPda,
        leaderPlayer: alpha.playerPda,
      });
      await sendTx(ctx.svm, new Transaction().add(inviteCharlieIx), [alpha.keypair], ctx.config);

      const acceptCharlieIx = await createTeamAcceptInviteInstruction({
        owner: charlie.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId: TEAM_ID,
        slotIndex: 2,
        inviteRefund: alpha.publicKey,
        leaderPlayer: alpha.playerPda,
      });
      await sendTx(ctx.svm, new Transaction().add(acceptCharlieIx), [charlie.keypair], ctx.config);
      log.txSuccess('Charlie: accepted invite (slot 2)');
    }

    // Invite + accept: Foxtrot (slot 3) → unlocks EXT_TEAM for Foxtrot
    {
      const inviteFoxtrotIx = await createTeamInviteInstruction({
        inviter: alpha.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId: TEAM_ID,
        inviterSlotIndex: 0,
        inviteePlayer: foxtrot.playerPda,
        leaderPlayer: alpha.playerPda,
      });
      await sendTx(ctx.svm, new Transaction().add(inviteFoxtrotIx), [alpha.keypair], ctx.config);

      const acceptFoxtrotIx = await createTeamAcceptInviteInstruction({
        owner: foxtrot.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId: TEAM_ID,
        slotIndex: 3,
        inviteRefund: alpha.publicKey,
        leaderPlayer: alpha.playerPda,
      });
      await sendTx(ctx.svm, new Transaction().add(acceptFoxtrotIx), [foxtrot.keypair], ctx.config);
      log.txSuccess('Foxtrot: accepted invite (slot 3)');
    }

    // Bravo: depositTreasury
    {
      const ix = await createTeamDepositTreasuryInstruction(
        {
          owner: bravo.publicKey,
          gameEngine: ctx.gameEngine,
          team: teamPda,
          teamId: TEAM_ID,
        },
        { amount: 5000 }
      );
      await sendTx(ctx.svm, new Transaction().add(ix), [bravo.keypair], ctx.config);
      log.txSuccess('Bravo: depositTreasury(5000)');
    }

    // Alpha: setMotd
    {
      const ix = await createTeamSetMotdInstruction(
        {
          owner: alpha.publicKey,
          gameEngine: ctx.gameEngine,
          team: teamPda,
          teamId: TEAM_ID,
          slotIndex: 0,
        },
        { motd: 'Lifecycle test!' }
      );
      await sendTx(ctx.svm, new Transaction().add(ix), [alpha.keypair], ctx.config);
      log.txSuccess('Alpha: setMotd');
    }

    // Alpha: updateSettings
    {
      const ix = await createTeamUpdateSettingsInstruction(
        {
          member: alpha.publicKey,
          gameEngine: ctx.gameEngine,
          team: teamPda,
          teamId: TEAM_ID,
          slotIndex: 0,
        },
        { settings: 1, minLevelToJoin: 1 } // SETTING_PUBLIC
      );
      await sendTx(ctx.svm, new Transaction().add(ix), [alpha.keypair], ctx.config);
      log.txSuccess('Alpha: updateSettings');
    }

    // ══════════════════════════════════════════════════════════
    // Layer 6: Rally (STRICT — unlocks EXT_RALLY)
    // Requires: EXT_TEAM + Citadel building (Alpha has both)
    // ══════════════════════════════════════════════════════════
    log.section('Layer 6: Rally');

    let rallyPda: PublicKey;

    // Alpha: createRally targeting Delta → unlocks EXT_RALLY for Alpha
    {
      [rallyPda] = await deriveRallyPda(ctx.gameEngine, alpha.publicKey, RALLY_ID);

      const ix = await createRallyCreateInstruction(
        {
          owner: alpha.publicKey,
          gameEngine: ctx.gameEngine,
          rallyId: RALLY_ID,
          target: delta.playerPda,
          teamId: TEAM_ID,
          rallyCityId: alpha.startingCityId,
        },
        {
          targetType: 0, // Player
          gatherDuration: 60,
          targetCityId: delta.startingCityId,
          defensiveUnit1: 10,
          defensiveUnit2: 0,
          defensiveUnit3: 0,
          meleeWeapons: 5,
          rangedWeapons: 3,
          siegeWeapons: 0,
        }
      );
      await sendTx(ctx.svm, new Transaction().add(ix), [alpha.keypair], ctx.config);
      const exists = await accountExists(ctx.svm, rallyPda);
      expect(exists).toBe(true);
      log.txSuccess('Alpha: createRally');

      // Bravo: joinRally → unlocks EXT_RALLY for Bravo
      const joinIx = await createRallyJoinInstruction(
        {
          owner: bravo.publicKey,
          gameEngine: ctx.gameEngine,
          rally: rallyPda,
          rallyCreator: alpha.publicKey,
          rallyId: RALLY_ID,
          teamId: TEAM_ID,
          rallyCityId: alpha.startingCityId,
        },
        {
          defensiveUnit1: 5,
          defensiveUnit2: 0,
          defensiveUnit3: 0,
          meleeWeapons: 0,
          rangedWeapons: 0,
          siegeWeapons: 0,
        }
      );
      await sendTx(ctx.svm, new Transaction().add(joinIx), [bravo.keypair], ctx.config);
      log.txSuccess('Bravo: joinRally');

      // Alpha: cancelRally → units should be returned
      const before = await snapshotPlayer(ctx.svm, alpha.playerPda);
      const cancelIx = await createRallyCancelInstruction({
        owner: alpha.publicKey,
        gameEngine: ctx.gameEngine,
        rally: rallyPda,
        rallyId: RALLY_ID,
        rallyCityId: alpha.startingCityId,
      });
      await sendTx(ctx.svm, new Transaction().add(cancelIx), [alpha.keypair], ctx.config);
      const after = await snapshotPlayer(ctx.svm, alpha.playerPda);
      if (before && after) {
        const diff = diffPlayerSnapshots(before, after);
        log.info(`Rally cancel diff: ${Object.keys(diff.changes).join(', ') || 'none'}`);
      }
      log.txSuccess('Alpha: cancelRally (units returned)');
    }

    // ══════════════════════════════════════════════════════════
    // Layer 7: Heroes (STRICT — unlocks EXT_HEROES)
    // Requires: EXT_RALLY + Sanctuary building
    // Alpha has: Sanctuary + EXT_RALLY (from rally create)
    // Bravo has: Sanctuary + EXT_RALLY (from rally join)
    // ══════════════════════════════════════════════════════════
    log.section('Layer 7: Heroes');

    // Mint 3 heroes for Alpha
    alphaWarrior = await heroFactory.mintHero(alpha, 1);
    alphaArcher = await heroFactory.mintHero(alpha, 2);
    alphaMage = await heroFactory.mintHero(alpha, 3);
    log.txSuccess('Alpha: 3 heroes minted');

    // Lock/level/assign heroes
    await heroFactory.lockHero(alpha, alphaWarrior, 0);
    log.txSuccess('Alpha: warrior locked to slot 0');

    // Buy fragments for level-up, unlock hero, level up, re-lock
    await factory.buyFragments(alpha, 1);
    await heroFactory.unlockHero(alpha, alphaWarrior, 0);
    await heroFactory.levelUpHero(alpha, alphaWarrior);
    log.txSuccess('Alpha: warrior leveled up');
    await heroFactory.lockHero(alpha, alphaWarrior, 0);

    await heroFactory.assignDefensiveHero(alpha, alphaWarrior, 0);
    log.txSuccess('Alpha: warrior assigned as defensive hero');

    await heroFactory.unlockHero(alpha, alphaWarrior, 0);
    await heroFactory.lockHero(alpha, alphaWarrior, 0);
    log.txSuccess('Alpha: warrior unlock/re-lock cycle');

    try {
      await heroFactory.lockHero(alpha, alphaArcher, 1);
      await heroFactory.lockHero(alpha, alphaMage, 2);
      log.txSuccess('Alpha: all heroes locked');
    } catch (e) { log.caught('Alpha: extra hero locks (MaxHeroesLocked at Sanctuary L1)', e); }

    // Mint 1 hero for Bravo and lock
    bravoWarrior = await heroFactory.mintHero(bravo, 1);
    await heroFactory.lockHero(bravo, bravoWarrior, 0);
    log.txSuccess('Bravo: warrior minted and locked');

    // Mint 1 hero for Echo (for dungeon — Echo has Arena + no rally state)
    echoWarrior = await heroFactory.mintHero(echo, 1);
    log.txSuccess('Echo: warrior minted (for dungeon)');

    // ══════════════════════════════════════════════════════════
    // Layer 8: Research (STRICT — Academy now built)
    // ══════════════════════════════════════════════════════════
    log.section('Layer 8: Research');

    {
      const ix = await createStartResearchInstruction({
        owner: alpha.publicKey,
        gameEngine: ctx.gameEngine,
        researchType: 0,
      });
      await sendTx(ctx.svm, new Transaction().add(ix), [alpha.keypair], ctx.config);
      log.txSuccess('Alpha: startResearch (type 0)');

      // Speed up and complete
      const speedIx1 = await createSpeedUpResearchInstruction(
        {
          owner: alpha.publicKey,
          gameEngine: ctx.gameEngine,
          researchType: 0,
        },
        { speedUpSeconds: 0 }
      );
      await sendTx(ctx.svm, new Transaction().add(speedIx1), [alpha.keypair], ctx.config);
      log.txSuccess('Alpha: speedUpResearch');

      const completeIx = await createCompleteResearchInstruction({
        payer: alpha.publicKey,
        gameEngine: ctx.gameEngine,
        playerOwner: alpha.publicKey,
        researchType: 0,
      });
      await sendTx(ctx.svm, new Transaction().add(completeIx), [alpha.keypair], ctx.config);
      log.txSuccess('Alpha: completeResearch');
    }

    // ══════════════════════════════════════════════════════════
    // Layer 9: Subscription (STRICT)
    // ══════════════════════════════════════════════════════════
    log.section('Layer 9: Subscription');

    // Alpha: purchase Expert tier (offchain payment with DAO as paymentAuthority)
    {
      const ix = await createPurchaseSubscriptionInstruction(
        {
          owner: alpha.publicKey,
          gameEngine: ctx.gameEngine,
          paymentAuthority: ctx.daoAuthority.publicKey,
          treasury: ctx.treasury.publicKey,
        },
        { paymentType: 1, tier: 1 } // 1=OFFCHAIN, tier 1=Expert
      );
      await sendTx(ctx.svm, new Transaction().add(ix), [alpha.keypair, ctx.daoAuthority], ctx.config);
      const account = await fetchPlayer(ctx.svm, alpha.playerPda);
      expect(account).not.toBeNull();
      log.txSuccess('Alpha: subscription purchased (Expert)');
    }

    {
      // Echo: downgradeExpired (no-op expected)
      const ix = createDowngradeExpiredInstruction({
        playerAccount: echo.playerPda,
      });
      await sendTx(ctx.svm, new Transaction().add(ix), [echo.keypair], ctx.config);
      log.txSuccess('Echo: downgradeExpired (no-op)');
    }

    // ══════════════════════════════════════════════════════════
    // Layer 10: Progression (STRICT)
    // ══════════════════════════════════════════════════════════
    log.section('Layer 10: Progression');

    // Research type 20 (DailyRewardsSystem) to unlock has_daily_rewards
    {
      const ix20 = await createStartResearchInstruction({
        owner: alpha.publicKey,
        gameEngine: ctx.gameEngine,
        researchType: 20,
      });
      await sendTx(ctx.svm, new Transaction().add(ix20), [alpha.keypair], ctx.config);

      const speed20 = await createSpeedUpResearchInstruction(
        { owner: alpha.publicKey, gameEngine: ctx.gameEngine, researchType: 20 },
        { speedUpSeconds: 0 }
      );
      await sendTx(ctx.svm, new Transaction().add(speed20), [alpha.keypair], ctx.config);

      const complete20 = await createCompleteResearchInstruction({
        payer: alpha.publicKey,
        playerOwner: alpha.publicKey,
        gameEngine: ctx.gameEngine,
        researchType: 20,
      });
      await sendTx(ctx.svm, new Transaction().add(complete20), [alpha.keypair], ctx.config);
      log.txSuccess('Alpha: completeResearch (type 20 - DailyRewards unlocked)');
    }

    {
      const before = await snapshotPlayer(ctx.svm, alpha.playerPda);
      const ix = await createClaimDailyRewardInstruction({
        owner: alpha.publicKey,
        gameEngine: ctx.gameEngine,
      });
      await sendTx(ctx.svm, new Transaction().add(ix), [alpha.keypair], ctx.config);
      const after = await snapshotPlayer(ctx.svm, alpha.playerPda);
      if (before && after) {
        const diff = diffPlayerSnapshots(before, after);
        log.info(`Daily reward diff: ${Object.keys(diff.changes).join(', ') || 'none'}`);
      }
      log.txSuccess('Alpha: claimDailyReward');
    }

    // ══════════════════════════════════════════════════════════
    // Layer 11: Travel (STRICT positions)
    // ══════════════════════════════════════════════════════════
    log.section('Layer 11: Travel');

    // Charlie: intercity travel city 2 → city 0
    log.step('Charlie: intercity travel city 2 → city 0');
    {
      // Buy gems for speedups
      await factory.buyGems(charlie, 1);

      const charlieLocation = await factory.getPlayerLocation(charlie);
      if (charlieLocation && charlieLocation.cityId === 2) {
        const destCity = CITIES[0]!;
        const destGridLat = Math.round(destCity.lat * 10000);
        const destGridLong = Math.round(destCity.lon * 10000) + 5; // Offset to avoid occupied cells

        await factory.startIntercityTravel(charlie, 2, 0, charlieLocation.gridLat, charlieLocation.gridLong, destGridLat, destGridLong);
        log.txSuccess('Charlie: intercity travel started');

        // 12 speedups (tier 2 = 25% remaining per application)
        for (let i = 0; i < 12; i++) {
          try {
            await factory.speedupTravel(charlie, 2);
          } catch { break; }
        }

        // Advance LiteSVM clock past travel arrival time
        await advanceTime(ctx.svm, 5);

        await factory.completeIntercityTravel(charlie, 2, 0, destGridLat, destGridLong);
        log.txSuccess('Charlie: intercity travel completed');

        const newLocation = await factory.getPlayerLocation(charlie);
        log.info(`Charlie now in city ${newLocation?.cityId}`);
      }
    }

    // Alpha: move to Delta's location for combat
    // Note: Alpha has current_rallies_joined > 0 from rally create (cancel doesn't decrement),
    // Rally cancel now decrements current_rallies_joined, so Alpha can travel.
    log.step('Alpha: moving to Delta for combat positioning');
    await factory.movePlayerToPlayer(alpha, delta);
    const alphaLoc = await factory.getPlayerLocation(alpha);
    const deltaLoc = await factory.getPlayerLocation(delta);
    log.info(`Alpha city=${alphaLoc?.cityId}, Delta city=${deltaLoc?.cityId}`);
    log.txSuccess('Alpha: moved to Delta');

    // ══════════════════════════════════════════════════════════
    // Layer 12: Combat (SUCCESS-ONLY outcomes)
    // ══════════════════════════════════════════════════════════
    log.section('Layer 12: Combat');

    // Echo: spawnEncounter + attackEncounter flow
    let encounterPda: PublicKey | null = null;
    try {
      const echoLoc = await factory.getPlayerLocation(echo);
      if (echoLoc) {
        const encounterIndex = 0;
        const [encPda] = await deriveEncounterPda(ctx.gameEngine, echoLoc.cityId, encounterIndex);
        encounterPda = encPda;

        const ix = await createSpawnEncounterInstruction(
          {
            payer: echo.publicKey,
            playerOwner: echo.publicKey,
            gameEngine: ctx.gameEngine,
            cityId: echoLoc.cityId,
            encounterIndex,
            gridLat: echoLoc.gridLat,
            gridLong: echoLoc.gridLong,
          },
          { encounterType: 0 } // Common
        );
        await sendTx(ctx.svm, new Transaction().add(ix), [echo.keypair], ctx.config);
        log.txSuccess('Echo: spawnEncounter (Common)');

        // Echo: attackEncounter
        const attackEncIx = await createAttackEncounterInstruction(
          {
            owner: echo.publicKey,
            gameEngine: ctx.gameEngine,
            encounter: encounterPda,
          },
          { encounterId: 0 }
        );
        await sendTx(ctx.svm, new Transaction().add(attackEncIx), [echo.keypair], ctx.config);
        log.txSuccess('Echo: attackEncounter');

        // Try to claim loot
        const [lootPda] = await deriveLootPda(echo.playerPda, 0);
        const lootExists = await accountExists(ctx.svm, lootPda);
        if (lootExists) {
          const claimIx = await createClaimLootInstruction({
            owner: echo.publicKey,
            gameEngine: ctx.gameEngine,
            loot: lootPda,
            creator: encounterPda,
          });
          await sendTx(ctx.svm, new Transaction().add(claimIx), [echo.keypair], ctx.config);
          log.txSuccess('Echo: claimLoot');
        } else {
          log.info('No loot to claim (encounter not dead yet)');
        }
      }
    } catch (e) { log.caught('Echo: encounter flow', e); }

    {
      // Alpha: attackPlayer(Delta) — both have units + equipment
      const ix = await createAttackPlayerInstruction(
        {
          attacker: alpha.publicKey,
          gameEngine: ctx.gameEngine,
          defenderPlayer: delta.playerPda,
          attackerCityId: delta.startingCityId,
          defenderCityId: delta.startingCityId,
        },
        { driveBy: false }
      );
      await sendTx(ctx.svm, new Transaction().add(ix), [alpha.keypair], ctx.config);
      log.txSuccess('Alpha: attackPlayer(Delta)');
    }

    // ══════════════════════════════════════════════════════════
    // Layer 13: Reinforcement (STRICT send/recall)
    // ══════════════════════════════════════════════════════════
    log.section('Layer 13: Reinforcement');

    {
      // Bravo: sendReinforcement to Alpha (5 DU1) — has units from Layer 3
      // Alpha moved to Delta's city in Layer 11, so use Delta's city as destination
      const alphaCurrentCity = (await factory.getPlayerLocation(alpha))?.cityId ?? alpha.startingCityId;
      const beforeBravo = await snapshotPlayer(ctx.svm, bravo.playerPda);
      const ix = await createSendReinforcementInstruction(
        {
          sender: bravo.publicKey,
          gameEngine: ctx.gameEngine,
          destinationOwner: alpha.publicKey,
          senderCityId: bravo.startingCityId,
          destinationCityId: alphaCurrentCity,
          teamId: TEAM_ID,
        },
        {
          defensiveUnit1: 5,
          defensiveUnit2: 0,
          defensiveUnit3: 0,
          meleeWeapons: 0,
          rangedWeapons: 0,
          siegeWeapons: 0,
          heroSlot: 255, // no hero
        }
      );
      await sendTx(ctx.svm, new Transaction().add(ix), [bravo.keypair], ctx.config);
      log.txSuccess('Bravo: sendReinforcement to Alpha (5 DU1)');

      // Verify reinforcement account exists
      const [reinforcementPda] = await deriveReinforcementPda(ctx.gameEngine, bravo.publicKey, alpha.publicKey);
      const exists = await accountExists(ctx.svm, reinforcementPda);
      expect(exists).toBe(true);
      log.info('Reinforcement account exists');

      // Verify Bravo lost DU1
      const afterBravo = await snapshotPlayer(ctx.svm, bravo.playerPda);
      if (beforeBravo && afterBravo) {
        const diff = diffPlayerSnapshots(beforeBravo, afterBravo);
        expect(diff.changes['defensiveUnit1']).toBeDefined();
        log.info(`Bravo DU1 change: ${jstr(diff.changes['defensiveUnit1'])}`);
      }

      // Buy gems for Bravo to pay for speedups
      await factory.buyGems(bravo, 10); // 10,000 gems
      log.txSuccess('Bravo: bought gems for reinforcement speedups');

      // Speedup outbound travel (tier 2 = 25% remaining per application)
      for (let i = 0; i < 5; i++) {
        const speedupIx = await createReinforcementSpeedupInstruction(
          {
            sender: bravo.publicKey,
            gameEngine: ctx.gameEngine,
            destinationOwner: alpha.publicKey,
          },
          { speedupTier: 2 }
        );
        await sendTx(ctx.svm, new Transaction().add(speedupIx), [bravo.keypair], ctx.config);
      }
      log.txSuccess('Bravo: reinforcement speedup ×5 (outbound)');

      // Advance LiteSVM clock past reinforcement travel time
      await advanceTime(ctx.svm, 30);

      // processArrival (travel time reduced by speedups)
      const arrivalIx = createProcessArrivalInstruction({
        reinforcement: reinforcementPda,
        destinationPlayer: alpha.playerPda,
      });
      await sendTx(ctx.svm, new Transaction().add(arrivalIx), [bravo.keypair], ctx.config);
      log.txSuccess('Reinforcement: processArrival');

      // Bravo: recallReinforcement (Alpha is now in Delta's city)
      const recallIx = await createRecallReinforcementInstruction({
        sender: bravo.publicKey,
        gameEngine: ctx.gameEngine,
        destinationOwner: alpha.publicKey,
        senderCityId: bravo.startingCityId,
        destinationCityId: alphaCurrentCity,
      });
      await sendTx(ctx.svm, new Transaction().add(recallIx), [bravo.keypair], ctx.config);
      log.txSuccess('Bravo: recallReinforcement');

      // Speedup return travel (tier 2 = 25% remaining per application)
      for (let i = 0; i < 5; i++) {
        const speedupIx = await createReinforcementSpeedupInstruction(
          {
            sender: bravo.publicKey,
            gameEngine: ctx.gameEngine,
            destinationOwner: alpha.publicKey,
          },
          { speedupTier: 2 }
        );
        await sendTx(ctx.svm, new Transaction().add(speedupIx), [bravo.keypair], ctx.config);
      }
      log.txSuccess('Bravo: reinforcement speedup ×5 (return)');

      // Advance LiteSVM clock past reinforcement return time
      await advanceTime(ctx.svm, 30);

      // processReturn — verify Bravo gets units back
      const beforeReturn = await snapshotPlayer(ctx.svm, bravo.playerPda);
      const [bravoEstate] = await deriveEstatePda(bravo.playerPda);
      const returnIx = createProcessReturnInstruction({
        reinforcement: reinforcementPda,
        senderPlayer: bravo.playerPda,
        senderOwner: bravo.publicKey,
        estateAccount: bravoEstate,
      });
      await sendTx(ctx.svm, new Transaction().add(returnIx), [bravo.keypair], ctx.config);
      log.txSuccess('Reinforcement: processReturn');

      const afterReturn = await snapshotPlayer(ctx.svm, bravo.playerPda);
      if (beforeReturn && afterReturn) {
        const diff = diffPlayerSnapshots(beforeReturn, afterReturn);
        log.info(`Return diff: ${Object.keys(diff.changes).join(', ') || 'none'}`);
      }
    }

    // ══════════════════════════════════════════════════════════
    // Layer 14: Expedition (STRICT start/abort)
    // ══════════════════════════════════════════════════════════
    log.section('Layer 14: Expedition');

    // First do research type 21 (Mining) to unlock has_mining
    {
      const ix21 = await createStartResearchInstruction({
        owner: alpha.publicKey,
        gameEngine: ctx.gameEngine,
        researchType: 21,
      });
      await sendTx(ctx.svm, new Transaction().add(ix21), [alpha.keypair], ctx.config);
      log.txSuccess('Alpha: startResearch (type 21 - Mining)');

      const speed21 = await createSpeedUpResearchInstruction(
        { owner: alpha.publicKey, gameEngine: ctx.gameEngine, researchType: 21 },
        { speedUpSeconds: 0 }
      );
      await sendTx(ctx.svm, new Transaction().add(speed21), [alpha.keypair], ctx.config);

      const complete21 = await createCompleteResearchInstruction({
        payer: alpha.publicKey,
        playerOwner: alpha.publicKey,
        gameEngine: ctx.gameEngine,
        researchType: 21,
      });
      await sendTx(ctx.svm, new Transaction().add(complete21), [alpha.keypair], ctx.config);
      log.txSuccess('Alpha: completeResearch (type 21 - Mining unlocked)');
    }

    // Buy gems for expedition speedup
    await factory.buyGems(alpha, 5);
    log.txSuccess('Alpha: bought gems for expedition speedups');

    // Alpha: startExpedition (Mining, tier 0, 10 OP1) — has operatives from Layer 3
    {
      const before = await snapshotPlayer(ctx.svm, alpha.playerPda);
      const ix = await createExpeditionStartInstruction(
        { owner: alpha.publicKey, gameEngine: ctx.gameEngine },
        {
          expeditionType: 1, // Mining
          tier: 0,
          operativeUnit1: 10,
          operativeUnit2: 0,
          operativeUnit3: 0,
        }
      );
      await sendTx(ctx.svm, new Transaction().add(ix), [alpha.keypair], ctx.config);

      const [expeditionPda] = await deriveExpeditionPda(alpha.publicKey);
      const exists = await accountExists(ctx.svm, expeditionPda);
      expect(exists).toBe(true);

      const after = await snapshotPlayer(ctx.svm, alpha.playerPda);
      if (before && after) {
        const diff = diffPlayerSnapshots(before, after);
        log.info(`Expedition start: OP1 change = ${jstr(diff.changes['operativeUnit1'])}`);
      }
      log.txSuccess('Alpha: startExpedition (Mining)');

      // Strike
      const strikeIx = await createExpeditionStrikeInstruction(
        {
          owner: alpha.publicKey,
          gameEngine: ctx.gameEngine,
          gameAuthority: ctx.daoAuthority.publicKey,
        },
        { score: 75 }
      );
      await sendTx(ctx.svm, new Transaction().add(strikeIx), [alpha.keypair, ctx.daoAuthority], ctx.config);
      log.txSuccess('Alpha: expeditionStrike');

      // Speedup ×5 (each tier 2 reduces 75% of remaining time) + Claim
      for (let i = 0; i < 5; i++) {
        const speedIx = await createExpeditionSpeedupInstruction(
          { owner: alpha.publicKey, gameEngine: ctx.gameEngine },
          { speedupTier: 2 }
        );
        await sendTx(ctx.svm, new Transaction().add(speedIx), [alpha.keypair], ctx.config);
      }
      log.txSuccess('Alpha: expeditionSpeedup ×5');

      // Advance LiteSVM clock past expedition completion time
      await advanceTime(ctx.svm, 10);

      const claimIx = await createExpeditionClaimInstruction({
        owner: alpha.publicKey,
        gameEngine: ctx.gameEngine,
      });
      await sendTx(ctx.svm, new Transaction().add(claimIx), [alpha.keypair], ctx.config);
      log.txSuccess('Alpha: expeditionClaim');
    }

    // Research type 22 (Fishing) to unlock has_fishing, then start+abort
    {
      const ix22 = await createStartResearchInstruction({
        owner: alpha.publicKey,
        gameEngine: ctx.gameEngine,
        researchType: 22,
      });
      await sendTx(ctx.svm, new Transaction().add(ix22), [alpha.keypair], ctx.config);

      const speed22 = await createSpeedUpResearchInstruction(
        { owner: alpha.publicKey, gameEngine: ctx.gameEngine, researchType: 22 },
        { speedUpSeconds: 0 }
      );
      await sendTx(ctx.svm, new Transaction().add(speed22), [alpha.keypair], ctx.config);

      const complete22 = await createCompleteResearchInstruction({
        payer: alpha.publicKey,
        playerOwner: alpha.publicKey,
        gameEngine: ctx.gameEngine,
        researchType: 22,
      });
      await sendTx(ctx.svm, new Transaction().add(complete22), [alpha.keypair], ctx.config);
      log.txSuccess('Alpha: completeResearch (type 22 - Fishing unlocked)');
    }

    // Start fishing expedition then abort
    {
      const before = await snapshotPlayer(ctx.svm, alpha.playerPda);
      const startIx = await createExpeditionStartInstruction(
        { owner: alpha.publicKey, gameEngine: ctx.gameEngine },
        {
          expeditionType: 2, // Fishing
          tier: 0,
          operativeUnit1: 5,
          operativeUnit2: 0,
          operativeUnit3: 0,
        }
      );
      await sendTx(ctx.svm, new Transaction().add(startIx), [alpha.keypair], ctx.config);
      log.txSuccess('Alpha: startExpedition (Fishing)');

      const abortIx = await createExpeditionAbortInstruction({
        owner: alpha.publicKey,
        gameEngine: ctx.gameEngine,
      });
      await sendTx(ctx.svm, new Transaction().add(abortIx), [alpha.keypair], ctx.config);
      log.txSuccess('Alpha: abortExpedition');

      const after = await snapshotPlayer(ctx.svm, alpha.playerPda);
      if (before && after) {
        const diff = diffPlayerSnapshots(before, after);
        log.info(`Expedition abort diff: ${Object.keys(diff.changes).join(', ') || 'none (operatives returned)'}`);
      }
    }

    // ══════════════════════════════════════════════════════════
    // Layer 15: Forge (STRICT — Forge now built)
    // ══════════════════════════════════════════════════════════
    log.section('Layer 15: Forge');

    {
      const initForgeIx = await createInitializeForgeInstruction({
        owner: alpha.publicKey,
        gameEngine: ctx.gameEngine,
      });
      await sendTx(ctx.svm, new Transaction().add(initForgeIx), [alpha.keypair], ctx.config);
      log.txSuccess('Alpha: initializeForge');

      // Buy materials for crafting
      const buyMaterialsIx = await createPurchaseItemInstruction(
        {
          buyer: alpha.publicKey,
          gameEngine: ctx.gameEngine,
          itemId: TEST_MATERIALS_ITEM.itemId,
          treasury: ctx.treasury.publicKey,
        },
        { quantity: 2 }
      );
      await sendTx(ctx.svm, new Transaction().add(buyMaterialsIx), [alpha.keypair], ctx.config);
      log.txSuccess('Alpha: bought materials for forge');

      const startCraftIx = await createStartCraftInstruction(
        { owner: alpha.publicKey, gameEngine: ctx.gameEngine },
        { equipmentType: 0, qualityTier: 1 } // melee, Uncommon
      );
      await sendTx(ctx.svm, new Transaction().add(startCraftIx), [alpha.keypair], ctx.config);
      log.txSuccess('Alpha: startCraft (melee, Uncommon)');

      // Advance LiteSVM clock past 60s forge stage interval
      await advanceTime(ctx.svm, 65);

      const strikeIx = await createStrikeInstruction({
        owner: alpha.publicKey,
        gameEngine: ctx.gameEngine,
      });
      await sendTx(ctx.svm, new Transaction().add(strikeIx), [alpha.keypair], ctx.config);
      log.txSuccess('Alpha: forgeStrike');

      const equipIx = await createEquipInstruction(
        { owner: alpha.publicKey, gameEngine: ctx.gameEngine },
        { equipmentType: 0, qualityTier: 1 }
      );
      await sendTx(ctx.svm, new Transaction().add(equipIx), [alpha.keypair], ctx.config);
      log.txSuccess('Alpha: equipCrafted');
    }

    // ══════════════════════════════════════════════════════════
    // Layer 16: Sanctuary (Sanctuary built, hero locked)
    // claimMeditation may fail if time hasn't passed — keep try/catch on claim only
    // ══════════════════════════════════════════════════════════
    log.section('Layer 16: Sanctuary');

    {
      const ix = await createStartMeditationInstruction(
        {
          owner: alpha.publicKey,
          gameEngine: ctx.gameEngine,
          heroMint: alphaWarrior.mintPubkey,
          heroTemplateId: alphaWarrior.templateId,
        },
        { heroSlot: 0 }
      );
      await sendTx(ctx.svm, new Transaction().add(ix), [alpha.keypair], ctx.config);
      log.txSuccess('Alpha: startMeditation (hero slot 0)');

      // Advance time past meditation duration
      await advanceTime(ctx.svm, 43200); // 12 hours
      log.txSuccess('Alpha: advanced time past meditation');

      // Claim meditation
      const claimIx = await createClaimMeditationInstruction({
        owner: alpha.publicKey,
        gameEngine: ctx.gameEngine,
        heroMint: alphaWarrior.mintPubkey,
        heroTemplateId: alphaWarrior.templateId,
      });
      await sendTx(ctx.svm, new Transaction().add(claimIx), [alpha.keypair], ctx.config);
      log.txSuccess('Alpha: claimMeditation');
    }

    // ══════════════════════════════════════════════════════════
    // Layer 17: Arena (SUCCESS-ONLY)
    // ══════════════════════════════════════════════════════════
    log.section('Layer 17: Arena');

    // Join arena: Bravo, Echo, Alpha, Charlie (need 3+ opponents for 5 battles)
    {
      for (const [player, label] of [
        [bravo, 'Bravo'], [echo, 'Echo'], [alpha, 'Alpha'], [charlie, 'Charlie'],
      ] as [TestPlayer, string][]) {
        const joinIx = await createJoinSeasonInstruction({
          owner: player.publicKey,
          gameEngine: ctx.gameEngine,
          seasonAuthority: ctx.daoAuthority.publicKey,
          seasonId: ARENA_SEASON_ID,
        });
        await sendTx(ctx.svm, new Transaction().add(joinIx), [player.keypair], ctx.config);
        log.txSuccess(`${label}: joinArenaSeason`);

        const loadoutIx = await createUpdateLoadoutInstruction(
          { owner: player.publicKey, gameEngine: ctx.gameEngine },
          {
            arenaHero: PublicKey.default,
            defensiveUnits: [5, 0, 0] as [number, number, number],
            meleeWeapons: 0,
            rangedWeapons: 0,
            siegeWeapons: 0,
            armorPieces: 0,
          }
        );
        await sendTx(ctx.svm, new Transaction().add(loadoutIx), [player.keypair], ctx.config);
        log.txSuccess(`${label}: updateLoadout`);
      }
    }

    {
      // Bravo: 5 challenges (2 vs Echo, 2 vs Alpha, 1 vs Charlie)
      // matchId must be strictly increasing
      const opponents: [TestPlayer, string][] = [
        [echo, 'Echo'], [echo, 'Echo'],
        [alpha, 'Alpha'], [alpha, 'Alpha'],
        [charlie, 'Charlie'],
      ];

      let matchId = await getCurrentTimestamp(ctx.svm);
      for (const [opponent, label] of opponents) {
        matchId += 1;
        const now = await getCurrentTimestamp(ctx.svm);
        const ix = await createChallengePlayerInstruction(
          {
            challenger: bravo.publicKey,
            gameEngine: ctx.gameEngine,
            gameAuthority: ctx.daoAuthority.publicKey,
            seasonAuthority: ctx.daoAuthority.publicKey,
            seasonId: ARENA_SEASON_ID,
            defenderAuthority: opponent.publicKey,
            challengerHero: PublicKey.default,
            challengerEstate: PublicKey.default,
            defenderHero: PublicKey.default,
            defenderEstate: PublicKey.default,
          },
          {
            matchId,
            matchTimestamp: now,
          }
        );
        await sendTx(ctx.svm, new Transaction().add(ix), [bravo.keypair, ctx.daoAuthority], ctx.config);
        log.txSuccess(`Bravo: challengePlayer(${label})`);
      }
    }

    {
      // Bravo: claimArenaDailyReward (5 battles completed)
      const before = await snapshotPlayer(ctx.svm, bravo.playerPda);
      const ix = await createClaimArenaDailyRewardInstruction({
        playerOwner: bravo.publicKey,
        gameEngine: ctx.gameEngine,
        seasonAuthority: ctx.daoAuthority.publicKey,
        seasonId: ARENA_SEASON_ID,
      });
      await sendTx(ctx.svm, new Transaction().add(ix), [bravo.keypair], ctx.config);
      const after = await snapshotPlayer(ctx.svm, bravo.playerPda);
      if (before && after) {
        const diff = diffPlayerSnapshots(before, after);
        const noviChange = diff.changes['lockedNovi'];
        log.info(`Arena daily reward: lockedNovi change = ${jstr(noviChange ?? 'none')}`);
        expect(noviChange).toBeDefined();
      }
      log.txSuccess('Bravo: claimArenaDailyReward');
    }

    // ══════════════════════════════════════════════════════════
    // Layer 18: Dungeon (STRICT)
    // ══════════════════════════════════════════════════════════
    log.section('Layer 18: Dungeon');

    {
      // Echo: has Arena building + echoWarrior + no rally state
      const enterIx = await enterDungeonIx(ctx, echo.publicKey, echoWarrior.mintPubkey, {
        templateId: DUNGEON_TEMPLATE_ID,
        firstRoomType: 0, // Enemy room
        heroSpecialization: 0, // Warrior
      });
      await sendTx(ctx.svm, new Transaction().add(enterIx), [echo.keypair, ctx.daoAuthority], ctx.config);
      log.txSuccess('Echo: enterDungeon');

      const attackIx = await createAttackInstruction(
        { owner: echo.publicKey, gameEngine: ctx.gameEngine, gameAuthority: ctx.daoAuthority.publicKey },
        {
          templateId: DUNGEON_TEMPLATE_ID,
          nextRoomType: 0,
          doubleStrike: false,
          crit: false,
        }
      );
      await sendTx(ctx.svm, new Transaction().add(attackIx), [echo.keypair, ctx.daoAuthority], ctx.config);
      log.txSuccess('Echo: dungeon attackRoom');

      const fleeIx = await createFleeInstruction({
        owner: echo.publicKey,
        gameEngine: ctx.gameEngine,
        heroMint: echoWarrior.mintPubkey,
      });
      await sendTx(ctx.svm, new Transaction().add(fleeIx), [echo.keypair], ctx.config);
      log.txSuccess('Echo: fleeDungeon (hero returned)');
    }

    // ══════════════════════════════════════════════════════════
    // Layer 19: Castle (STRICT)
    // ══════════════════════════════════════════════════════════
    log.section('Layer 19: Castle');

    const [castlePda] = await deriveCastlePda(ctx.gameEngine, CASTLE_CITY_ID, CASTLE_ID);

    {
      // Alpha: claimVacantCastle
      const ix = await createClaimVacantCastleInstruction({
        claimer: alpha.publicKey,
        gameEngine: ctx.gameEngine,
        cityId: CASTLE_CITY_ID,
        castleId: CASTLE_ID,
      });
      await sendTx(ctx.svm, new Transaction().add(ix), [alpha.keypair], ctx.config);
      log.txSuccess('Alpha: claimVacantCastle');

      // Transition castle: CONTEST → PROTECTED.
      // CASTLE_CONTEST_DURATION is 7200s on-chain; advance past it.
      await advanceTime(ctx.svm, 7201);
      const statusIx = await createUpdateCastleStatusInstruction({
        caller: ctx.daoAuthority.publicKey,
        gameEngine: ctx.gameEngine,
        cityId: CASTLE_CITY_ID,
        castleId: CASTLE_ID,
      });
      await sendTx(ctx.svm, new Transaction().add(statusIx), [ctx.daoAuthority], ctx.config);
      log.txSuccess('Castle: CONTEST → PROTECTED');
    }

    {
      // Alpha: appointCourt(Bravo, position=0)
      const ix = await createAppointCourtInstruction(
        {
          king: alpha.publicKey,
          appointee: bravo.publicKey,
          gameEngine: ctx.gameEngine,
          cityId: CASTLE_CITY_ID,
          castleId: CASTLE_ID,
        },
        { position: 0 }
      );
      await sendTx(ctx.svm, new Transaction().add(ix), [alpha.keypair], ctx.config);
      log.txSuccess('Alpha: appointCourt(Bravo, pos 0)');
    }

    {
      // Charlie: joinGarrison(10 DU1) — Charlie has units from Layer 3
      const ix = await createJoinGarrisonInstruction(
        {
          owner: charlie.publicKey,
          gameEngine: ctx.gameEngine,
          cityId: CASTLE_CITY_ID,
          castleId: CASTLE_ID,
        },
        { units: [10, 0, 0] as [number, number, number], weapons: [0, 0, 0] as [number, number, number], heroSlot: 255 }
      );
      await sendTx(ctx.svm, new Transaction().add(ix), [charlie.keypair], ctx.config);
      log.txSuccess('Charlie: joinGarrison(10 DU1)');
    }

    {
      // Alpha: claimCastleRewards
      try {
        const ix = await createClaimCastleRewardsInstruction({
          claimant: alpha.publicKey,
          gameEngine: ctx.gameEngine,
          cityId: CASTLE_CITY_ID,
          castleId: CASTLE_ID,
        });
        await sendTx(ctx.svm, new Transaction().add(ix), [alpha.keypair], ctx.config);
        log.txSuccess('Alpha: claimCastleRewards');
      } catch (e) { log.caught('Alpha: claimCastleRewards', e); }
    }

    // ══════════════════════════════════════════════════════════
    // Layer 20: Events (STRICT)
    // ══════════════════════════════════════════════════════════
    log.section('Layer 20: Events');

    {
      // Alpha: joinEvent
      const ix = await createJoinEventInstruction({
        payer: alpha.publicKey,
        gameEngine: ctx.gameEngine,
        playerOwner: alpha.publicKey,
        eventId: EVENT_ID,
      });
      await sendTx(ctx.svm, new Transaction().add(ix), [alpha.keypair], ctx.config);
      log.txSuccess('Alpha: joinEvent');

      const [participationPda] = await deriveEventParticipationPda(ctx.gameEngine, EVENT_ID, alpha.publicKey);
      const exists = await accountExists(ctx.svm, participationPda);
      log.info(`Event participation exists: ${exists}`);
    }

    // ══════════════════════════════════════════════════════════
    // Layer 21: Token (SUCCESS-ONLY)
    // ══════════════════════════════════════════════════════════
    log.section('Layer 21: Token');

    {
      // Purchase NOVI to create reserved balance
      const [noviMint] = await deriveNoviMintPda();
      const purchaseNoviIx = await createPurchaseNoviInstruction(
        {
          buyer: alpha.publicKey,
          gameEngine: ctx.gameEngine,
          treasury: ctx.treasury.publicKey,
          noviMint,
        },
        { packageIndex: 0, maxLamports: BigInt(1_000_000_000) }
      );
      await sendTx(ctx.svm, new Transaction().add(purchaseNoviIx), [alpha.keypair], ctx.config);
      log.txSuccess('Alpha: purchaseNovi');

      // reservedToLocked conversion
      const ix = await createReservedToLockedInstruction(
        { owner: alpha.publicKey, gameEngine: ctx.gameEngine },
        { amount: 100 }
      );
      await sendTx(ctx.svm, new Transaction().add(ix), [alpha.keypair], ctx.config);
      log.txSuccess('Alpha: reservedToLocked');
    }

    // ══════════════════════════════════════════════════════════
    // Final Summary
    // ══════════════════════════════════════════════════════════
    log.section('Lifecycle Test Complete');
    log.info('All 21 layers executed across 24 game systems');
    log.info('6 players: Alpha, Bravo, Charlie, Delta, Echo, Foxtrot');

  }, 300_000); // 5 minute timeout
});
