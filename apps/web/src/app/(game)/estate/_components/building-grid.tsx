"use client";

import { useMemo, useEffect, useState, useCallback } from "react";
import { useEstate } from "@/lib/hooks/useEstate";
import { useRightPanelStore } from "@/lib/store/right-panel";
import { BuildingCard, type BuildingCardData, type BuildingStatus as CardStatus } from "./building-card";
import {
  getBuildingsByCategory,
  BUILDING_FEATURES,
  BUILDING_FEATURE_MAP,
  type BuildingCategory,
} from "@/lib/config/building-features";
import { findBuilding, BuildingStatus } from "@/lib/sdk";
import type { TxPhase } from "@/components/shared/TxButton";

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

  // Build info for all buildings
  const buildingInfo = useMemo(() => {
    return BUILDING_FEATURES.map((config) => {
      if (!estate) {
        return {
          config,
          status: "unbuilt" as CardStatus,
          level: 0,
          constructing: false,
          remainingSec: 0,
          ready: false,
          slot: null,
        };
      }
      const slot = findBuilding(estate, config.id);
      if (!slot || slot.status === BuildingStatus.Empty) {
        return {
          config,
          status: "unbuilt" as CardStatus,
          level: 0,
          constructing: false,
          remainingSec: 0,
          ready: false,
          slot: null,
        };
      }
      const constructing =
        slot.status === BuildingStatus.Building ||
        slot.status === BuildingStatus.Upgrading;
      const endsAt = slot.constructionEnds?.toNumber?.() ?? 0;
      const remainingSec = constructing ? Math.max(0, endsAt - tick) : 0;
      const ready = constructing && remainingSec === 0;
      const statusLabel: CardStatus =
        slot.status === BuildingStatus.Active
          ? "active"
          : slot.status === BuildingStatus.Building
            ? "building"
            : "upgrading";
      return {
        config,
        status: statusLabel,
        level: slot.level,
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

  // Group by category
  const categorized = useMemo(() => {
    const categories = getBuildingsByCategory();
    return categories.map(([category, configs]) => {
      const buildings = configs.map((config) => {
        return buildingInfo.find((b) => b.config.id === config.id)!;
      });
      return [category, buildings] as [BuildingCategory, BuildingCardData[]];
    });
  }, [buildingInfo]);

  // Construction alerts (compact banner)
  const constructingBuildings = buildingInfo.filter((b) => b.constructing);

  const handleCardClick = useCallback(
    (data: BuildingCardData) => {
      // Active building with center view feature → navigate to feature
      if (
        data.status === "active" &&
        data.config.centerView &&
        onOpenFeature
      ) {
        onOpenFeature(data.config.id);
        return;
      }
      // All other cases → open right panel
      onSelectBuilding(data.config.id);
    },
    [onSelectBuilding, onOpenFeature]
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
                .map((b) => {
                  if (b.ready) return `${b.config.name} (ready)`;
                  const mins = Math.floor(b.remainingSec / 60);
                  const hrs = Math.floor(mins / 60);
                  return `${b.config.name} (${hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`})`;
                })
                .join(", ")}
            </span>
          </div>
        </div>
      )}

      {/* Categorized building grid */}
      {categorized.map(([category, buildings]) => (
        <div key={category}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            {category}
          </h2>
          <div className="grid gap-2 grid-cols-2 lg:grid-cols-3">
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
          </div>
        </div>
      ))}
    </div>
  );
}
