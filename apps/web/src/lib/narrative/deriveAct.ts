/**
 * Client-side derivation of where the player stands — PLAYER_JOURNEY_GAMEPLAN.md §5, §8.
 *
 * Pure: no React, no contract calls. The on-chain `PlayerCore` / `EstateAccount`
 * satisfy the structural shapes below, so these helpers stay decoupled from SDK
 * type churn.
 */
import { BuildingStatus, ExtensionFlags } from "novus-mundus-sdk";
import { BuildingId } from "@/lib/hooks/useFeatureGate";
import { hasBuildingAtLevel, hasExtension } from "./playerHelpers";
import type { Act, BuildingPhase, Mood } from "./types";

// Structural shapes — the real PlayerCore / EstateAccount satisfy these.

interface SlotLike {
  buildingType: number;
  status: number;
  level: number;
  constructionEnds?: { toNumber(): number } | null;
}
interface EstateLike {
  buildings: SlotLike[];
}
interface PlayerLike {
  extensions: number;
}

// Building lifecycle.

/**
 * The single source of truth for a building's phase. Every surface — the
 * Cairn's beats, the estate mood, and (later) the building card's actions —
 * reads this.
 *
 * `raised` / `improved` matter: construction never auto-finishes, so a building
 * can sit done-but-not-finalized, awaiting a manual Complete.
 */
export function buildingPhase(slot: SlotLike | null | undefined, nowSec: number): BuildingPhase {
  if (!slot || slot.status === BuildingStatus.Empty) return "unbuilt";
  const ends = slot.constructionEnds?.toNumber?.() ?? 0;
  const timerDone = nowSec >= ends;
  if (slot.status === BuildingStatus.Building) return timerDone ? "raised" : "rising";
  if (slot.status === BuildingStatus.Upgrading) return timerDone ? "improved" : "improving";
  return "standing"; // BuildingStatus.Active
}

// Act.

/**
 * The current act, inferred from on-chain state the app already reads. The
 * highest satisfied rung wins. Acts 0–IV resolve from player + estate; Act V
 * needs the castle-ownership signal, passed via `opts.ownsCastle` once the
 * castle screens are wired (§5).
 */
export function deriveAct(
  player: PlayerLike | null | undefined,
  estate: EstateLike | null | undefined,
  opts?: { ownsCastle?: boolean },
): Act {
  if (!player || !estate) return 0;
  if (opts?.ownsCastle) return 5;

  const b = estate.buildings ?? [];

  if (
    hasExtension(player, ExtensionFlags.HEROES) ||
    hasBuildingAtLevel(b, BuildingId.Forge) ||
    hasBuildingAtLevel(b, BuildingId.Arena) ||
    hasBuildingAtLevel(b, BuildingId.Catacombs) ||
    hasBuildingAtLevel(b, BuildingId.Sanctuary)
  ) {
    return 4;
  }
  if (hasExtension(player, ExtensionFlags.TEAM) || hasBuildingAtLevel(b, BuildingId.Citadel)) {
    return 3;
  }
  if (hasBuildingAtLevel(b, BuildingId.Academy) || hasBuildingAtLevel(b, BuildingId.Stables)) {
    return 2;
  }
  return 1;
}

// Mood.

/**
 * The estate's mood — the orb's colour (§8). `threatened` needs the attack /
 * reserve signals from the Phase 2 comeback Report; until then mood resolves
 * across raw to working to thriving from build state alone.
 */
export function deriveMood(estate: EstateLike | null | undefined, nowSec: number): Mood {
  if (!estate) return "raw";
  const b = estate.buildings ?? [];
  const active = b.filter(
    (s) => s.status === BuildingStatus.Active || s.status === BuildingStatus.Upgrading,
  ).length;
  const inFlight = b.some((s) => {
    const phase = buildingPhase(s, nowSec);
    return phase !== "unbuilt" && phase !== "standing";
  });
  if (active >= 4) return "thriving";
  if (active === 0 && !inFlight) return "raw";
  return "working";
}
