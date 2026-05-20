"use client";

import { useMemo, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useEstate } from "@/lib/hooks/useEstate";
import { BUILDING_FEATURES } from "@/lib/config/building-features";
import { findBuilding } from "novus-mundus-sdk";
import { buildingPhase } from "@/lib/narrative";
import { formatTime } from "@/lib/utils";
import { BuildingCard, type BuildingCardData, type BuildingStatus as CardStatus } from "./building-card";
import { hasCenterView } from "./feature-view";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";

/** Building slots a single plot holds. */
const SLOTS_PER_PLOT = 4;
/** The most plots a holding can claim. */
const MAX_PLOTS = 5;

interface BuildingGridProps {
  /** Currently selected building ID in the right panel */
  selectedBuildingId: number | null;
  onSelectBuilding: (id: number) => void;
  /** Navigation function for center-view features */
  onOpenFeature?: (buildingId: number) => void;
  /** Buy the next plot — wired to the next claimable "Land Beyond" card. */
  onBuyPlot: (reportPhase: (p: TxPhase) => void) => Promise<string>;
  /** NOVI cost of the next plot, for the claim card label. */
  nextPlotCost: number;
}

export function BuildingGrid({
  selectedBuildingId,
  onSelectBuilding,
  onOpenFeature,
  onBuyPlot,
  nextPlotCost,
}: BuildingGridProps) {
  const { data: estateData } = useEstate();
  const estate = estateData?.account;
  const router = useRouter();

  const [tick, setTick] = useState(() => Math.floor(Date.now() / 1000));

  // Build info for all buildings — buildingPhase() is the single source of truth.
  const buildingInfo = useMemo(() => {
    return BUILDING_FEATURES.map((config) => {
      const slot = estate ? findBuilding(estate, config.id) : null;
      const phase = buildingPhase(slot, tick);
      const constructing =
        phase === "rising" ||
        phase === "raised" ||
        phase === "improving" ||
        phase === "improved";
      const endsAt = slot?.constructionEnds?.toNumber?.() ?? 0;
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
      return {
        config,
        phase,
        status,
        level: slot?.level ?? 0,
        constructing,
        remainingSec,
        ready,
        slot,
      };
    });
  }, [estate, tick]);

  // Tick timer for construction progress
  const hasConstructing = buildingInfo.some((b) => b.constructing);
  useEffect(() => {
    if (!hasConstructing) return;
    const interval = setInterval(() => {
      setTick(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [hasConstructing]);

  const plotsOwned = Math.max(1, Math.min(MAX_PLOTS, estate?.plotsOwned ?? 1));

  // Reframe the holding as land: every building that has broken ground (built,
  // standing, or under construction) is settled onto a claimed plot, four to a
  // parcel; buildings not yet raised wait in a separate "ground to break" set.
  // The on-chain model doesn't pin a building to a plot index, so the layout
  // is a stable visual fill — buildings settle in building-id order — not a
  // slot-accurate map.
  const { plots, unbuilt } = useMemo(() => {
    const ordered = [...buildingInfo].sort((a, b) => a.config.id - b.config.id);
    const settled = ordered.filter((b) => b.phase !== "unbuilt");
    const unbuilt = ordered.filter((b) => b.phase === "unbuilt");
    const plots: BuildingCardData[][] = [];
    for (let i = 0; i < plotsOwned; i++) {
      plots.push(settled.slice(i * SLOTS_PER_PLOT, (i + 1) * SLOTS_PER_PLOT));
    }
    // A building beyond the claimed plots' capacity has no parcel to sit on —
    // fold it back into the ground-to-break set so nothing is dropped.
    const overflow = settled.slice(plotsOwned * SLOTS_PER_PLOT);
    return { plots, unbuilt: [...overflow, ...unbuilt] };
  }, [buildingInfo, plotsOwned]);

  // Construction alerts (compact banner)
  const constructingBuildings = buildingInfo.filter((b) => b.constructing);

  const handleCardClick = useCallback(
    (data: BuildingCardData) => {
      const id = data.config.id;
      const { phase } = data;
      const usable =
        phase === "standing" || phase === "improving" || phase === "improved";
      // A usable building whose feature lives on another page navigates there
      // (e.g. Catacombs → the dungeon), instead of opening an estate panel.
      if (usable && data.config.route) {
        router.push(data.config.route);
        return;
      }
      // A built building with a feature view → open it. The feature stays
      // usable through an upgrade, so improving and improved route here too.
      if (usable && onOpenFeature && hasCenterView(id)) {
        onOpenFeature(id);
        return;
      }
      // Everything else — under construction, unbuilt, or standing without a
      // feature — opens the detail panel. The panel reads the building's live
      // phase and shows speed-up / complete or build / upgrade accordingly.
      onSelectBuilding(id);
    },
    [onSelectBuilding, onOpenFeature, router]
  );

  return (
    <div className="space-y-6">
      {/* Construction alerts banner */}
      {constructingBuildings.length > 0 && (
        <div className="rounded-lg border border-amber-700/60 bg-amber-900/10 px-4 py-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold text-amber-500">
              {constructingBuildings.length} rising
            </span>
            <span className="text-text-muted">
              {constructingBuildings
                .map((b) =>
                  b.ready
                    ? `${b.config.name} (ready)`
                    : `${b.config.name} (${formatTime(b.remainingSec, "compact")})`,
                )
                .join(", ")}
            </span>
          </div>
        </div>
      )}

      {/* Claimed plots — the land, parcel by parcel */}
      {plots.map((buildings, idx) => (
        <div key={`plot-${idx}`}>
          <div className="mb-2 flex items-baseline gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
              Plot {idx + 1}
            </h2>
            <span className="text-[10px] tabular-nums text-text-muted">
              {buildings.length}/{SLOTS_PER_PLOT}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {buildings.map((data) => (
              <BuildingCard
                key={data.config.id}
                data={data}
                selected={selectedBuildingId === data.config.id}
                onClick={() => handleCardClick(data)}
              />
            ))}
            {Array.from({ length: SLOTS_PER_PLOT - buildings.length }).map(
              (_, slotIdx) => (
                <div
                  key={`empty-${slotIdx}`}
                  className="flex min-h-[5.5rem] items-center justify-center rounded-lg border border-dashed border-border-default/60 p-3 text-[11px] text-text-muted"
                >
                  Open ground
                </div>
              ),
            )}
          </div>
        </div>
      ))}

      {/* Ground still to break — buildings the holding has not yet raised */}
      {unbuilt.length > 0 && (
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Ground to Break
          </h2>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {unbuilt.map((data) => (
              <BuildingCard
                key={data.config.id}
                data={data}
                selected={selectedBuildingId === data.config.id}
                onClick={() => handleCardClick(data)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Land beyond the claim — plots the holding has not yet bought */}
      {plotsOwned < MAX_PLOTS && (
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Land Beyond Your Claim
          </h2>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {Array.from({ length: MAX_PLOTS - plotsOwned }).map((_, idx) => {
              const plotNumber = plotsOwned + idx + 1;
              // Plots claim in sequence — only the next one can be bought now.
              if (idx === 0) {
                return (
                  <TxButton
                    key={`unclaimed-${idx}`}
                    onClick={onBuyPlot}
                    variant="secondary"
                    className="flex min-h-[5.5rem] w-full flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-amber-700/50 bg-amber-900/10 p-3 text-center transition-colors hover:border-amber-600 hover:bg-amber-900/20"
                  >
                    <span className="text-sm font-semibold text-text-gold">
                      Claim Plot {plotNumber}
                    </span>
                    <span className="text-[11px] text-text-muted">
                      Buy Plot · {(nextPlotCost / 1000).toFixed(0)}k NOVI
                    </span>
                  </TxButton>
                );
              }
              return (
                <div
                  key={`unclaimed-${idx}`}
                  className="flex min-h-[5.5rem] flex-col items-center justify-center rounded-lg border border-dashed border-border-default/40 p-3 text-center opacity-50"
                >
                  <span className="text-sm font-semibold text-text-muted">
                    Plot {plotNumber}
                  </span>
                  <span className="mt-0.5 text-[11px] text-text-muted">
                    Unclaimed ground
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
