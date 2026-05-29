/**
 * Shared castle vocabulary — names + narration + danger predicate
 * keyed off the chain-side `CastleTier` / `CastleStatus` enums.
 *
 * Single source of truth so the EntityPanel inspect block, the hover
 * tooltip on the disc, and the dedicated Castles tab can't drift
 * (they previously did — castle-tab said "Contest" while map-tab
 * said "Contested" for the same enum value, and the on-disc
 * tooltip had a third spelling).
 */
import { CastleStatus, CastleTier } from "novus-mundus-sdk";

export const CASTLE_TIER_NAMES: Record<number, string> = {
  [CastleTier.Outpost]: "Outpost",
  [CastleTier.Keep]: "Keep",
  [CastleTier.Stronghold]: "Stronghold",
  [CastleTier.Fortress]: "Fortress",
  [CastleTier.Citadel]: "Citadel",
};

export const CASTLE_STATUS_NAMES: Record<number, string> = {
  [CastleStatus.Vacant]: "Vacant",
  [CastleStatus.Contest]: "Contested",
  [CastleStatus.Protected]: "Protected",
  [CastleStatus.Vulnerable]: "Vulnerable",
  [CastleStatus.Transitioning]: "Transitioning",
};

/** One-line story per status — surfaces what the player can DO from
 *  this seat's current disposition, in the EntityPanel's tighter
 *  voice. */
export const CASTLE_STATUS_NARRATION: Record<number, string> = {
  [CastleStatus.Vacant]: "The seat stands empty. A banner could be planted here today.",
  [CastleStatus.Contest]: "Blades are already in the field for this seat.",
  [CastleStatus.Protected]:
    "The seat is held, and protection still wraps it. No one may move against it yet.",
  [CastleStatus.Vulnerable]: "The seat is held, but its protection has lapsed. It can be taken.",
  [CastleStatus.Transitioning]: "The seat is changing hands. Wait for the dust to settle.",
};

/** `true` for the two states that demand a decision from the viewer:
 *  Contest (active conflict) and Vulnerable (held but exposed).
 *  Drives the danger-tone styling for stat cards and progress bars. */
export function isCastleStatusDanger(status: number): boolean {
  return status === CastleStatus.Contest || status === CastleStatus.Vulnerable;
}
