/**
 * Shared player/estate readers for the narrative layer.
 *
 * The SDK exports the canonical versions (`hasBuildingAtLevel`, `getTotalUnits`,
 * `isNullPubkey`, `hasExtension`, `hasTeam`), but they demand the full
 * `PlayerCore` / `EstateAccount` / `PublicKey` types. The narrative derivation
 * is pure and deliberately reads loose structural shapes so it stays decoupled
 * from SDK type churn — see deriveAct.ts. These re-state the same logic against
 * those shapes; they are the single copy the narrative files share.
 */
import { BuildingStatus } from "novus-mundus-sdk";

/** A null/system pubkey serialized to base58 — an unset `team` reference. */
const NULL_PUBKEY = "11111111111111111111111111111111";

/** Loose shape for a single estate building slot. */
interface SlotLike {
  buildingType: number;
  status: number;
  level: number;
}

/** Loose shape for the few player fields the narrative reads. */
interface UnitsLike {
  defensiveUnit1: bigint;
  defensiveUnit2: bigint;
  defensiveUnit3: bigint;
  operativeUnit1: bigint;
  operativeUnit2: bigint;
  operativeUnit3: bigint;
}

/** True if `slot` is built (active or upgrading). */
function isRaised(slot: { status: number }): boolean {
  return slot.status === BuildingStatus.Active || slot.status === BuildingStatus.Upgrading;
}

/** True if a building of `type` is built and at least `minLevel` (active or upgrading). */
export function hasBuildingAtLevel(buildings: SlotLike[], type: number, minLevel = 1): boolean {
  return buildings.some((b) => b.buildingType === type && isRaised(b) && b.level >= minLevel);
}

/** Sum of all six unit fields (defensive + operative). */
export function getTotalUnits(player: UnitsLike): number {
  return (
    Number(player.defensiveUnit1) +
    Number(player.defensiveUnit2) +
    Number(player.defensiveUnit3) +
    Number(player.operativeUnit1) +
    Number(player.operativeUnit2) +
    Number(player.operativeUnit3)
  );
}

/** True if the player is sworn into a House — their `team` reference is set. */
export function hasTeam(player: { team?: { toBase58(): string } | null }): boolean {
  const t = player.team;
  return !!t && t.toBase58() !== NULL_PUBKEY;
}

/** True if the player's extensions bitmap carries `flag`. */
export function hasExtension(player: { extensions: number }, flag: number): boolean {
  return (player.extensions & flag) !== 0;
}
