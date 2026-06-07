import { findBuilding, type EstateAccount } from "novus-mundus-sdk";
import { BUILDING_FEATURES } from "@/lib/config/building-features";
import { buildingPhase } from "@/lib/narrative";
import type { BuildingCardData, BuildingStatus as CardStatus } from "./building-card";

/** Building slots a single plot holds. */
export const SLOTS_PER_PLOT = 4;
/** The most plots a holding can claim. */
export const MAX_PLOTS = 5;
/** Roman numerals for a parcel's header band, indexed by zero-based plot. */
export const PLOT_NUMERALS = ["I", "II", "III", "IV", "V"];

/**
 * Per-building lifecycle info for every building type, derived from the live
 * estate via `buildingPhase()` (the single source of truth). Shared between the
 * estate grid and the right-panel building picker so both read one model.
 */
export function deriveBuildingInfo(
  estate: EstateAccount | null | undefined,
  tick: number,
): BuildingCardData[] {
  return BUILDING_FEATURES.map((config) => {
    const slot = estate ? findBuilding(estate, config.id) : null;
    const phase = buildingPhase(slot, tick);
    const constructing =
      phase === "rising" || phase === "raised" || phase === "improving" || phase === "improved";
    const endsAt = Number(slot?.constructionEnds ?? 0n);
    const remainingSec = constructing ? Math.max(0, endsAt - tick) : 0;
    const ready = phase === "raised" || phase === "improved";
    const status: CardStatus =
      phase === "unbuilt"
        ? "unbuilt"
        : phase === "standing"
          ? "active"
          : phase === "rising" || phase === "raised"
            ? "building"
            : "upgrading";
    return { config, phase, status, level: slot?.level ?? 0, constructing, remainingSec, ready, slot };
  });
}

/**
 * Split building info into the land model: every building that has broken ground
 * (built, standing, or under construction) settles onto a claimed plot, four to
 * a parcel, in building-id order; buildings not yet raised are returned as the
 * `unbuilt` set the picker draws from.
 *
 * The on-chain model doesn't pin a building to a plot index, so this is a stable
 * visual fill, not a slot-accurate map (see find_empty_slot in estate.rs).
 * `overflow` holds any settled building beyond the claimed plots' capacity — the
 * chain should prevent it, but it is surfaced defensively rather than dropped.
 */
export function splitPlots(buildingInfo: BuildingCardData[], plotsOwned: number) {
  const ordered = [...buildingInfo].sort((a, b) => a.config.id - b.config.id);
  const settled = ordered.filter((b) => b.phase !== "unbuilt");
  const unbuilt = ordered.filter((b) => b.phase === "unbuilt");
  const plots: BuildingCardData[][] = [];
  for (let i = 0; i < plotsOwned; i++) {
    plots.push(settled.slice(i * SLOTS_PER_PLOT, (i + 1) * SLOTS_PER_PLOT));
  }
  const overflow = settled.slice(plotsOwned * SLOTS_PER_PLOT);
  return { plots, unbuilt, overflow };
}
