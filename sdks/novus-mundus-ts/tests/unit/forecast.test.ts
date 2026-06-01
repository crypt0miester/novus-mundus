import { describe, it, expect } from "bun:test";
import {
  forecastBattle,
  forecastVerdict,
  recommendForce,
  forecastEncounter,
  recommendForceForEncounter,
  type ForceStats,
} from "../../src/index";

// A defender with no buffs and no armor — pure unit/weapon wall.
function defender(unit1: number, weapons = unit1): ForceStats {
  return { unit1, unit2: 0, unit3: 0, melee: weapons, ranged: 0, siege: 0 };
}

function attacker(unit1: number, weapons = unit1): ForceStats {
  return { unit1, unit2: 0, unit3: 0, melee: weapons, ranged: 0, siege: 0 };
}

describe("forecastBattle", () => {
  it("a large armed host overruns a tiny garrison", () => {
    const f = forecastBattle(attacker(5000), defender(50));
    expect(f.attackerWon).toBe(true);
    expect(f.defenderCasualtyRatioBps).toBe(10000); // wiped
    expect(f.marginBps).toBeGreaterThan(0);
  });

  it("a tiny host loses to a large garrison", () => {
    const f = forecastBattle(attacker(50), defender(5000));
    expect(f.attackerWon).toBe(false);
    expect(f.marginBps).toBeLessThan(0);
  });

  it("under-arming weakens the attacker (coverage caps damage)", () => {
    const armed = forecastBattle(attacker(1000, 1000), defender(700));
    const bare = forecastBattle(attacker(1000, 0), defender(700));
    // Same headcount, zero weapons → strictly less damage dealt.
    expect(bare.attackerDamage).toBeLessThan(armed.attackerDamage);
    expect(bare.defenderLosses).toBeLessThanOrEqual(armed.defenderLosses);
  });

  it("drive-by lifts attacker damage at the 10k threshold", () => {
    const flat = forecastBattle(attacker(12000), defender(100), { driveBy: false });
    const drive = forecastBattle(attacker(12000), defender(100), { driveBy: true });
    expect(drive.attackerDamage).toBeGreaterThan(flat.attackerDamage);
  });

  it("citadel bonus raises attacker damage", () => {
    const base = forecastBattle(attacker(1000), defender(900));
    const buffed = forecastBattle(attacker(1000), defender(900), {
      attackerDamageBonusBps: 5000, // +50%
    });
    expect(buffed.attackerDamage).toBeGreaterThan(base.attackerDamage);
  });
});

describe("forecastVerdict", () => {
  it("grades a wipe as decisive", () => {
    const f = forecastBattle(attacker(5000), defender(20));
    expect(forecastVerdict(f)).toBe("win-decisive");
  });

  it("grades a hopeless attack as a decisive loss", () => {
    const f = forecastBattle(attacker(10), defender(8000));
    expect(forecastVerdict(f)).toBe("loss-decisive");
  });
});

describe("recommendForce", () => {
  it("returns a force that actually wins per the simulator", () => {
    const def = defender(800);
    const rec = recommendForce({}, def);
    expect(rec.achievable).toBe(true);
    expect(rec.totalUnits).toBeGreaterThan(0);
    // The recommended, fully-armed force must clear the same defender.
    const check = forecastBattle(
      { unit1: rec.unit1, unit2: rec.unit2, unit3: rec.unit3, melee: rec.weaponsTotal, ranged: 0, siege: 0 },
      def,
    );
    expect(check.attackerWon).toBe(true);
    expect(forecastVerdict(check)).not.toBe("loss");
    expect(forecastVerdict(check)).not.toBe("loss-decisive");
  });

  it("is roughly minimal — one notch smaller does not clear the cushion", () => {
    const def = defender(800);
    const rec = recommendForce({}, def);
    if (rec.totalUnits > 2) {
      const smaller = Math.floor(rec.totalUnits * 0.6);
      const weak = forecastBattle(
        { unit1: smaller, unit2: 0, unit3: 0, melee: smaller, ranged: 0, siege: 0 },
        def,
      );
      // A force 40% smaller should not clear the same safety cushion.
      const weakWinsComfortably =
        weak.attackerWon && weak.marginBps >= 1500;
      expect(weakWinsComfortably).toBe(false);
    }
  });

  it("carries attacker buffs into the trial forces", () => {
    const def = defender(2000);
    const plain = recommendForce({}, def);
    const buffed = recommendForce({ researchAttackBps: 5000, heroAttackBps: 5000 }, def);
    // Stronger per-unit damage → needs no more troops than the plain host.
    expect(buffed.totalUnits).toBeLessThanOrEqual(plain.totalUnits);
  });
});

describe("encounter recommendation", () => {
  it("recommends a host that clears the encounter", () => {
    const health = 50_000;
    const defenseBps = 1000;
    const rec = recommendForceForEncounter(defenseBps, health, false);
    expect(rec.clears).toBe(true);
    const check = forecastEncounter(rec.totalUnits, rec.weaponsTotal, defenseBps, health, false);
    expect(check.clears).toBe(true);
  });
});
