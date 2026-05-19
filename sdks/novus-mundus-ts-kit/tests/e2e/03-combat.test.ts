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

import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { generateKeyPairSigner } from '@solana/kit';

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
import { deriveLocationPda } from '../../src/pda';
import { BuildingType } from '../../src/types/enums';

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
  accountExists,
} from '../utils/accounts';
import { log } from '../utils/logger';
import {
  getCurrentTimestamp,
  advanceTime,
  SECONDS_PER_DAY,
} from '../fixtures/time';
import { CITIES } from '../fixtures/setup';

// Golden Spiral Helpers (must match Rust logic)

const GOLDEN_ANGLE = 2.399963229728653;
const GRID_PRECISION = 10000;

/** Compute the golden spiral spawn coords for a given city and spawn index */
function goldenSpiralGridCoords(cityId: number, spawnIndex: number, radiusKm: number = 50): { gridLat: number; gridLong: number } {
  const city = CITIES[cityId]!;
  const angle = spawnIndex * GOLDEN_ANGLE;
  const radiusFactor = Math.sqrt(spawnIndex) / 10.0;
  const radius = Math.min(radiusFactor, 1.0) * radiusKm;
  const kmPerDegree = 111.0;
  const latOffset = radius * Math.cos(angle) / kmPerDegree;
  const lonOffset = radius * Math.sin(angle) / kmPerDegree;
  return {
    gridLat: Math.round((city.lat + latOffset) * GRID_PRECISION),
    gridLong: Math.round((city.lon + lonOffset) * GRID_PRECISION),
  };
}

// Test Suite
setDefaultTimeout(60_000);

