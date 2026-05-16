"use client";

import { useMemo, useEffect, useState, useCallback } from "react";
import { useEstate } from "@/lib/hooks/useEstate";
import { BUILDING_FEATURES } from "@/lib/config/building-features";
import { findBuilding } from "novus-mundus-sdk";
import { buildingPhase } from "@/lib/narrative";
import { formatTime } from "@/lib/utils";
import { BuildingCard, type BuildingCardData, type BuildingStatus as CardStatus } from "./building-card";
import { hasCenterView } from "./feature-view";
import type { TxPhase } from "@/components/shared/TxButton";

/** Building slots a single plot holds. */
const SLOTS_PER_PLOT = 4;
/** The most plots a holding can claim. */
const MAX_PLOTS = 5;

interface BuildingGridProps {
  /** Currently selected building ID in the right panel */
  selectedBuildingId: number | null;
  onSelectBuilding: (id: number) => void;
  onSpeedupBuilding: (id: number) => void;
  onCompleteBuilding: (id: number, reportPhase: (p: TxPhase) => void) => Promise<string>;
  /** Navigation function for center-view features */
  onOpenFeature?: (buildingId: number) => void;
}

export function BuildingGrid({
  selectedBuildingId,
  onSelectBuilding,
  onSpeedupBuilding,
  onCompleteBuilding,
  onOpenFeature,
}: BuildingGridProps) {
  const { data: estateData } = useEstate();
  const estate = estateData?.account;

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
      // A built building with a feature view → open it. The feature stays
      // usable through an upgrade, so improving and improved route here too.
      if (usable && onOpenFeature && hasCenterView(id)) {
        onOpenFeature(id);
        return;
      }
      // Under construction or mid-upgrade → the speed-up / complete panel.
      if (
        phase === "rising" ||
        phase === "raised" ||
        phase === "improving" ||
        phase === "improved"
      ) {
        onSpeedupBuilding(id);
        return;
      }
      // Unbuilt, or standing without a feature → the detail panel.
      onSelectBuilding(id);
    },
    [onSelectBuilding, onSpeedupBuilding, onOpenFeature]
  );

  return (
    <div className="space-y-6">
      {/* Construction alerts banner */}
      {constructingBuildings.length > 0 && (
        <div className="rounded-lg border border-amber-700/60 bg-amber-900/10 px-4 py-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold text-amber-500">
              {constructingBuildings.length} building{constructingBuildings.length > 1 ? "s" : ""} under construction
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
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            {buildings.map((data) => (
              <BuildingCard
                key={data.config.id}
                data={data}
                selected={selectedBuildingId === data.config.id}
                onClick={() => handleCardClick(data)}
                onSpeedup={() => onSpeedupBuilding(data.config.id)}
                onComplete={
                  data.ready
                    ? (rp) => onCompleteBuilding(data.config.id, rp)
                    : undefined
                }
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
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            {unbuilt.map((data) => (
              <BuildingCard
                key={data.config.id}
                data={data}
                selected={selectedBuildingId === data.config.id}
                onClick={() => handleCardClick(data)}
                onSpeedup={() => onSpeedupBuilding(data.config.id)}
                onComplete={
                  data.ready
                    ? (rp) => onCompleteBuilding(data.config.id, rp)
                    : undefined
                }
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
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            {Array.from({ length: MAX_PLOTS - plotsOwned }).map((_, idx) => (
              <div
                key={`unclaimed-${idx}`}
                className="flex min-h-[5.5rem] flex-col items-center justify-center rounded-lg border border-dashed border-border-default/40 p-3 text-center opacity-50"
              >
                <span className="text-sm font-semibold text-text-muted">
                  Plot {plotsOwned + idx + 1}
                </span>
                <span className="mt-0.5 text-[11px] text-text-muted">
                  Unclaimed ground
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
