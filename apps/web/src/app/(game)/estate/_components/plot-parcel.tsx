"use client";

import { InfoButton } from "@/components/shared/InfoButton";
import { BuildingCard, type BuildingCardData } from "./building-card";
import { BreakGroundSite } from "./break-ground-site";
import { SLOTS_PER_PLOT, PLOT_NUMERALS } from "./estate-layout";

interface PlotParcelProps {
  /** Zero-based plot index. */
  index: number;
  /** Settled buildings on this parcel, in stable building-id order. */
  buildings: BuildingCardData[];
  selectedBuildingId: number | null;
  onCardClick: (data: BuildingCardData) => void;
  /** Open the global building picker (a break-ground site was tapped). */
  onBreakGround: () => void;
}

/**
 * A blueprint survey parcel: a framed plot holding a fixed 2x2 of slot tiles.
 * Settled buildings fill the first slots as `BuildingCard`s; the rest render as
 * `BreakGroundSite` tiles. The 2x2 is fixed at every width so the parcel always
 * reads as a square of land, including on phone.
 */
export function PlotParcel({
  index,
  buildings,
  selectedBuildingId,
  onCardClick,
  onBreakGround,
}: PlotParcelProps) {
  const free = SLOTS_PER_PLOT - buildings.length;
  return (
    <div data-parcel className="blueprint-parcel rounded-lg p-2.5">
      {/* Header band — parcel numeral and the slot readout */}
      <div className="mb-2 flex items-baseline justify-between gap-2 px-1">
        <h2 className="font-display text-xs font-bold uppercase tracking-[0.2em] text-text-gold">
          Plot {PLOT_NUMERALS[index] ?? index + 1}
        </h2>
        <span className="flex items-center gap-1 text-[10px] tabular-nums text-text-muted">
          {SLOTS_PER_PLOT} slots · {free} free
          <InfoButton>
            An open site is a doorway to your next build, not a fixed square. Tapping any site lets
            you choose a building; the chain raises it in the next free slot.
          </InfoButton>
        </span>
      </div>

      {/* Internal 2x2 — built cards first, break-ground sites fill the rest */}
      <div className="blueprint-grid grid grid-cols-2 gap-2 rounded p-1">
        {buildings.map((data) => (
          <BuildingCard
            key={data.config.id}
            data={data}
            selected={selectedBuildingId === data.config.id}
            onClick={() => onCardClick(data)}
          />
        ))}
        {Array.from({ length: free }).map((_, i) => (
          <BreakGroundSite key={`site-${i}`} onBreakGround={onBreakGround} />
        ))}
      </div>
    </div>
  );
}