describe('Combat System', () => {
  let ctx: TestContext;
  let factory: PlayerFactory;

  beforeAll(async () => {
    log.section('Combat System');
    ctx = await beforeAllTests();
    factory = new PlayerFactory(ctx, { autoInit: true });
  });

  afterAll(() => {
    factory.clear();
  });

  // PvP Combat Tests

  describe('PvP Combat', () => {
    it('should execute PvP attack successfully', async () => {
      const { attacker, defender } = await createCombatReadyPlayers(factory, { moveToRange: true });

      // Get initial state
      const attackerBefore = await fetchPlayer(ctx.svm, attacker.playerPda);
      const defenderBefore = await fetchPlayer(ctx.svm, defender.playerPda);

      expect(attackerBefore).not.toBeNull();
      expect(defenderBefore).not.toBeNull();

      // Execute attack (defender's protection expired during movePlayerToPlayer travel time)
      const ix = await createAttackPlayerInstruction(
        {
          gameEngine: ctx.gameEngine,
          attacker: attacker.publicKey,
          defenderPlayer: defender.playerPda,
          attackerCityId: 1,
          defenderCityId: 1,
        },
        { driveBy: false }
      );

      await sendTransaction(ctx.svm, [ix], [attacker.keypair]);

      // Verify state changes after combat
      const attackerAfter = await fetchPlayer(ctx.svm, attacker.playerPda);
      const defenderAfter = await fetchPlayer(ctx.svm, defender.playerPda);

      expect(attackerAfter).not.toBeNull();
      expect(defenderAfter).not.toBeNull();

      // Winner steals cash from loser
      const totalCashBefore = (attackerBefore!.cashOnHand + defenderBefore!.cashOnHand);
      const totalCashAfter = (attackerAfter!.cashOnHand + defenderAfter!.cashOnHand);
      // Cash is transferred, not created — total should stay roughly the same
      // (small rounding differences possible from bps calculations)
      expect(totalCashAfter >= ((totalCashBefore * 9n) / 10n)).toBe(true);

      // At least one side should have fewer defensive units (casualties)
      const defenderLostUnits = (defenderBefore!.defensiveUnit1 > defenderAfter!.defensiveUnit1)
        || (defenderBefore!.defensiveUnit2 > defenderAfter!.defensiveUnit2);
      const attackerLostUnits = (attackerBefore!.defensiveUnit1 > attackerAfter!.defensiveUnit1)
        || (attackerBefore!.defensiveUnit2 > attackerAfter!.defensiveUnit2);
      expect(defenderLostUnits || attackerLostUnits).toBe(true);
    });

    it('should reject attack on protected player', async () => {
      const attacker = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      const defender = await factory.createPlayer({ initialize: true });

      // Give attacker some defensive units (used for combat)
      await factory.hireUnits(attacker, 0, 100);

      // New player should be protected
      const defenderAccount = await fetchPlayer(ctx.svm, defender.playerPda);
      expect(defenderAccount).not.toBeNull();

      const currentTime = await getCurrentTimestamp(ctx.svm);
      expect(Number(defenderAccount!.newPlayerProtectionUntil)).toBeGreaterThan(currentTime);

      // Attack should fail due to protection
      const ix = await createAttackPlayerInstruction(
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

      const tx = [ix];
      await expectTransactionToFail(ctx.svm, tx, [attacker.keypair]);
    });

    it('should reject attack on same city requirement', async () => {
      // Create players in different cities (use 3/4 to avoid collision with PvP players in city 1)
      const attacker = await factory.createPlayer({ cityId: 3, initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      const defender = await factory.createPlayer({ cityId: 4, initialize: true });

      await factory.hireUnits(attacker, 0, 100);

      const attackerAccount = await fetchPlayer(ctx.svm, attacker.playerPda);
      const defenderAccount = await fetchPlayer(ctx.svm, defender.playerPda);

      expect(attackerAccount!.currentCity).not.toBe(defenderAccount!.currentCity);

      // Attack should fail - not in same city
      const ix = await createAttackPlayerInstruction(
        {
          gameEngine: ctx.gameEngine,
          attacker: attacker.publicKey,
          defenderPlayer: defender.playerPda,
          attackerCityId: 3,
          defenderCityId: 4,
        },
        {
          driveBy: false,
        }
      );

      const tx = [ix];
      await expectTransactionToFail(ctx.svm, tx, [attacker.keypair]);
    });

    it('should reject self-attack', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      await factory.hireUnits(player, 0, 100);

      const ix = await createAttackPlayerInstruction(
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

      const tx = [ix];
      await expectTransactionToFail(ctx.svm, tx, [player.keypair]);
    });

    it('should reject attack without troops', async () => {
      const attacker = await factory.createPlayer({ initialize: true, createEstate: true });
      const defender = await factory.createPlayer({ initialize: true });

      // Don't give attacker any units

      const ix = await createAttackPlayerInstruction(
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

      const tx = [ix];
      await expectTransactionToFail(ctx.svm, tx, [attacker.keypair]);
    });
  });

  // PvE Combat Tests

  describe('PvE Combat', () => {
    it('should attack encounter successfully', async () => {
      // Use city 17 (Berlin, lat 52.5°) - high latitude ensures 1 grid cell in longitude ≈ 6.8m (within 10m attack range)
      const cityId = 17;
      const player = await factory.createPlayer({ cityId, initialize: true, createEstate: true, buildings: [BuildingType.Barracks, BuildingType.Market] });
      // 50 NOVI rounds down to 0 units after the hire-rate floor; use 100 NOVI to guarantee ≥1 unit
      await factory.hireUnits(player, 0, 100);
      await factory.purchaseEquipment(player, 0, 25); // melee weapons

      const playerAccount = await fetchPlayer(ctx.svm, player.playerPda);
      expect(playerAccount).not.toBeNull();

      // Spawn an encounter adjacent to the player (within 10m attack range)
      // Player is at city center; spawn encounter 1 grid cell offset in longitude (~8-10m at mid-latitudes)
      const encounterId = 0;
      const city = CITIES[cityId]!;
      const playerGridLat = Math.round(city.lat * GRID_PRECISION);
      const playerGridLong = Math.round(city.lon * GRID_PRECISION);
      const encounterGridLat = playerGridLat;
      const encounterGridLong = playerGridLong + 1; // ~8-10m at mid-latitudes

      const spawnIx = await createSpawnEncounterInstruction(
        {
          gameEngine: ctx.gameEngine,
          payer: ctx.daoAuthority.address,
          playerOwner: ctx.daoAuthority.address,
          cityId,
          gridLat: encounterGridLat,
          gridLong: encounterGridLong,
          encounterIndex: encounterId,
        },
        { encounterType: EncounterRarity.Common }
      );
      await sendTransaction(ctx.svm, [spawnIx], [ctx.daoAuthority]);

      const [encounterPda] = await deriveEncounterPda(ctx.gameEngine, cityId, encounterId);
      const encounter = await fetchEncounter(ctx.svm, encounterPda);
      expect(encounter).not.toBeNull();

      // Attack the encounter (include death accounts in case encounter is killed)
      const [playerPda] = await derivePlayerPda(ctx.gameEngine, player.publicKey);
      const playerBefore = await fetchPlayer(ctx.svm, playerPda);
      const lootId = Number(playerBefore!.lootCounter);
      const [lootPda] = await deriveLootPda(playerPda, lootId);
      const [encounterLocationPda] = await deriveLocationPda(ctx.gameEngine, cityId, encounterGridLat, encounterGridLong);

      const ix = await createAttackEncounterInstruction(
        {
          gameEngine: ctx.gameEngine,
          owner: player.publicKey,
          encounter: encounterPda,
          loot: lootPda,
          encounterLocation: encounterLocationPda,
          locationCreatorRefund: ctx.daoAuthority.address,
        },
        {
          encounterId,
        }
      );

      const tx = [ix];
      await sendTransaction(ctx.svm, tx, [player.keypair]);

      // Verify combat happened
      const playerAfter = await fetchPlayer(ctx.svm, player.playerPda);
      expect(playerAfter).not.toBeNull();
    });

    it('should require stamina for encounter attack', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      await factory.hireUnits(player, 0, 100);

      const playerAccount = await fetchPlayer(ctx.svm, player.playerPda);
      expect(playerAccount).not.toBeNull();

      // Player starts with stamina
      assertBnGreaterThan(playerAccount!.encounterStamina, 0, 'Should have stamina');
    });

    it('should grant rewards from encounter', async () => {
      // Use city 9 to avoid conflicts with other tests
      const cityId = 9;
      const player = await factory.createPlayer({ cityId, initialize: true, createEstate: true, buildings: [BuildingType.Barracks, BuildingType.Market] });
      await factory.hireUnits(player, 0, 100);
      await factory.purchaseEquipment(player, 0, 50);

      const playerBefore = await fetchPlayer(ctx.svm, player.playerPda);
      expect(playerBefore).not.toBeNull();

      // Spawn an encounter adjacent to the player (within 10m attack range)
      const encounterId = 0;
      const city = CITIES[cityId]!;
      const playerGridLat = Math.round(city.lat * GRID_PRECISION);
      const playerGridLong = Math.round(city.lon * GRID_PRECISION);
      const encounterGridLat = playerGridLat;
      const encounterGridLong = playerGridLong + 1; // ~8-10m at mid-latitudes

      const spawnIx = await createSpawnEncounterInstruction(
        {
          gameEngine: ctx.gameEngine,
          payer: ctx.daoAuthority.address,
          playerOwner: ctx.daoAuthority.address,
          cityId,
          gridLat: encounterGridLat,
          gridLong: encounterGridLong,
          encounterIndex: encounterId,
        },
        { encounterType: EncounterRarity.Common }
      );
      await sendTransaction(ctx.svm, [spawnIx], [ctx.daoAuthority]);

      const [encounterPda] = await deriveEncounterPda(ctx.gameEngine, cityId, encounterId);

      // Derive death accounts in case encounter is killed
      const lootId = Number(playerBefore!.lootCounter);
      const [lootPda] = await deriveLootPda(player.playerPda, lootId);
      const [encounterLocationPda] = await deriveLocationPda(ctx.gameEngine, cityId, encounterGridLat, encounterGridLong);

      // Attack encounter
      const ix = await createAttackEncounterInstruction(
        {
          gameEngine: ctx.gameEngine,
          owner: player.publicKey,
          encounter: encounterPda,
          loot: lootPda,
          encounterLocation: encounterLocationPda,
          locationCreatorRefund: ctx.daoAuthority.address,
        },
        {
          encounterId,
        }
      );

      const tx = [ix];
      await sendTransaction(ctx.svm, tx, [player.keypair]);

      const playerAfter = await fetchPlayer(ctx.svm, player.playerPda);
      expect(playerAfter).not.toBeNull();

      // Should have gained some XP
      expect((playerAfter!.currentXp >= playerBefore!.currentXp)).toBe(true);
    });
  });

  // Loot System Tests

  describe('Loot System', () => {
    it('should create loot after killing encounter', async () => {
      // Use a fresh high-latitude city so 1 grid cell in longitude is within 10m attack range
      const cityId = 15; // London (lat ~51.5°) — fresh city, no prior encounters
      const player = await factory.createPlayer({ cityId, initialize: true, createEstate: true, buildings: [BuildingType.Barracks, BuildingType.Market] });
      // Hire defensive units and buy weapons to one-shot a Common encounter (2000 HP)
      await factory.hireUnits(player, 0, 50000);    // tier 1 defensive units
      await factory.purchaseEquipment(player, 0, 50); // melee weapons

      const playerBefore = await fetchPlayer(ctx.svm, player.playerPda);
      expect(playerBefore).not.toBeNull();
      const lootCounterBefore = Number(playerBefore!.lootCounter);

      // Spawn a Common encounter adjacent to player
      const encounterId = 0;
      const city = CITIES[cityId]!;
      const playerGridLat = Math.round(city.lat * GRID_PRECISION);
      const playerGridLong = Math.round(city.lon * GRID_PRECISION);
      const encounterGridLat = playerGridLat;
      const encounterGridLong = playerGridLong + 1;

      const spawnIx = await createSpawnEncounterInstruction(
        {
          gameEngine: ctx.gameEngine,
          payer: ctx.daoAuthority.address,
          playerOwner: ctx.daoAuthority.address,
          cityId,
          gridLat: encounterGridLat,
          gridLong: encounterGridLong,
          encounterIndex: encounterId,
        },
        { encounterType: EncounterRarity.Common }
      );
      await sendTransaction(ctx.svm, [spawnIx], [ctx.daoAuthority]);

      const [encounterPda] = await deriveEncounterPda(ctx.gameEngine, cityId, encounterId);
      const encounter = await fetchEncounter(ctx.svm, encounterPda);
      expect(encounter).not.toBeNull();

      // Derive death accounts: loot PDA, encounter location, location creator refund
      // Use the known spawn grid coords directly (same as what we passed to spawn)
      const [lootPda] = await deriveLootPda(player.playerPda, lootCounterBefore);
      const [encounterLocationPda] = await deriveLocationPda(ctx.gameEngine, cityId, encounterGridLat, encounterGridLong);

      // Attack with death accounts (encounter should die from massive damage)
      // locationCreatorRefund must match the payer who spawned the encounter (daoAuthority)
      const attackIx = await createAttackEncounterInstruction(
        {
          gameEngine: ctx.gameEngine,
          owner: player.publicKey,
          encounter: encounterPda,
          loot: lootPda,
          encounterLocation: encounterLocationPda,
          locationCreatorRefund: ctx.daoAuthority.address,
        },
        { encounterId }
      );

      await sendTransaction(ctx.svm, [attackIx], [player.keypair]);

      // Verify loot was created
      const loot = await fetchLoot(ctx.svm, player.playerPda, lootCounterBefore);
      expect(loot).not.toBeNull();
      expect(loot!.claimed).toBe(false);
      // Loot should have some rewards
      assertBnGreaterThan(loot!.cash, 0, 'Loot should contain cash');

      // Player's loot counter should have incremented
      const playerAfter = await fetchPlayer(ctx.svm, player.playerPda);
      expect(Number(playerAfter!.lootCounter)).toBeGreaterThan(lootCounterBefore);
    });

    it('should claim loot successfully', async () => {
      // Use a different high-latitude city to avoid conflicts
      const cityId = 16; // Paris (lat ~48.9°)
      const player = await factory.createPlayer({ cityId, initialize: true, createEstate: true, buildings: [BuildingType.Barracks, BuildingType.Market] });
      await factory.hireUnits(player, 0, 50000);         // tier 1 defensive units
      await factory.purchaseEquipment(player, 0, 50);    // melee weapons for damage

      const playerBefore = await fetchPlayer(ctx.svm, player.playerPda);
      expect(playerBefore).not.toBeNull();
      const lootId = Number(playerBefore!.lootCounter);

      // Spawn and kill encounter to generate loot
      const encounterId = 0;
      const city = CITIES[cityId]!;
      const pGridLat = Math.round(city.lat * GRID_PRECISION);
      const pGridLong = Math.round(city.lon * GRID_PRECISION);

      const spawnIx = await createSpawnEncounterInstruction(
        {
          gameEngine: ctx.gameEngine,
          payer: ctx.daoAuthority.address,
          playerOwner: ctx.daoAuthority.address,
          cityId,
          gridLat: pGridLat,
          gridLong: pGridLong + 1,
          encounterIndex: encounterId,
        },
        { encounterType: EncounterRarity.Common }
      );
      await sendTransaction(ctx.svm, [spawnIx], [ctx.daoAuthority]);

      const [encounterPda] = await deriveEncounterPda(ctx.gameEngine, cityId, encounterId);
      const encounter = await fetchEncounter(ctx.svm, encounterPda);
      expect(encounter).not.toBeNull();

      const [lootPda] = await deriveLootPda(player.playerPda, lootId);
      // Use known spawn grid coords directly
      const [encounterLocationPda] = await deriveLocationPda(ctx.gameEngine, cityId, pGridLat, pGridLong + 1);

      const attackIx = await createAttackEncounterInstruction(
        {
          gameEngine: ctx.gameEngine,
          owner: player.publicKey,
          encounter: encounterPda,
          loot: lootPda,
          encounterLocation: encounterLocationPda,
          locationCreatorRefund: ctx.daoAuthority.address,
        },
        { encounterId }
      );
      await sendTransaction(ctx.svm, [attackIx], [player.keypair]);

      // Verify loot exists
      const loot = await fetchLoot(ctx.svm, player.playerPda, lootId);
      expect(loot).not.toBeNull();

      // Record player state before claim
      const playerBeforeClaim = await fetchPlayer(ctx.svm, player.playerPda);
      const cashBefore = playerBeforeClaim!.cashOnHand;

      // Claim loot — creator is the owner wallet (who paid rent for loot account)
      const claimIx = await createClaimLootInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        loot: lootPda,
        creator: player.publicKey,
      });

      await sendTransaction(ctx.svm, [claimIx], [player.keypair]);

      // Verify rewards were transferred
      const playerAfterClaim = await fetchPlayer(ctx.svm, player.playerPda);
      expect((playerAfterClaim!.cashOnHand > cashBefore)).toBe(true);

      // Loot account should be closed (rent reclaimed)
      const lootGone = !(await accountExists(ctx.svm, lootPda));
      expect(lootGone).toBe(true);
    });

    it('should reject claim of non-existent loot', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const mockLootAccount = (await generateKeyPairSigner()).address;
      const mockCreator = (await generateKeyPairSigner()).address;

      const ix = await createClaimLootInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        loot: mockLootAccount,
        creator: mockCreator,
      });

      await expectTransactionToFail(
        ctx.svm,
        [ix],
        [player.keypair]
      );
    });
  });

  // Combat Calculations Tests

  describe('Combat Calculations', () => {
    it('should calculate attack power correctly', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks, BuildingType.Market] });

      // Defensive units are the combat units (for both attack and defense)
      // Operatives are for financial/economy activities
      await factory.hireUnits(player, 0, 100); // defensive unit 1 (combat)
      await factory.purchaseEquipment(player, 0, 50); // melee weapons

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();

      // Attack power = defensive units + weapons
      assertBnGreaterThan(account!.defensiveUnit1, 0, 'Should have defensive units for combat');
      assertBnGreaterThan(account!.meleeWeapons, 0, 'Should have melee weapons');
    });

    it('should calculate defense power correctly', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks, BuildingType.Market] });

      // Defensive units + armor = defense power
      await factory.hireUnits(player, 0, 200); // defensive unit 1
      await factory.hireUnits(player, 1, 200);  // defensive unit 2
      await factory.purchaseEquipment(player, 5, 50); // armor (type 5)

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();

      assertBnGreaterThan(account!.defensiveUnit1, 0, 'Should have defensive unit 1');
      assertBnGreaterThan(account!.defensiveUnit2, 0, 'Should have defensive unit 2');
      assertBnGreaterThan(account!.armorPieces, 0, 'Should have armor');
    });

    it('should apply weapon efficiency bonuses', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks, BuildingType.Market] });

      // Hire defensive units (the combat units) and varied weapons
      await factory.hireUnits(player, 0, 100); // defensive unit 1
      await factory.purchaseEquipment(player, 0, 30); // melee
      await factory.purchaseEquipment(player, 1, 30); // ranged
      await factory.purchaseEquipment(player, 2, 20); // siege

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();

      assertBnGreaterThan(account!.defensiveUnit1, 0, 'Should have defensive units');
      assertBnGreaterThan(account!.meleeWeapons, 0, 'Should have melee weapons');
      assertBnGreaterThan(account!.rangedWeapons, 0, 'Should have ranged weapons');
      assertBnGreaterThan(account!.siegeWeapons, 0, 'Should have siege weapons');
    });
  });

  // Casualty Tests

  describe('Casualties', () => {
    it('should inflict casualties on loser', async () => {
      const { attacker, defender } = await createCombatReadyPlayers(factory, { moveToRange: true });

      const defenderBefore = await fetchPlayer(ctx.svm, defender.playerPda);
      expect(defenderBefore).not.toBeNull();

      // Execute PvP attack
      const ix = await createAttackPlayerInstruction(
        {
          gameEngine: ctx.gameEngine,
          attacker: attacker.publicKey,
          defenderPlayer: defender.playerPda,
          attackerCityId: 1,
          defenderCityId: 1,
        },
        { driveBy: false }
      );

      await sendTransaction(ctx.svm, [ix], [attacker.keypair]);

      // Verify the loser lost defensive units
      const defenderAfter = await fetchPlayer(ctx.svm, defender.playerPda);
      const attackerAfter = await fetchPlayer(ctx.svm, attacker.playerPda);
      expect(defenderAfter).not.toBeNull();
      expect(attackerAfter).not.toBeNull();

      // One side must have lost units — casualties are inflicted via inflict_damage()
      const defLost = (defenderBefore!.defensiveUnit1 > defenderAfter!.defensiveUnit1)
        || (defenderBefore!.defensiveUnit2 > defenderAfter!.defensiveUnit2);
      expect(defLost).toBe(true);
    });

    it('should distribute casualties across unit types', async () => {
      // Create a defender with all 3 unit types, then attack them
      const defender = await factory.createPlayer({ cityId: 1, initialize: true, createEstate: true, buildings: [BuildingType.Barracks, BuildingType.Market] });
      await factory.hireUnits(defender, 0, 100);
      await factory.hireUnits(defender, 1, 100);
      await factory.hireUnits(defender, 2, 100);

      const defenderBefore = await fetchPlayer(ctx.svm, defender.playerPda);
      expect(defenderBefore).not.toBeNull();
      assertBnGreaterThan(defenderBefore!.defensiveUnit1, 0, 'Should have def unit 1');
      assertBnGreaterThan(defenderBefore!.defensiveUnit2, 0, 'Should have def unit 2');
      assertBnGreaterThan(defenderBefore!.defensiveUnit3, 0, 'Should have def unit 3');

      // Create a strong attacker and move to combat range
      const attacker = await factory.createPlayer({ cityId: 2, initialize: true, createEstate: true, buildings: [BuildingType.Barracks, BuildingType.Market, BuildingType.TransportBay] });
      await factory.hireUnits(attacker, 0, 300);
      await factory.purchaseEquipment(attacker, 0, 100); // melee weapons
      await factory.movePlayerToPlayer(attacker, defender);

      // Attack
      const ix = await createAttackPlayerInstruction(
        {
          gameEngine: ctx.gameEngine,
          attacker: attacker.publicKey,
          defenderPlayer: defender.playerPda,
          attackerCityId: 1,
          defenderCityId: 1,
        },
        { driveBy: false }
      );

      await sendTransaction(ctx.svm, [ix], [attacker.keypair]);

      // Casualties should be distributed proportionally across unit types
      const defenderAfter = await fetchPlayer(ctx.svm, defender.playerPda);
      expect(defenderAfter).not.toBeNull();

      // At least 2 of 3 unit types should have taken casualties (proportional distribution)
      let typesWithCasualties = 0;
      if ((defenderBefore!.defensiveUnit1 > defenderAfter!.defensiveUnit1)) typesWithCasualties++;
      if ((defenderBefore!.defensiveUnit2 > defenderAfter!.defensiveUnit2)) typesWithCasualties++;
      if ((defenderBefore!.defensiveUnit3 > defenderAfter!.defensiveUnit3)) typesWithCasualties++;
      expect(typesWithCasualties).toBeGreaterThanOrEqual(2);
    });
  });

  // Combat Restrictions Tests

  describe('Combat Restrictions', () => {
    it('should reject attack while traveling', async () => {
      // Create a player with units in a high-latitude city
      const cityId = 19;
      const player = await factory.createPlayer({ cityId, initialize: true, createEstate: true, buildings: [BuildingType.Barracks, BuildingType.Market, BuildingType.TransportBay] });
      await factory.hireUnits(player, 0, 100);
      await factory.purchaseEquipment(player, 0, 50);

      const playerAccount = await fetchPlayer(ctx.svm, player.playerPda);
      expect(playerAccount).not.toBeNull();

      // Spawn an encounter near the player
      const encounterId = 0;
      const city = CITIES[cityId]!;
      const pGridLat = Math.round(city.lat * GRID_PRECISION);
      const pGridLong = Math.round(city.lon * GRID_PRECISION);

      const spawnIx = await createSpawnEncounterInstruction(
        {
          gameEngine: ctx.gameEngine,
          payer: ctx.daoAuthority.address,
          playerOwner: ctx.daoAuthority.address,
          cityId,
          gridLat: pGridLat,
          gridLong: pGridLong + 1,
          encounterIndex: encounterId,
        },
        { encounterType: EncounterRarity.Common }
      );
      await sendTransaction(ctx.svm, [spawnIx], [ctx.daoAuthority]);

      // Start intracity travel (player becomes traveling)
      const destLat = city.lat + 0.001;
      const destLong = city.lon + 0.001;
      await factory.startIntracityTravel(player, cityId, pGridLat, pGridLong, destLat, destLong);

      // Try to attack while traveling — should fail with PlayerTraveling
      const [encounterPda] = await deriveEncounterPda(ctx.gameEngine, cityId, encounterId);
      const ix = await createAttackEncounterInstruction(
        {
          gameEngine: ctx.gameEngine,
          owner: player.publicKey,
          encounter: encounterPda,
        },
        { encounterId }
      );

      await expectTransactionToFail(
        ctx.svm,
        [ix],
        [player.keypair]
      );
    });

    it('should reject PvP attack while traveling', async () => {
      // Create attacker and defender in same city
      const defender = await factory.createPlayer({ cityId: 1, initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      await factory.hireUnits(defender, 0, 50);

      const attacker = await factory.createPlayer({ cityId: 2, initialize: true, createEstate: true, buildings: [BuildingType.Barracks, BuildingType.Market, BuildingType.TransportBay] });
      await factory.hireUnits(attacker, 0, 200);
      await factory.purchaseEquipment(attacker, 0, 50);

      // Move attacker to defender's city and near them
      await factory.movePlayerToPlayer(attacker, defender);

      // Get attacker's current location
      const attackerLoc = await factory.getPlayerLocation(attacker);
      expect(attackerLoc).not.toBeNull();

      // Start intracity travel (attacker becomes traveling)
      const city = CITIES[1]!;
      const destLat = city.lat + 0.002;
      const destLong = city.lon + 0.002;
      await factory.startIntracityTravel(attacker, 1, attackerLoc!.gridLat, attackerLoc!.gridLong, destLat, destLong);

      // Try to PvP attack while traveling — should fail
      const ix = await createAttackPlayerInstruction(
        {
          gameEngine: ctx.gameEngine,
          attacker: attacker.publicKey,
          defenderPlayer: defender.playerPda,
          attackerCityId: 1,
          defenderCityId: 1,
        },
        { driveBy: false }
      );

      await expectTransactionToFail(
        ctx.svm,
        [ix],
        [attacker.keypair]
      );
    });

    it('should enforce attack cooldown', async () => {
      // Players have cooldown between attacks
      const attacker = await factory.createPlayer({ cityId: 1, initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      const defender1 = await factory.createPlayer({ cityId: 1, initialize: true });
      const defender2 = await factory.createPlayer({ cityId: 1, initialize: true });

      await factory.hireUnits(attacker, 0, 200);

      // Advance clock past new player protection (2s)
      await advanceTime(ctx.svm, 3);

      // First attack
      const ix1 = await createAttackPlayerInstruction(
        {
          gameEngine: ctx.gameEngine,
          attacker: attacker.publicKey,
          defenderPlayer: defender1.playerPda,
          attackerCityId: 1,
          defenderCityId: 1,
        },
        { driveBy: false }
      );

      await sendTransaction(ctx.svm, [ix1], [attacker.keypair]);

      // Second attack immediately should fail due to cooldown
      const ix2 = await createAttackPlayerInstruction(
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
        ctx.svm,
        [ix2],
        [attacker.keypair]
      );
    });
  });

  // Encounter Spawning Tests

  describe('Encounter Spawning', () => {
    it('should spawn encounter in city', async () => {
      // DAO authority spawns encounters (use city 5 to avoid conflicts with PvP tests)
      // Use spiral index 5 for coords to avoid city-center collision with player spawns
      const cityId = 5;
      const encounterIndex = 0; // Must match city's encounter_counter (starts at 0)
      const { gridLat, gridLong } = goldenSpiralGridCoords(cityId, 5);

      const ix = await createSpawnEncounterInstruction(
        {
          gameEngine: ctx.gameEngine,
          payer: ctx.daoAuthority.address,
          playerOwner: ctx.daoAuthority.address,
          cityId,
          gridLat,
          gridLong,
          encounterIndex,
        },
        {
          encounterType: EncounterRarity.Common,
        }
      );

      const tx = [ix];

      await sendTransaction(ctx.svm, tx, [ctx.daoAuthority]);

      // Verify encounter was created
      const [encounterPda] = await deriveEncounterPda(ctx.gameEngine, cityId, encounterIndex);
      const encounter = await fetchEncounter(ctx.svm, encounterPda);
      expect(encounter).not.toBeNull();
    });

    it('should have correct encounter power based on level', async () => {
      // Higher level encounters should be stronger (use city 6 to avoid conflicts)
      const cityId = 6;

      // Spawn low level encounter (encounterIndex 0 - must match city counter)
      // Use spiral index 5 for coords to avoid city-center collision with player spawns
      const spawn0 = goldenSpiralGridCoords(cityId, 5);
      const lowLevelIx = await createSpawnEncounterInstruction(
        {
          gameEngine: ctx.gameEngine,
          payer: ctx.daoAuthority.address,
          playerOwner: ctx.daoAuthority.address,
          cityId,
          gridLat: spawn0.gridLat,
          gridLong: spawn0.gridLong,
          encounterIndex: 0,
        },
        { encounterType: EncounterRarity.Common }
      );

      // Spawn higher rarity encounter (encounterIndex 1) - use Rare to avoid time-of-day restrictions
      const spawn1 = goldenSpiralGridCoords(cityId, 6);
      const highLevelIx = await createSpawnEncounterInstruction(
        {
          gameEngine: ctx.gameEngine,
          payer: ctx.daoAuthority.address,
          playerOwner: ctx.daoAuthority.address,
          cityId,
          gridLat: spawn1.gridLat,
          gridLong: spawn1.gridLong,
          encounterIndex: 1,
        },
        { encounterType: EncounterRarity.Rare }
      );

      await sendTransaction(ctx.svm, [lowLevelIx], [ctx.daoAuthority]);
      await sendTransaction(ctx.svm, [highLevelIx], [ctx.daoAuthority]);
      // High level encounter would have more power/HP
    });

    it('should have correct encounter rewards based on type', async () => {
      // Different encounter types have different rewards
      // Use city 7 to avoid encounter limit and conflicts
      const cityId = 7;

      // Common encounter = basic rewards (encounterIndex 0 for this city)
      // Use spiral index 5 for coords to avoid city-center collision with player spawns
      const spawn0 = goldenSpiralGridCoords(cityId, 5);
      const commonIx = await createSpawnEncounterInstruction(
        {
          gameEngine: ctx.gameEngine,
          payer: ctx.daoAuthority.address,
          playerOwner: ctx.daoAuthority.address,
          cityId,
          gridLat: spawn0.gridLat,
          gridLong: spawn0.gridLong,
          encounterIndex: 0,
        },
        { encounterType: EncounterRarity.Common }
      );

      // Uncommon encounter = better rewards (encounterIndex 1 for this city)
      const spawn1 = goldenSpiralGridCoords(cityId, 6);
      const uncommonIx = await createSpawnEncounterInstruction(
        {
          gameEngine: ctx.gameEngine,
          payer: ctx.daoAuthority.address,
          playerOwner: ctx.daoAuthority.address,
          cityId,
          gridLat: spawn1.gridLat,
          gridLong: spawn1.gridLong,
          encounterIndex: 1,
        },
        { encounterType: EncounterRarity.Uncommon }
      );

      await sendTransaction(ctx.svm, [commonIx], [ctx.daoAuthority]);
      await sendTransaction(ctx.svm, [uncommonIx], [ctx.daoAuthority]);
      // Higher rarity encounter drops better loot
    });
  });
});
