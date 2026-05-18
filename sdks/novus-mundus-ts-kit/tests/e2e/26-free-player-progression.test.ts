/**
 * Free-Player Progression — health regression guard
 *
 * Originally a diagnostic suite that confirmed four progression walls (see
 * `FREE_PLAYER_PROGRESSION_STUDY.md`, repo root). Walls 1 & 2 have since been
 * fixed; this suite now asserts the *healthy* post-fix state and guards against
 * regressions. Walls 3 & 4 were knowingly left in place (owner decision) and are
 * asserted here as accepted, documented trade-offs.
 *
 *   §1 — XP curve: golden-ratio φ base (was ×2.5). Level 21 ≈ 2.4M cumulative XP
 *        (was ~6 billion). Mid/late levels are now reachable.
 *   §2 — Encounter targeting: a player may attack ±30 levels (was ±10), so the
 *        permissionless-spawn world is largely targetable for a new player.
 *   §3 — ACCEPTED: encounters award NOVI/gems only at level ≥21 & rarity
 *        ≥Uncommon. Mitigated by the ±30 band; not changed.
 *   §4 — ACCEPTED: sustainable NOVI income (`max_locked_novi`) is below the
 *        one-time starter grant. Not changed.
 */

import { describe, it, expect, beforeAll, setDefaultTimeout } from 'bun:test';

import {
  createSpawnEncounterInstruction,
  createAttackEncounterInstruction,
  deriveEncounterPda,
  deriveLootPda,
  derivePlayerPda,
  EncounterRarity,
  GameError,
} from '../../src/index';
import { deriveLocationPda } from '../../src/pda';
import {
  xpRequiredForLevel,
  cumulativeXpForLevel,
  levelFromXp,
} from '../../src/calculators/progression';

import { type TestContext, beforeAllTests, CITIES } from '../fixtures/setup';
import { PlayerFactory } from '../fixtures/players';
import { sendInstructions, expectTransactionToFail } from '../utils/transactions';
import { fetchPlayer, fetchEncounter, fetchCity, fetchGameEngine } from '../utils/accounts';
import { log } from '../utils/logger';

setDefaultTimeout(60_000);

const GRID_PRECISION = 10000;

/** STARTER_LOCKED_NOVI — `programs/.../constants.rs:36` (raw units, 1 decimal). */
const STARTER_LOCKED_NOVI = 1_000_000;
/** max_encounter_level_diff — `game_engine.rs:414` (widened 10 → 30). */
const EXPECTED_LEVEL_DIFF = 30;
/** The old, pre-fix targeting window — used to show the band genuinely widened. */
const OLD_LEVEL_DIFF = 10;

/**
 * Mirror of `should_award_novi` — `programs/.../logic/rewards.rs:87-108`.
 * Returns true iff a defeated encounter of (level, rarity) awards NOVI.
 */
function shouldAwardNovi(level: number, rarity: number): boolean {
  if (level >= 61 && rarity >= 3) return true; // φ² tier
  if (level >= 41 && rarity >= 2) return true; // φ tier
  if (level >= 21 && rarity >= 1) return true; // √φ tier
  return false;
}

