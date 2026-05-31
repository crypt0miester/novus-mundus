/**
 * 00 - Initialization Tests
 *
 * Tests for GameEngine initialization and DAO config upgrades.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Keypair, Transaction } from '@solana/web3.js';

import {
  createUpdateGameConfigInstruction,
  deriveGameEnginePda,
  type ArenaConfig,
  type CombatConfig,
  type CastleConfig,
  type ExpeditionConfig,
  type DungeonConfig,
} from '../../src/index';
import { type TestContext, beforeAllTests, afterAllTests } from '../fixtures/setup';
import { sendTransaction, expectTransactionToFail, buildTransaction } from '../utils/transactions';
import { fetchGameEngine } from '../utils/accounts';
import { svmKey } from '../fixtures/svm';

describe('Initialization', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await beforeAllTests();
  });

  afterAll(async () => {
    await afterAllTests();
  });

  // GameEngine Init Verification

  describe('GameEngine defaults', () => {
    it('should have initialized GameEngine with default configs', async () => {
      const engine = await fetchGameEngine(ctx.svm, ctx.kingdomId);
      expect(engine).not.toBeNull();
      expect(Number(engine!.version)).toBeGreaterThanOrEqual(0);
      expect(engine!.paused).toBe(false);
    });

    it('should have default ArenaConfig values', async () => {
      const engine = await fetchGameEngine(ctx.svm, ctx.kingdomId);
      expect(engine).not.toBeNull();

      const arena = engine!.arenaConfig;
      expect(Number(arena.seasonDuration)).toBe(7 * 86400);     // 7 days
      expect(Number(arena.claimDeadline)).toBe(30 * 86400);     // 30 days
      expect(Number(arena.matchExpirySeconds)).toBe(300);       // 5 min
      expect(arena.maxDailyBattles).toBe(10);
      expect(arena.maxBattlesPerOpponent).toBe(2);
      expect(arena.minBattlesForDailyReward).toBe(5);
      expect(arena.startingElo).toBe(1000);
      expect(arena.eloKFactor).toBe(32);
      expect(Number(arena.meleeWeaponPower)).toBe(10);
      expect(Number(arena.rangedWeaponPower)).toBe(16);
      expect(Number(arena.siegeWeaponPower)).toBe(26);
      expect(Number(arena.armorPower)).toBe(5);
      expect(Number(arena.baseWinPoints)).toBe(100);
      expect(Number(arena.baseLossPoints)).toBe(20);
      expect(Number(arena.drawPoints)).toBe(50);
      expect(arena.prizeDistribution).toEqual([3500, 2500, 1500, 750, 750, 200, 200, 200, 200, 200]);
    });

    it('should have default ExpeditionConfig values', async () => {
      const engine = await fetchGameEngine(ctx.svm, ctx.kingdomId);
      const exp = engine!.expeditionConfig;
      expect(exp.maxTier).toBe(4);
      expect(exp.perfectScoreThreshold).toBe(80);
      expect(exp.miningDurationHours).toEqual([1, 2, 4, 8, 16]);
      expect(exp.fishingDurationHours).toEqual([1, 2, 4, 8, 16]);
      expect(Number(exp.rareFindMultiplier)).toBe(5);
      expect(Number(exp.operativeTier1MultiplierBps)).toBe(10000);
      expect(Number(exp.operativeTier2MultiplierBps)).toBe(15000);
      expect(Number(exp.operativeTier3MultiplierBps)).toBe(20000);
    });

    it('should have default DungeonConfig values', async () => {
      const engine = await fetchGameEngine(ctx.svm, ctx.kingdomId);
      const dg = engine!.dungeonConfig;
      expect(Number(dg.resumeGemCost)).toBe(500);
      expect(dg.maxMultiAttacks).toBe(5);
      expect(dg.restHealPercent).toBe(20);
      expect(dg.trapDamagePercent).toBe(10);
      expect(dg.fleePenaltyBps).toEqual([7000, 6000, 5000, 4000]);
      expect(dg.unitPower.map(b => Number(b))).toEqual([15, 35, 80]);
      expect(dg.unitHealth.map(b => Number(b))).toEqual([100, 250, 600]);
    });

    it('should have default CastleConfig values', async () => {
      const engine = await fetchGameEngine(ctx.svm, ctx.kingdomId);
      const castle = engine!.castleConfig;
      expect(Number(castle.contestDuration)).toBe(0);           // testing mode
      expect(Number(castle.protectionDuration)).toBe(864_000);  // 10 days
      expect(castle.attackRangeMeters).toBe(50.0);
      expect(castle.maxCastlesPerKing).toBe(5);
      expect(castle.kingLootCutBps).toBe(1500);
      expect(castle.garrisonCapByTier).toEqual([5, 10, 15, 25]);
      expect(castle.tierMultiplierBps).toEqual([2500, 5000, 10000, 15000, 20000]);
    });

    it('should have default CombatConfig values', async () => {
      const engine = await fetchGameEngine(ctx.svm, ctx.kingdomId);
      const combat = engine!.combatConfig;
      expect(Number(combat.damagePerSiegeWeapon)).toBe(500);
      expect(Number(combat.maxReinforcementReceive)).toBe(10_000);
      expect(Number(combat.defensiveUnit1Power)).toBe(10);
      expect(Number(combat.defensiveUnit2Power)).toBe(25);
      expect(Number(combat.defensiveUnit3Power)).toBe(60);
      expect(Number(combat.staminaRegenInterval)).toBe(300);
      expect(combat.encounterAttackRangeMeters).toBe(16.0);
      expect(combat.pvpAttackRangeMeters).toBe(15.0);
      expect(combat.baseEncountersPerCity).toBe(25);
      expect(combat.maxEncountersPerCity).toBe(200);
      expect(combat.weaponLootRateBps).toBe(6000);
    });
  });

  // Update Game Config

  describe('update_game_config', () => {
    it('should update ArenaConfig via DAO authority', async () => {
      const engineBefore = await fetchGameEngine(ctx.svm, ctx.kingdomId);
      const versionBefore = Number(engineBefore!.version);

      // Modify arena config: change max daily battles and ELO K-factor
      const updatedArena: ArenaConfig = {
        ...engineBefore!.arenaConfig,
        maxDailyBattles: 20,              // was 10
        eloKFactor: 48,                   // was 32
        dailyBaseReward: 2000n,    // was 1000
      };

      const ix = createUpdateGameConfigInstruction(
        {
          authority: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
        },
        { arenaConfig: updatedArena }
      );

      const tx = buildTransaction([ix]);
      await sendTransaction(ctx.svm, tx, [ctx.daoAuthority]);

      const engineAfter = await fetchGameEngine(ctx.svm, ctx.kingdomId);
      expect(engineAfter).not.toBeNull();

      // Version incremented
      expect(Number(engineAfter!.version)).toBe(versionBefore + 1);

      // Changed values
      expect(engineAfter!.arenaConfig.maxDailyBattles).toBe(20);
      expect(engineAfter!.arenaConfig.eloKFactor).toBe(48);
      expect(Number(engineAfter!.arenaConfig.dailyBaseReward)).toBe(2000);

      // Unchanged values preserved
      expect(engineAfter!.arenaConfig.startingElo).toBe(1000);
      expect(engineAfter!.arenaConfig.prizeDistribution).toEqual([3500, 2500, 1500, 750, 750, 200, 200, 200, 200, 200]);
    });

    it('should update CombatConfig via DAO authority', async () => {
      const engineBefore = await fetchGameEngine(ctx.svm, ctx.kingdomId);

      const updatedCombat: CombatConfig = {
        ...engineBefore!.combatConfig,
        maxEncountersPerCity: 100,         // was 50
        weaponLootRateBps: 7500,          // was 6000
        damagePerSiegeWeapon: 750n, // was 500
      };

      const ix = createUpdateGameConfigInstruction(
        {
          authority: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
        },
        { combatConfig: updatedCombat }
      );

      const tx = buildTransaction([ix]);
      await sendTransaction(ctx.svm, tx, [ctx.daoAuthority]);

      const engineAfter = await fetchGameEngine(ctx.svm, ctx.kingdomId);
      expect(engineAfter!.combatConfig.maxEncountersPerCity).toBe(100);
      expect(engineAfter!.combatConfig.weaponLootRateBps).toBe(7500);
      expect(Number(engineAfter!.combatConfig.damagePerSiegeWeapon)).toBe(750);

      // Other combat values unchanged
      expect(Number(engineAfter!.combatConfig.maxReinforcementReceive)).toBe(10_000);
      expect(Number(engineAfter!.combatConfig.staminaRegenInterval)).toBe(300);
    });

    it('should update multiple configs in single transaction', async () => {
      const engineBefore = await fetchGameEngine(ctx.svm, ctx.kingdomId);
      const versionBefore = Number(engineBefore!.version);

      const updatedCastle: CastleConfig = {
        ...engineBefore!.castleConfig,
        maxCastlesPerKing: 3,             // was 5
        contestDuration: 7200n,    // was 0, now 2 hours
      };

      const updatedExpedition: ExpeditionConfig = {
        ...engineBefore!.expeditionConfig,
        maxTier: 3,                       // was 4
        perfectScoreThreshold: 90,        // was 80
      };

      const ix = createUpdateGameConfigInstruction(
        {
          authority: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
        },
        {
          expeditionConfig: updatedExpedition,
          castleConfig: updatedCastle,
        }
      );

      const tx = buildTransaction([ix]);
      await sendTransaction(ctx.svm, tx, [ctx.daoAuthority]);

      const engineAfter = await fetchGameEngine(ctx.svm, ctx.kingdomId);
      // Version incremented once (single instruction)
      expect(Number(engineAfter!.version)).toBe(versionBefore + 1);

      // Castle changes applied
      expect(engineAfter!.castleConfig.maxCastlesPerKing).toBe(3);
      expect(Number(engineAfter!.castleConfig.contestDuration)).toBe(7200);
      // Castle unchanged values preserved
      expect(Number(engineAfter!.castleConfig.protectionDuration)).toBe(864_000);

      // Expedition changes applied
      expect(engineAfter!.expeditionConfig.maxTier).toBe(3);
      expect(engineAfter!.expeditionConfig.perfectScoreThreshold).toBe(90);
      // Expedition unchanged values preserved
      expect(engineAfter!.expeditionConfig.miningDurationHours).toEqual([1, 2, 4, 8, 16]);
    });

    it('should update DungeonConfig via DAO authority', async () => {
      const engineBefore = await fetchGameEngine(ctx.svm, ctx.kingdomId);

      const updatedDungeon: DungeonConfig = {
        ...engineBefore!.dungeonConfig,
        resumeGemCost: 1000n,      // was 500
        maxMultiAttacks: 10,              // was 5
        restHealPercent: 30,              // was 20
      };

      const ix = createUpdateGameConfigInstruction(
        {
          authority: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
        },
        { dungeonConfig: updatedDungeon }
      );

      const tx = buildTransaction([ix]);
      await sendTransaction(ctx.svm, tx, [ctx.daoAuthority]);

      const engineAfter = await fetchGameEngine(ctx.svm, ctx.kingdomId);
      expect(Number(engineAfter!.dungeonConfig.resumeGemCost)).toBe(1000);
      expect(engineAfter!.dungeonConfig.maxMultiAttacks).toBe(10);
      expect(engineAfter!.dungeonConfig.restHealPercent).toBe(30);

      // Unchanged values preserved
      expect(engineAfter!.dungeonConfig.trapDamagePercent).toBe(10);
      expect(engineAfter!.dungeonConfig.fleePenaltyBps).toEqual([7000, 6000, 5000, 4000]);
    });

    it('should reject update from non-authority signer', async () => {
      const impostor = await Keypair.generate();

      // Fund impostor for tx fees
      ctx.svm.airdrop(svmKey(impostor.publicKey), BigInt(1_000_000_000));

      const engine = await fetchGameEngine(ctx.svm, ctx.kingdomId);
      const arenaConfig: ArenaConfig = {
        ...engine!.arenaConfig,
        maxDailyBattles: 99,
      };

      const ix = createUpdateGameConfigInstruction(
        {
          authority: impostor.publicKey,
          gameEngine: ctx.gameEngine,
        },
        { arenaConfig }
      );

      const tx = buildTransaction([ix]);
      // Error 6001 = Unauthorized
      await expectTransactionToFail(ctx.svm, tx, [impostor], 6001, 'unauthorized update');
    });
  });
});
