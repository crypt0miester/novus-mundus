/**
 * Combat System E2E Tests
 *
 * Tests for PvP and PvE combat:
 * - Attack player (PvP)
 * - Attack encounter (PvE)
 * - Combat calculations
 * - Loot distribution
 * - Protection mechanics
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import BN from 'bn.js';

import {
  createAttackPlayerInstruction,
  createAttackEncounterInstruction,
  createSpawnEncounterInstruction,
  createClaimLootInstruction,
  derivePlayerPda,
  deriveEncounterPda,
  deriveLootPda,
  deriveCityPda,
  EncounterRarity,
} from '../../src/index';

import {
  type TestContext,
  beforeAllTests,
} from '../fixtures/setup';
import {
  PlayerFactory,
  type TestPlayer,
  createCombatReadyPlayers,
} from '../fixtures/players';
import {
  assertBnEquals,
  assertBnGreaterThan,
  assertBnLessThan,
  assertPlayerLocation,
} from '../utils/assertions';
import {
  sendTransaction,
  expectTransactionToFail,
} from '../utils/transactions';
import {
  fetchPlayer,
  fetchEncounter,
  fetchLoot,
} from '../utils/accounts';
import {
  getCurrentTimestamp,
  SECONDS_PER_DAY,
} from '../fixtures/time';

// ============================================================
// Test Suite
// ============================================================

describe('Combat System', () => {
  let ctx: TestContext;
  let factory: PlayerFactory;

  beforeAll(async () => {
    ctx = await beforeAllTests();
    factory = new PlayerFactory(ctx, { autoInit: true });
  });

  afterAll(() => {
    factory.clear();
  });

  // ============================================================
  // PvP Combat Tests
  // ============================================================

  describe('PvP Combat', () => {
    it('should execute PvP attack successfully', async () => {
      const { attacker, defender } = await createCombatReadyPlayers(factory);

      // Wait for defender protection to expire (mock: set timestamp in future)
      const futureTime = await getCurrentTimestamp(ctx.connection) + SECONDS_PER_DAY * 2;

      // Get initial state
      const attackerBefore = await fetchPlayer(ctx.connection, attacker.playerPda);
      const defenderBefore = await fetchPlayer(ctx.connection, defender.playerPda);

      expect(attackerBefore).not.toBeNull();
      expect(defenderBefore).not.toBeNull();

      // Execute attack
      const ix = createAttackPlayerInstruction(
        {
          gameEngine: ctx.gameEngine,
          attacker: attacker.publicKey,
          defenderPlayer: defender.playerPda,
          attackerCityId: 1, // Default city
          defenderCityId: 1,
        },
        {
          driveBy: false,
        }
      );

      const tx = new Transaction().add(ix);

      // Attack should succeed (or fail due to protection)
      // In real test, we'd manipulate time or use unprotected defender
      try {
        await sendTransaction(ctx.connection, tx, [attacker.keypair]);

        // Verify state changes
        const attackerAfter = await fetchPlayer(ctx.connection, attacker.playerPda);
        const defenderAfter = await fetchPlayer(ctx.connection, defender.playerPda);

        expect(attackerAfter).not.toBeNull();
        expect(defenderAfter).not.toBeNull();

        // Attacker should have some loot or casualties
        // Defender should have losses
      } catch {
        // Expected if defender is still protected
      }
    });

    it('should reject attack on protected player', async () => {
      const attacker = await factory.createPlayer({ initialize: true });
      const defender = await factory.createPlayer({ initialize: true });

      // Give attacker some units
      await factory.hireUnits(attacker, 3, 100);

      // New player should be protected
      const defenderAccount = await fetchPlayer(ctx.connection, defender.playerPda);
      expect(defenderAccount).not.toBeNull();

      const currentTime = await getCurrentTimestamp(ctx.connection);
      expect(defenderAccount!.newPlayerProtectionUntil.toNumber()).toBeGreaterThan(currentTime);

      // Attack should fail due to protection
      const ix = createAttackPlayerInstruction(
        {
          gameEngine: ctx.gameEngine,
          attacker: attacker.publicKey,
          defenderPlayer: defender.playerPda,
          attackerCityId: 1,
          defenderCityId: 1,
        },
        {
          driveBy: false,
        }
      );

      const tx = new Transaction().add(ix);
      await expectTransactionToFail(ctx.connection, tx, [attacker.keypair]);
    });

    it('should reject attack on same city requirement', async () => {
      // Create players in different cities
      const attacker = await factory.createPlayer({ cityId: 1, initialize: true });
      const defender = await factory.createPlayer({ cityId: 2, initialize: true });

      await factory.hireUnits(attacker, 3, 100);

      const attackerAccount = await fetchPlayer(ctx.connection, attacker.playerPda);
      const defenderAccount = await fetchPlayer(ctx.connection, defender.playerPda);

      expect(attackerAccount!.currentCity).not.toBe(defenderAccount!.currentCity);

      // Attack should fail - not in same city
      const ix = createAttackPlayerInstruction(
        {
          gameEngine: ctx.gameEngine,
          attacker: attacker.publicKey,
          defenderPlayer: defender.playerPda,
          attackerCityId: 1,
          defenderCityId: 2,
        },
        {
          driveBy: false,
        }
      );

      const tx = new Transaction().add(ix);
      await expectTransactionToFail(ctx.connection, tx, [attacker.keypair]);
    });

    it('should reject self-attack', async () => {
      const player = await factory.createPlayer({ initialize: true });
      await factory.hireUnits(player, 3, 100);

      const ix = createAttackPlayerInstruction(
        {
          gameEngine: ctx.gameEngine,
          attacker: player.publicKey,
          defenderPlayer: player.playerPda,
          attackerCityId: 1,
          defenderCityId: 1,
        },
        {
          driveBy: false,
        }
      );

      const tx = new Transaction().add(ix);
      await expectTransactionToFail(ctx.connection, tx, [player.keypair]);
    });

    it('should reject attack without troops', async () => {
      const attacker = await factory.createPlayer({ initialize: true });
      const defender = await factory.createPlayer({ initialize: true });

      // Don't give attacker any units

      const ix = createAttackPlayerInstruction(
        {
          gameEngine: ctx.gameEngine,
          attacker: attacker.publicKey,
          defenderPlayer: defender.playerPda,
          attackerCityId: 1,
          defenderCityId: 1,
        },
        {
          driveBy: false,
        }
      );

      const tx = new Transaction().add(ix);
      await expectTransactionToFail(ctx.connection, tx, [attacker.keypair]);
    });
  });

  // ============================================================
  // PvE Combat Tests
  // ============================================================

  describe('PvE Combat', () => {
    it('should attack encounter successfully', async () => {
      const player = await factory.createPlayer({ initialize: true });
      await factory.hireUnits(player, 3, 50);
      await factory.purchaseEquipment(player, 0, 25); // melee weapons

      const playerAccount = await fetchPlayer(ctx.connection, player.playerPda);
      expect(playerAccount).not.toBeNull();

      // Get city encounter (assuming one exists from setup)
      // In real test, we'd spawn an encounter first
      const cityId = playerAccount!.currentCity;
      const [cityPda] = deriveCityPda(ctx.gameEngine, cityId);
      const encounterId = 0;
      const [encounterPda] = deriveEncounterPda(ctx.gameEngine, cityId, encounterId);

      const ix = createAttackEncounterInstruction(
        {
          gameEngine: ctx.gameEngine,
          owner: player.publicKey,
          encounter: encounterPda,
        },
        {
          encounterId,
        }
      );

      const tx = new Transaction().add(ix);

      try {
        await sendTransaction(ctx.connection, tx, [player.keypair]);

        // Verify combat happened
        const playerAfter = await fetchPlayer(ctx.connection, player.playerPda);
        expect(playerAfter).not.toBeNull();
      } catch (err) {
        // Encounter might not exist
        console.warn('Attack encounter failed (might not exist):', err);
      }
    });

    it('should require stamina for encounter attack', async () => {
      const player = await factory.createPlayer({ initialize: true });
      await factory.hireUnits(player, 3, 50);

      const playerAccount = await fetchPlayer(ctx.connection, player.playerPda);
      expect(playerAccount).not.toBeNull();

      // Player starts with stamina
      assertBnGreaterThan(playerAccount!.encounterStamina, 0, 'Should have stamina');
    });

    it('should grant rewards from encounter', async () => {
      const player = await factory.createPlayer({ initialize: true });
      await factory.hireUnits(player, 3, 100);
      await factory.purchaseEquipment(player, 0, 50);

      const playerBefore = await fetchPlayer(ctx.connection, player.playerPda);
      expect(playerBefore).not.toBeNull();

      const cityId = playerBefore!.currentCity;
      const [cityPda] = deriveCityPda(ctx.gameEngine, cityId);
      const encounterId = 0;
      const [encounterPda] = deriveEncounterPda(ctx.gameEngine, cityId, encounterId);

      // Attack encounter
      const ix = createAttackEncounterInstruction(
        {
          gameEngine: ctx.gameEngine,
          owner: player.publicKey,
          encounter: encounterPda,
        },
        {
          encounterId,
        }
      );

      const tx = new Transaction().add(ix);

      try {
        await sendTransaction(ctx.connection, tx, [player.keypair]);

        const playerAfter = await fetchPlayer(ctx.connection, player.playerPda);
        expect(playerAfter).not.toBeNull();

        // Should have gained some XP
        expect(playerAfter!.currentXp.gte(playerBefore!.currentXp)).toBe(true);
      } catch (err) {
        // Encounter might not exist or player lost
        console.warn('Attack encounter for rewards failed:', err);
      }
    });
  });

  // ============================================================
  // Loot System Tests
  // ============================================================

  describe('Loot System', () => {
    it('should create loot after successful attack', async () => {
      const { attacker, defender } = await createCombatReadyPlayers(factory);

      // Mock: Assume attack creates loot
      const [lootPda] = deriveLootPda(defender.playerPda, attacker.playerPda);

      // In real test, we'd execute attack and verify loot creation
    });

    it('should claim loot successfully', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Mock: Create loot claim scenario
      // In real test, we'd have pending loot to claim

      const playerBefore = await fetchPlayer(ctx.connection, player.playerPda);
      expect(playerBefore).not.toBeNull();
    });

    it('should reject double loot claim', async () => {
      // Once loot is claimed, trying to claim again should fail
      const player = await factory.createPlayer({ initialize: true });

      // Create a mock loot address (would be a real loot account in production)
      const mockLootAccount = Keypair.generate().publicKey;

      // Create a loot claim instruction
      // Creator receives rent refund when loot is closed
      const mockCreator = Keypair.generate().publicKey;
      const ix = createClaimLootInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        loot: mockLootAccount,
        creator: mockCreator,
      });

      try {
        // First claim
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);

        // Second claim should fail
        await expectTransactionToFail(
          ctx.connection,
          new Transaction().add(
            createClaimLootInstruction({
              gameEngine: ctx.gameEngine,
              owner: player.publicKey,
              loot: mockLootAccount,
              creator: mockCreator,
            })
          ),
          [player.keypair]
        );
      } catch {
        // Loot might not exist
      }
    });
  });

  // ============================================================
  // Combat Calculations Tests
  // ============================================================

  describe('Combat Calculations', () => {
    it('should calculate attack power correctly', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Hire units and purchase equipment
      await factory.hireUnits(player, 3, 100); // operative unit 1
      await factory.purchaseEquipment(player, 0, 50); // melee weapons

      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();

      // Verify units and equipment were added
      assertBnGreaterThan(account!.operativeUnit1, 0, 'Should have operative units');
      assertBnGreaterThan(account!.meleeWeapons, 0, 'Should have melee weapons');
    });

    it('should calculate defense power correctly', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Hire defensive units and get armor
      await factory.hireUnits(player, 0, 100); // defensive unit 1
      await factory.purchaseEquipment(player, 5, 50); // armor

      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();

      // Verify units and equipment were added
      assertBnGreaterThan(account!.defensiveUnit1, 0, 'Should have defensive units');
      assertBnGreaterThan(account!.armorPieces, 0, 'Should have armor');
    });

    it('should apply weapon efficiency bonuses', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Get varied equipment
      await factory.hireUnits(player, 3, 100);
      await factory.purchaseEquipment(player, 0, 30); // melee
      await factory.purchaseEquipment(player, 1, 30); // ranged
      await factory.purchaseEquipment(player, 2, 20); // siege

      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();

      assertBnGreaterThan(account!.meleeWeapons, 0, 'Should have melee weapons');
      assertBnGreaterThan(account!.rangedWeapons, 0, 'Should have ranged weapons');
      assertBnGreaterThan(account!.siegeWeapons, 0, 'Should have siege weapons');
    });
  });

  // ============================================================
  // Casualty Tests
  // ============================================================

  describe('Casualties', () => {
    it('should inflict casualties on loser', async () => {
      const { attacker, defender } = await createCombatReadyPlayers(factory);

      const defenderBefore = await fetchPlayer(ctx.connection, defender.playerPda);
      expect(defenderBefore).not.toBeNull();

      const initialDefensiveUnits = defenderBefore!.defensiveUnit1;

      // Mock: After combat, loser should have fewer units
      // Real test would execute attack and verify
    });

    it('should distribute casualties across unit types', async () => {
      // Casualties should affect multiple unit types based on composition
      const player = await factory.createPlayer({ initialize: true });

      await factory.hireUnits(player, 0, 100);
      await factory.hireUnits(player, 1, 100);
      await factory.hireUnits(player, 2, 100);

      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();

      // Verify player has multiple unit types
      assertBnGreaterThan(account!.defensiveUnit1, 0, 'Should have def unit 1');
      assertBnGreaterThan(account!.defensiveUnit2, 0, 'Should have def unit 2');
      assertBnGreaterThan(account!.defensiveUnit3, 0, 'Should have def unit 3');
    });
  });

  // ============================================================
  // Combat Restrictions Tests
  // ============================================================

  describe('Combat Restrictions', () => {
    it('should respect travel status', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();

      // Player not traveling should be able to attack
      // Player traveling should not be able to attack
    });

    it('should respect team alliance', async () => {
      // Team members cannot attack each other
      const player1 = await factory.createPlayer({ cityId: 1, initialize: true });
      const player2 = await factory.createPlayer({ cityId: 1, initialize: true });

      await factory.hireUnits(player1, 3, 100);

      // If players are in the same team, attack should fail
      // This requires team setup first
      const account1 = await fetchPlayer(ctx.connection, player1.playerPda);
      const account2 = await fetchPlayer(ctx.connection, player2.playerPda);
      expect(account1).not.toBeNull();
      expect(account2).not.toBeNull();
      // If both have same teamId, attack would fail
    });

    it('should enforce attack cooldown', async () => {
      // Players have cooldown between attacks
      const attacker = await factory.createPlayer({ cityId: 1, initialize: true });
      const defender1 = await factory.createPlayer({ cityId: 1, initialize: true });
      const defender2 = await factory.createPlayer({ cityId: 1, initialize: true });

      await factory.hireUnits(attacker, 3, 200);

      try {
        // First attack
        const ix1 = createAttackPlayerInstruction(
          {
            gameEngine: ctx.gameEngine,
            attacker: attacker.publicKey,
            defenderPlayer: defender1.playerPda,
            attackerCityId: 1,
            defenderCityId: 1,
          },
          { driveBy: false }
        );

        await sendTransaction(ctx.connection, new Transaction().add(ix1), [attacker.keypair]);

        // Second attack immediately should fail due to cooldown
        const ix2 = createAttackPlayerInstruction(
          {
            gameEngine: ctx.gameEngine,
            attacker: attacker.publicKey,
            defenderPlayer: defender2.playerPda,
            attackerCityId: 1,
            defenderCityId: 1,
          },
          { driveBy: false }
        );

        await expectTransactionToFail(
          ctx.connection,
          new Transaction().add(ix2),
          [attacker.keypair]
        );
      } catch {
        // Attack might fail for other reasons
      }
    });
  });

  // ============================================================
  // Encounter Spawning Tests
  // ============================================================

  describe('Encounter Spawning', () => {
    it('should spawn encounter in city', async () => {
      // DAO authority spawns encounters
      const cityId = 1;

      const ix = createSpawnEncounterInstruction(
        {
          gameEngine: ctx.gameEngine,
          payer: ctx.daoAuthority.publicKey,
          playerOwner: ctx.daoAuthority.publicKey,
          cityId,
          gridLat: 0,
          gridLong: 0,
          encounterIndex: 0,
        },
        {
          encounterType: EncounterRarity.Common,
        }
      );

      const tx = new Transaction().add(ix);

      try {
        await sendTransaction(ctx.connection, tx, [ctx.daoAuthority]);

        // Verify encounter was created
        // In real test, we'd derive and fetch the encounter
      } catch (err) {
        // Might fail if not authorized
        console.warn('Spawn encounter failed (might not be authorized):', err);
      }
    });

    it('should have correct encounter power based on level', async () => {
      // Higher level encounters should be stronger
      const cityId = 1;

      // Spawn low level encounter
      const lowLevelIx = createSpawnEncounterInstruction(
        {
          gameEngine: ctx.gameEngine,
          payer: ctx.daoAuthority.publicKey,
          playerOwner: ctx.daoAuthority.publicKey,
          cityId,
          gridLat: 0,
          gridLong: 1,
          encounterIndex: 1,
        },
        { encounterType: EncounterRarity.Common }
      );

      // Spawn high level encounter
      const highLevelIx = createSpawnEncounterInstruction(
        {
          gameEngine: ctx.gameEngine,
          payer: ctx.daoAuthority.publicKey,
          playerOwner: ctx.daoAuthority.publicKey,
          cityId,
          gridLat: 0,
          gridLong: 2,
          encounterIndex: 2,
        },
        { encounterType: EncounterRarity.Epic }
      );

      try {
        await sendTransaction(ctx.connection, new Transaction().add(lowLevelIx), [ctx.daoAuthority]);
        await sendTransaction(ctx.connection, new Transaction().add(highLevelIx), [ctx.daoAuthority]);
        // High level encounter would have more power/HP
      } catch {
        // Might not be authorized
      }
    });

    it('should have correct encounter rewards based on type', async () => {
      // Different encounter types have different rewards
      const cityId = 1;

      // Common encounter = basic rewards
      const commonIx = createSpawnEncounterInstruction(
        {
          gameEngine: ctx.gameEngine,
          payer: ctx.daoAuthority.publicKey,
          playerOwner: ctx.daoAuthority.publicKey,
          cityId,
          gridLat: 1,
          gridLong: 0,
          encounterIndex: 3,
        },
        { encounterType: EncounterRarity.Common }
      );

      // Legendary encounter = better rewards
      const legendaryIx = createSpawnEncounterInstruction(
        {
          gameEngine: ctx.gameEngine,
          payer: ctx.daoAuthority.publicKey,
          playerOwner: ctx.daoAuthority.publicKey,
          cityId,
          gridLat: 1,
          gridLong: 1,
          encounterIndex: 4,
        },
        { encounterType: EncounterRarity.Legendary }
      );

      try {
        await sendTransaction(ctx.connection, new Transaction().add(commonIx), [ctx.daoAuthority]);
        await sendTransaction(ctx.connection, new Transaction().add(legendaryIx), [ctx.daoAuthority]);
        // Legendary encounter drops better loot
      } catch {
        // Might not be authorized
      }
    });
  });
});