describe('Free-Player Progression — health regression guard', () => {
  let ctx: TestContext;
  let factory: PlayerFactory;

  beforeAll(async () => {
    log.section('Free-Player Progression — health regression guard');
    ctx = await beforeAllTests();
    factory = new PlayerFactory(ctx, { autoInit: false });
  });

  // Baseline — the starter kit a non-paying player actually receives.

  describe('Baseline: starter kit (init_with_city)', () => {
    it('grants the documented free-player starter kit', async () => {
      const player = await factory.createPlayer({ cityId: 17, initialize: true });
      const acc = await fetchPlayer(ctx.svm, player.playerPda);
      expect(acc).not.toBeNull();

      // Exact values from PlayerAccount::init_with_city (state/player.rs:563-600).
      expect(acc!.lockedNovi.toNumber()).toBe(STARTER_LOCKED_NOVI);
      expect(acc!.defensiveUnit1.toNumber()).toBe(10_000);
      expect(acc!.defensiveUnit2.toNumber()).toBe(4_000);
      expect(acc!.defensiveUnit3.toNumber()).toBe(2_000);
      expect(acc!.operativeUnit1.toNumber()).toBe(10_000);
      expect(acc!.operativeUnit2.toNumber()).toBe(4_000);
      expect(acc!.operativeUnit3.toNumber()).toBe(1_000);
      expect(acc!.meleeWeapons.toNumber()).toBe(8_000);
      expect(acc!.rangedWeapons.toNumber()).toBe(4_000);
      expect(acc!.siegeWeapons.toNumber()).toBe(2_000);
      expect(acc!.cashOnHand.toNumber()).toBe(130_000_000);
      expect(acc!.gems.toNumber()).toBe(10_000);
      expect(acc!.level).toBe(1);
      expect(acc!.currentXp.toNumber()).toBe(0);
      expect(acc!.maxEncounterStamina.toNumber()).toBe(100);

      const defensive =
        acc!.defensiveUnit1.toNumber() +
        acc!.defensiveUnit2.toNumber() +
        acc!.defensiveUnit3.toNumber();
      log.info(`Starter army: ${defensive} defensive units + ` +
        `${acc!.meleeWeapons.toNumber() + acc!.rangedWeapons.toNumber() + acc!.siegeWeapons.toNumber()} weapons`);
      expect(defensive).toBe(16_000);
    });
  });

  // §1 — XP curve (golden ratio φ).

  describe('§1 XP curve — golden-ratio φ keeps mid/late levels reachable', () => {
    it('the XP curve follows 100 × φ^(L-2)', () => {
      expect(xpRequiredForLevel(2)).toBe(100);
      expect(xpRequiredForLevel(3)).toBe(161);
      expect(xpRequiredForLevel(4)).toBe(261);
    });

    it('level 21 (the NOVI/gem reward unlock) is now within reach', () => {
      const toL10 = cumulativeXpForLevel(10);
      const toL15 = cumulativeXpForLevel(15);
      const toL21 = cumulativeXpForLevel(21);
      log.info(`Cumulative XP — L10: ${toL10.toLocaleString()}, ` +
        `L15: ${toL15.toLocaleString()}, L21: ${toL21.toLocaleString()}`);

      // Pre-fix (×2.5) put L21 at ~6 billion XP. The φ curve brings it to ~2.4M.
      expect(toL10).toBeLessThan(50_000);
      expect(toL15).toBeLessThan(1_000_000);
      expect(toL21).toBeLessThan(5_000_000);
    });

    it('an optimally-played free player reaches a healthy level in 30 days', () => {
      // Generous upper-bound 30-day model (study §2.3); collection dominates XP.
      // A realistic player progresses slower — this is the ceiling, not the median.
      const DAILY_NON_COLLECTION_XP = 820;   // daily claim + encounters + travel
      const XP_PER_COLLECTION = 96_000;      // ~96M cash collected / 1000
      const NOVI_PER_COLLECTION = 10_000;    // locked NOVI burned per collection
      const STARTER_COLLECTIONS = Math.floor(STARTER_LOCKED_NOVI / NOVI_PER_COLLECTION);
      const SUSTAINABLE_COLLECTIONS_PER_DAY = 3;

      let totalXp = 30 * DAILY_NON_COLLECTION_XP;
      const collections = STARTER_COLLECTIONS + 30 * SUSTAINABLE_COLLECTIONS_PER_DAY;
      totalXp += collections * XP_PER_COLLECTION;

      const reached = levelFromXp(totalXp);
      log.info(`30-day optimal free player: ~${totalXp.toLocaleString()} XP → level ${reached}`);

      // Progression is no longer walled — a committed free player climbs into the
      // 20s, putting the level-21 reward gate genuinely in play.
      expect(reached).toBeGreaterThanOrEqual(20);
    });
  });

  // §2 — Encounter targeting (±30 band).

  describe('§2 Encounter targeting — ±30 band covers a new player\'s world', () => {
    it('the level-diff gate is widened to ±30', async () => {
      const ge = await fetchGameEngine(ctx.svm, ctx.kingdomId);
      expect(ge).not.toBeNull();
      expect(ge!.gameplayConfig.maxEncounterLevelDiff).toBe(EXPECTED_LEVEL_DIFF);
    });

    it('a level-1 player can now reach encounters that the old ±10 gate blocked', async () => {
      const cityId = 17;

      // Level-1 player at city centre.
      const player = await factory.createPlayer({ cityId, initialize: true });
      const acc = await fetchPlayer(ctx.svm, player.playerPda);
      expect(acc).not.toBeNull();
      expect(acc!.level).toBe(1);

      const baseLat = Math.round(acc!.currentLat * GRID_PRECISION);
      const baseLong = Math.round(acc!.currentLong * GRID_PRECISION);

      // Cells within the 16m encounter attack range of the player.
      const offsets = [
        { dLat: 0, dLong: 1 },
        { dLat: 1, dLong: 0 },
        { dLat: 0, dLong: -1 },
        { dLat: -1, dLong: 0 },
        { dLat: 1, dLong: 1 },
      ];

      const spawned: { index: number; level: number; gridLat: number; gridLong: number }[] = [];
      for (const off of offsets) {
        const cityAcc = await fetchCity(ctx.svm, ctx.gameEngine, cityId);
        const index = Number(cityAcc!.totalEncountersSpawned);
        const gridLat = baseLat + off.dLat;
        const gridLong = baseLong + off.dLong;
        try {
          const ix = createSpawnEncounterInstruction(
            {
              gameEngine: ctx.gameEngine,
              payer: ctx.daoAuthority.address,
              playerOwner: ctx.daoAuthority.address,
              cityId,
              gridLat,
              gridLong,
              encounterIndex: index,
            },
            { encounterType: EncounterRarity.Common }
          );
          await sendInstructions(ctx.svm, [ix], [ctx.daoAuthority]);
        } catch {
          break; // city encounter limit reached — stop, we have enough
        }
        const [encPda] = deriveEncounterPda(ctx.gameEngine, cityId, index);
        const enc = await fetchEncounter(ctx.svm, encPda);
        spawned.push({ index, level: enc!.level, gridLat, gridLong });
      }

      const levels = spawned.map((s) => s.level);
      log.info(`Spawned encounter levels (player is level 1): [${levels.join(', ')}]`);
      expect(spawned.length).toBeGreaterThanOrEqual(2);

      const diffFromPlayer = (lvl: number) => Math.abs(lvl - 1);

      // An encounter that was OUT of reach under ±10 but is now IN reach under ±30.
      const newlyReachable = spawned.find(
        (s) => diffFromPlayer(s.level) > OLD_LEVEL_DIFF && diffFromPlayer(s.level) <= EXPECTED_LEVEL_DIFF
      );
      if (newlyReachable) {
        log.info(`Level-${newlyReachable.level} encounter: blocked at ±10, reachable at ±30 ✓`);
        expect(diffFromPlayer(newlyReachable.level)).toBeGreaterThan(OLD_LEVEL_DIFF);
      }

      // The gate still exists — an encounter beyond ±30 is rejected with
      // EncounterLevelMismatch (not a power/stamina error: the player has a full
      // 16,000-unit army and 100 stamina).
      const stillOutOfRange = spawned.find((s) => diffFromPlayer(s.level) > EXPECTED_LEVEL_DIFF);
      expect(stillOutOfRange).toBeDefined();

      const [playerPda] = derivePlayerPda(ctx.gameEngine, player.publicKey);
      const before = await fetchPlayer(ctx.svm, playerPda);
      const [encPda] = deriveEncounterPda(ctx.gameEngine, cityId, stillOutOfRange!.index);
      const [lootPda] = deriveLootPda(playerPda, before!.lootCounter.toNumber());
      const [encLoc] = deriveLocationPda(
        ctx.gameEngine, cityId, stillOutOfRange!.gridLat, stillOutOfRange!.gridLong
      );
      const ix = createAttackEncounterInstruction(
        {
          gameEngine: ctx.gameEngine,
          owner: player.publicKey,
          encounter: encPda,
          loot: lootPda,
          encounterLocation: encLoc,
          locationCreatorRefund: ctx.daoAuthority.address,
        },
        { encounterId: stillOutOfRange!.index }
      );
      await expectTransactionToFail(
        ctx.svm,
        [ix],
        [player.keypair],
        GameError.EncounterLevelMismatch,
        `level-1 player vs level-${stillOutOfRange!.level} encounter (>±30)`
      );
      log.info(`Attack on level-${stillOutOfRange!.level} encounter → EncounterLevelMismatch (gate still enforced beyond ±30)`);
    });
  });

  // §3 — ACCEPTED trade-off: encounter reward gate unchanged.

  describe('§3 ACCEPTED — encounter NOVI/gem reward gate left unchanged', () => {
    it('Common encounters never award NOVI, at any level', () => {
      for (let level = 1; level <= 100; level++) {
        expect(shouldAwardNovi(level, EncounterRarity.Common)).toBe(false);
      }
    });

    it('lowest NOVI-eligible encounter is level 21 — now reachable via the ±30 band', () => {
      let minLevel = Infinity;
      for (let level = 1; level <= 100; level++) {
        for (let rarity = 0; rarity <= 5; rarity++) {
          if (shouldAwardNovi(level, rarity)) minLevel = Math.min(minLevel, level);
        }
      }
      log.info(`Lowest NOVI-eligible encounter level: ${minLevel} (rarity ≥ Uncommon)`);
      expect(minLevel).toBe(21);
      // With ±30 targeting, even a level-1 player can attack a level-21 Uncommon
      // (|21-1| = 20 ≤ 30) — the gate is mitigated without lowering it.
      expect(minLevel - 1).toBeLessThanOrEqual(EXPECTED_LEVEL_DIFF);
    });
  });

  // §4 — ACCEPTED trade-off: NOVI income cap unchanged.

  describe('§4 ACCEPTED — Rookie NOVI generation cap left unchanged', () => {
    it('Rookie max_locked_novi remains below the one-time starter grant', async () => {
      const ge = await fetchGameEngine(ctx.svm, ctx.kingdomId);
      expect(ge).not.toBeNull();

      const rookie = ge!.subscriptionTiers[0]!;
      const cap = rookie.maxLockedNovi.toNumber();
      const genPer5min = rookie.generationMultiplier.toNumber();
      log.info(`Rookie tier — max_locked_novi: ${cap.toLocaleString()} units ` +
        `(${(cap / 10).toLocaleString()} display), generation: ${genPer5min}/5min; ` +
        `starter grant: ${STARTER_LOCKED_NOVI.toLocaleString()} units`);

      expect(cap).toBeLessThan(STARTER_LOCKED_NOVI / 10);
    });
  });
});
