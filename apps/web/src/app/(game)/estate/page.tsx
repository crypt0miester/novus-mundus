"use client";

import { Suspense, useCallback, useState, useEffect } from "react";
import { ChevronRight } from "lucide-react";
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
import { findBuilding, BuildingStatus, type BuildingSlot } from "novus-mundus-sdk";
import { BuildingGrid } from "./_components/building-grid";
import { FeatureView, hasCenterView } from "./_components/feature-view";
import {
  BUILDING_FEATURE_MAP,
  buildingSlug,
  buildingIdFromSlug,
} from "@/lib/config/building-features";
import { Arrival } from "@/components/arrival/Arrival";
import { loadJump } from "@/lib/jumpstart/persist";
import { buildingPhase } from "@/lib/narrative";
import MagicRings from "@/components/shared/animations/MagicRing";
import { DailyActivityTracker } from "./_components/daily-activity/DailyActivityTracker";

function EstateContent() {
  const { data: playerData, isSuccess: playerReady } = usePlayer();
  const { data: estateData, isSuccess: estateReady } = useEstate();
  const { data: geData } = useGameEngine();
  const show = useRightPanelStore((s) => s.show);
  const panelOpen = useRightPanelStore((s) => s.open);
  const panelKey = useRightPanelStore((s) => s.contentKey);
  const panelBuildingId = useRightPanelStore((s) => s.contentProps.buildingId);
  const player = playerData?.account;
  const estate = estateData?.account;

  // The building card rendered as "selected" mirrors whichever building's
  // detail panel is currently open in the right panel. Deriving it from the
  // panel store (rather than tracking it separately) keeps the highlight in
  // sync when the panel is closed or switched to another building.
  const selectedBuildingId =
    panelOpen && panelKey === "building-detail" && typeof panelBuildingId === "number"
      ? panelBuildingId
      : null;

  const [activeBuilding, setActiveBuilding] = useTabParam("", "building");

  const { handleCreateEstate, handleBuyPlot, plotsOwned, maxSlots, canBuyPlot, nextPlotCost } =
    useEstateActions();

  const now = Math.floor(Date.now() / 1000);

  // Building counts
  const activeCount =
    estate?.buildings?.filter(
      (b: BuildingSlot) =>
        b.status === BuildingStatus.Active || b.status === BuildingStatus.Upgrading,
    ).length ?? 0;
  const constructingCount =
    estate?.buildings?.filter((b: BuildingSlot) => b.status === BuildingStatus.Building).length ??
    0;

  // Handle building selection for right panel. One handler for every phase —
  // the panel itself derives build / upgrade / speed-up from the live state.
  const handleSelectBuilding = useCallback(
    (id: number) => {
      const config = BUILDING_FEATURE_MAP.get(id);
      const name = config?.name ?? `Building #${id}`;
      show(name, "building-detail", { buildingId: id });
    },
    [show],
  );

  const handleOpenFeature = useCallback(
    (buildingId: number) => {
      // Use a readable slug in the URL (?building=mine), not a raw id.
      setActiveBuilding(buildingSlug(buildingId));
    },
    [setActiveBuilding],
  );

  // A break-ground site opens the global building picker. The chain auto-places
  // into the next free slot, so any site shows the same list of unbuilt types.
  const handleBreakGround = useCallback(() => {
    show("Break Ground", "building-picker");
  }, [show]);

  // The Arrival — onboarding gate. The estate is home; a player without an
  // estate (or no player at all) sees the Arrival before the holding.
  const [arrivalState, setArrivalState] = useState<"pending" | "running" | "done">("pending");
  useEffect(() => {
    if (arrivalState !== "pending") return;
    if (!playerReady || !estateReady) return;
    // A jump-ahead can create the player + estate yet still be unfinished —
    // keep the Arrival open so it can resume the jump rather than dropping
    // the player into a half-built holding.
    const arrived = playerData?.exists && estateData?.exists && !loadJump();
    setArrivalState(arrived ? "done" : "running");
  }, [arrivalState, playerReady, estateReady, playerData, estateData]);

  if (arrivalState === "pending") {
    // Full-screen cover (matches the Arrival container) so the game shell —
    // TopBar, sidebars, tab bar — never flashes before we know whether this
    // is a returning estate or a first-time Arrival.
    return (
      <div className="fixed inset-0 z-9000 flex items-center justify-center bg-surface">
        <div className="h-56 w-56">
          <MagicRings color="#92400e" colorTwo="#fbbf24" />
        </div>
      </div>
    );
  }
  if (arrivalState === "running") {
    return <Arrival hasPlayer={!!playerData?.exists} onComplete={() => setArrivalState("done")} />;
  }

  // If a building feature view is active and the building is usable, show it.
  // The ?building= param carries a readable slug ("mine") — resolve it to an id.
  const activeBuildingId = buildingIdFromSlug(activeBuilding);
  if (activeBuildingId !== null && hasCenterView(activeBuildingId)) {
    const slot = estate ? findBuilding(estate, activeBuildingId) : null;
    const phase = buildingPhase(slot, now);
    if (phase === "standing" || phase === "improving" || phase === "improved") {
      return (
        <PageTransition>
          <FeatureView buildingId={activeBuildingId} />
        </PageTransition>
      );
    }
  }

  return (
    <PageTransition>
      <div className="flex h-full flex-col gap-3">
        {/* No holding yet — the ground is unclaimed */}
        {!estateData?.exists && estateReady && (
          <div className="card accent-border text-center">
            <p className="mb-4 text-text-secondary">
              The ground here is yours for the taking. Drive your stakes and the climb begins.
            </p>
            <TxButton onClick={handleCreateEstate}>Claim the Ground</TxButton>
          </div>
        )}

        {/* Estate exists */}
        {estateData?.exists && (
          <>
            {/* The holding header — the land, named and counted */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
              <div>
                <h1 className="tier-title font-display text-xl font-bold tracking-wide sm:text-2xl">
                  YOUR HOLDING
                </h1>
                <p className="mt-0.5 text-xs text-text-muted">
                  The ground you have claimed, and the ground still beyond it.
                </p>
              </div>
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
                    <span className="font-semibold text-text-primary">{plotsOwned}</span>
                    <span className="text-text-muted">/5</span>
                  </div>
                  <div>
                    <span className="text-text-muted">Slots </span>
                    <span className="font-semibold text-text-primary">
                      {activeCount + constructingCount}
                    </span>
                    <span className="text-text-muted">/{maxSlots}</span>
                  </div>
                </div>
              </div>
            </div>

            <DailyActivityTracker />

            {/* Building grid */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              <BuildingGrid
                selectedBuildingId={selectedBuildingId}
                onSelectBuilding={handleSelectBuilding}
                onOpenFeature={handleOpenFeature}
                onBreakGround={handleBreakGround}
                onBuyPlot={handleBuyPlot}
                nextPlotCost={nextPlotCost}
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
                              label: (
                                <>
                                  Dmg Redist T1{" "}
                                  <ChevronRight className="inline-block h-2.5 w-2.5 align-middle" />{" "}
                                  T2
                                </>
                              ),
                              value: bpsToPercent(gp.damageRedistribUnit1ToUnit2),
                            },
                            {
                              label: (
                                <>
                                  Dmg Redist T1{" "}
                                  <ChevronRight className="inline-block h-2.5 w-2.5 align-middle" />{" "}
                                  T3
                                </>
                              ),
                              value: bpsToPercent(gp.damageRedistribUnit1ToUnit3),
                            },
                            {
                              label: (
                                <>
                                  Dmg Redist T3{" "}
                                  <ChevronRight className="inline-block h-2.5 w-2.5 align-middle" />{" "}
                                  T1
                                </>
                              ),
                              value: bpsToPercent(gp.damageRedistribUnit3ToUnit1),
                            },
                            {
                              label: (
                                <>
                                  Dmg Redist T3{" "}
                                  <ChevronRight className="inline-block h-2.5 w-2.5 align-middle" />{" "}
                                  T2
                                </>
                              ),
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
