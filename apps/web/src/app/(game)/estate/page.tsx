"use client";

import { Suspense, useMemo, useCallback } from "react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useEstate } from "@/lib/hooks/useEstate";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useTabParam } from "@/lib/hooks/useTabParam";
import { useRightPanelStore } from "@/lib/store/right-panel";
import { useEstateActions } from "@/lib/hooks/useEstateActions";
import { PageTransition } from "@/components/shared/PageTransition";
import { TxButton } from "@/components/shared/TxButton";
import { GameInfoPanel } from "@/components/shared/GameInfoPanel";
import { InfoGrid } from "@/components/shared/InfoGrid";
import { bpsToPercent } from "@/lib/utils";
import { getCurrentTimeOfDay, getTimeOfDayName, getActivityMultiplier, isTraveling } from "@/lib/sdk";
import { BuildingGrid } from "./_components/building-grid";
import { FeatureView, hasCenterView } from "./_components/feature-view";
import { BUILDING_FEATURE_MAP } from "@/lib/config/building-features";

function EstateContent() {
  const { data: playerData, isSuccess: playerReady } = usePlayer();
  const { data: estateData, isSuccess: estateReady } = useEstate();
  const { data: geData } = useGameEngine();
  const show = useRightPanelStore((s) => s.show);
  const player = playerData?.account;
  const estate = estateData?.account;

  const [activeBuilding, setActiveBuilding] = useTabParam("", "building");

  const {
    handleCreateEstate,
    handleDailyActivity,
    handleBuyPlot,
    handleBuildOrUpgrade,
    handleBuildingSpeedup,
    handleCompleteBuilding,
    plotsOwned,
    maxSlots,
    canBuyPlot,
    nextPlotCost,
  } = useEstateActions();

  // Time-of-day info
  const now = Math.floor(Date.now() / 1000);
  const timeInfo = useMemo(() => {
    if (!player) return null;
    const longitude = player.currentLong ?? 0;
    const tod = getCurrentTimeOfDay(now, longitude / 10000);
    return {
      name: getTimeOfDayName(tod),
      mult: getActivityMultiplier("hiring" as any, tod),
    };
  }, [player, now]);

  const travelWarning = useMemo(() => {
    if (!player) return null;
    return isTraveling(player) ? "Cannot build while traveling" : null;
  }, [player]);

  // Building counts
  const activeCount = estate?.buildings?.filter(
    (b: any) => b.status === 2 || b.status === 3
  ).length ?? 0;
  const constructingCount = estate?.buildings?.filter(
    (b: any) => b.status === 1 || b.status === 4
  ).length ?? 0;

  // Handle building selection for right panel
  const handleSelectBuilding = useCallback(
    (id: number) => {
      const config = BUILDING_FEATURE_MAP.get(id);
      const name = config?.name ?? `Building #${id}`;
      show(name, "building-detail", { buildingId: id, mode: "detail" });
    },
    [show]
  );

  const handleSpeedupBuilding = useCallback(
    (id: number) => {
      const config = BUILDING_FEATURE_MAP.get(id);
      const name = config?.name ?? `Building #${id}`;
      show(`Speed Up ${name}`, "building-speedup", { buildingId: id, mode: "speedup" });
    },
    [show]
  );

  const handleOpenFeature = useCallback(
    (buildingId: number) => {
      setActiveBuilding(String(buildingId));
    },
    [setActiveBuilding]
  );

  // If a building feature view is active, show it
  if (activeBuilding && hasCenterView(Number(activeBuilding))) {
    return (
      <PageTransition>
        <FeatureView buildingId={Number(activeBuilding)} />
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="flex h-full flex-col gap-3">
        {travelWarning && (
          <div className="rounded-lg border border-amber-800/50 bg-amber-900/20 p-3 text-sm text-amber-300">
            {travelWarning}
          </div>
        )}

        {/* No estate yet */}
        {!estateData?.exists && estateReady && (
          <div className="card accent-border text-center">
            <p className="mb-4 text-text-secondary">
              You haven&apos;t established your estate yet. Build your domain!
            </p>
            <TxButton onClick={handleCreateEstate}>Establish Estate</TxButton>
          </div>
        )}

        {/* Estate exists */}
        {estateData?.exists && (
          <>
            {/* Estate header */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
              <h1 className="tier-title font-display text-xl font-bold tracking-wide sm:text-2xl">
                ESTATE
              </h1>
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-6 text-sm">
                  <div>
                    <span className="text-text-muted">Level </span>
                    <span className="font-semibold text-text-primary">
                      {estate?.estateLevel ?? 0}
                    </span>
                  </div>
                  <div>
                    <span className="text-text-muted">Plots </span>
                    <span className="font-semibold text-text-primary">
                      {plotsOwned}
                    </span>
                    <span className="text-text-muted">/5</span>
                  </div>
                  <div>
                    <span className="text-text-muted">Slots </span>
                    <span className="font-semibold text-text-primary">
                      {activeCount + constructingCount}
                    </span>
                    <span className="text-text-muted">/{maxSlots}</span>
                  </div>
                  {timeInfo && (
                    <div>
                      <span className="text-text-muted">{timeInfo.name}</span>
                      {timeInfo.mult !== 1 && (
                        <span
                          className={`ml-1 text-xs ${
                            timeInfo.mult > 1 ? "text-green-600" : "text-amber-600"
                          }`}
                        >
                          (
                          {timeInfo.mult > 1
                            ? `-${((timeInfo.mult - 1) * 100).toFixed(0)}%`
                            : `+${(((1 - timeInfo.mult) / timeInfo.mult) * 100).toFixed(0)}%`}{" "}
                          cost)
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="ml-auto flex items-center gap-2">
                  {canBuyPlot && (
                    <TxButton
                      onClick={handleBuyPlot}
                      variant="secondary"
                      className="text-xs px-4"
                    >
                      Buy Plot ({(nextPlotCost / 1000).toFixed(0)}k NOVI)
                    </TxButton>
                  )}
                  <TxButton
                    onClick={handleDailyActivity}
                    variant="secondary"
                    className="text-xs px-4"
                  >
                    Daily Claim
                  </TxButton>
                </div>
              </div>
            </div>

            {/* Building grid */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              <BuildingGrid
                selectedBuildingId={null}
                onSelectBuilding={handleSelectBuilding}
                onSpeedupBuilding={handleSpeedupBuilding}
                onCompleteBuilding={(id, rp) => handleCompleteBuilding(id, rp)}
                onOpenFeature={handleOpenFeature}
              />

              {/* Game Parameters */}
              {geData?.account &&
                (() => {
                  const gp = geData.account.gameplayConfig;
                  return (
                    <div className="mt-6">
                      <GameInfoPanel>
                        <InfoGrid
                          items={[
                            {
                              label: "Happy Abandon",
                              value: bpsToPercent(gp.abandonRateHappy),
                              highlight: true,
                            },
                            {
                              label: "Content Abandon",
                              value: bpsToPercent(gp.abandonRateContent),
                            },
                            {
                              label: "Unhappy Abandon",
                              value: bpsToPercent(gp.abandonRateUnhappy),
                            },
                            {
                              label: "Miserable Abandon",
                              value: bpsToPercent(gp.abandonRateMiserable),
                            },
                            {
                              label: "Dmg Redist T1→T2",
                              value: bpsToPercent(gp.damageRedistribUnit1ToUnit2),
                            },
                            {
                              label: "Dmg Redist T1→T3",
                              value: bpsToPercent(gp.damageRedistribUnit1ToUnit3),
                            },
                            {
                              label: "Dmg Redist T3→T1",
                              value: bpsToPercent(gp.damageRedistribUnit3ToUnit1),
                            },
                            {
                              label: "Dmg Redist T3→T2",
                              value: bpsToPercent(gp.damageRedistribUnit3ToUnit2),
                            },
                          ]}
                        />
                      </GameInfoPanel>
                    </div>
                  );
                })()}
            </div>
          </>
        )}
      </div>
    </PageTransition>
  );
}

export default function EstatePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center text-text-muted">
          Loading...
        </div>
      }
    >
      <EstateContent />
    </Suspense>
  );
}
