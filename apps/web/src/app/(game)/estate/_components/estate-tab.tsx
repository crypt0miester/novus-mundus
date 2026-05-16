"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useEstate } from "@/lib/hooks/useEstate";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { DetailPanel } from "@/components/shared/DetailPanel";
import { SpeedupPanel } from "@/components/shared/SpeedupPanel";
import { GameInfoPanel } from "@/components/shared/GameInfoPanel";
import { InfoGrid } from "@/components/shared/InfoGrid";
import { bpsToPercent } from "@/lib/utils";
import {
  derivePlayerPda,
  deriveEstatePda,
  createCreateEstateInstruction,
  createBuildBuildingInstruction,
  createUpgradeBuildingInstruction,
  createBuildingSpeedupInstruction,
  createCompleteBuildingInstruction,
  createBuyPlotInstruction,
  calculateUpgradeCost,
  getCurrentTimeOfDay,
  getTimeOfDayName,
  getActivityMultiplier,
  isTraveling,
  findBuilding,
  BuildingStatus,
} from "@/lib/sdk";
import { requestCoSign } from "@/lib/cosign";

const BUILDING_TYPES = [
  { id: 0, name: "Mansion", desc: "Home base", tier: 1 },
  { id: 1, name: "Barracks", desc: "Recruit defensive units", tier: 1 },
  { id: 2, name: "Workshop", desc: "Mining expeditions", tier: 1 },
  { id: 3, name: "Vault", desc: "Secure your wealth", tier: 1 },
  { id: 4, name: "Dock", desc: "Fishing expeditions", tier: 1 },
  { id: 5, name: "Forge", desc: "Craft equipment", tier: 3 },
  { id: 6, name: "Market", desc: "Trade with others", tier: 2 },
  { id: 7, name: "Academy", desc: "Begin research", tier: 2 },
  { id: 8, name: "Arena", desc: "PvP combat", tier: 3 },
  { id: 9, name: "Sanctuary", desc: "Hero meditation", tier: 2 },
  { id: 10, name: "Observatory", desc: "Enhance loot", tier: 3 },
  { id: 11, name: "Treasury", desc: "Maximize prizes", tier: 3 },
  { id: 12, name: "Citadel", desc: "Lead rallies", tier: 2 },
  { id: 13, name: "Camp", desc: "Hire operative units", tier: 1 },
  { id: 14, name: "Mine", desc: "Mining expeditions", tier: 2 },
  { id: 15, name: "Catacombs", desc: "Dungeon access", tier: 3 },
  { id: 16, name: "Farm", desc: "Produce collection", tier: 1 },
  { id: 17, name: "Stables", desc: "Travel gating", tier: 2 },
  { id: 18, name: "Infirmary", desc: "Unit recovery", tier: 3 },
];

/* ─── Detail panel (shared between desktop sidebar + mobile bottom sheet) ─── */

function BuildingDetailPanel({
  selectedBuilding,
  speedupBuilding,
  buildingInfo,
  buildCostInfo,
  upgradeCostPreview,
  constructingBuildings,
  playerData,
  onBuild,
  onBuildAndSpeedup,
  onCompleteBuilding,
  onBuildingSpeedup,
  onDailyActivity,
  onClose,
}: {
  selectedBuilding: number | null;
  speedupBuilding: number | null;
  buildingInfo: any[];
  buildCostInfo: { baseCost: number; baseTimeHours: number; tier: number } | null;
  upgradeCostPreview: { level: number; cost: number }[] | null;
  constructingBuildings: any[];
  playerData: any;
  onBuild: (rp: (p: TxPhase) => void) => Promise<string>;
  onBuildAndSpeedup: (tier: number, rp: (p: TxPhase) => void) => Promise<string>;
  onCompleteBuilding: (id: number, rp: (p: TxPhase) => void) => Promise<string>;
  onBuildingSpeedup: (tier: number, rp: (p: TxPhase) => void) => Promise<string>;
  onDailyActivity: (buildingType: number, rp: (p: TxPhase) => void) => Promise<string>;
  onClose: () => void;
}) {
  const speedupTarget = speedupBuilding != null
    ? constructingBuildings.find((b) => b.id === speedupBuilding)
    : null;

  const hasContent = selectedBuilding != null || speedupTarget != null;
  if (!hasContent) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-text-muted">Select a building to view details</p>
      </div>
    );
  }

  const gemBalance = playerData?.account?.gems?.toNumber?.() ?? 0;
  const noviBalance = playerData?.account?.lockedNovi?.toNumber?.() ?? 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          {speedupTarget ? `Speed Up` : "Building Details"}
        </h3>
        <button
          onClick={onClose}
          className="hidden rounded border border-border-default px-2 py-0.5 text-xs text-text-muted hover:text-text-secondary lg:block"
        >
          Close
        </button>
      </div>

      {/* NOVI Balance */}
      {(() => {
        const cost = buildCostInfo?.baseCost ?? 0;
        const hasEnough = noviBalance >= cost;
        const deficit = cost - noviBalance;
        return (
          <div className={`rounded-lg px-3 py-2 text-xs ${hasEnough ? "bg-surface/60" : "bg-red-900/20 border border-red-800/40"}`}>
            <div className="flex items-center justify-between">
              <span className="text-zinc-500">NOVI Balance</span>
              <span className={`font-mono tabular-nums font-semibold ${hasEnough ? "text-text-gold" : "text-red-400"}`}>
                {noviBalance.toLocaleString()}
              </span>
            </div>
            {selectedBuilding != null && cost > 0 && (
              <div className="mt-0.5 flex items-center justify-between">
                <span className="text-zinc-500">Cost</span>
                <span className={`font-mono tabular-nums ${hasEnough ? "text-text-muted" : "text-red-400"}`}>
                  −{cost.toLocaleString()}
                </span>
              </div>
            )}
            {!hasEnough && cost > 0 && (
              <div className="mt-1 text-[10px] text-red-400">
                Need {deficit.toLocaleString()} more NOVI
              </div>
            )}
          </div>
        );
      })()}

      {/* Speedup: show Hasten / Rush via shared SpeedupPanel */}
      {speedupTarget && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            {speedupTarget.name}
          </h3>
          {speedupTarget.ready ? (
            <TxButton
              onClick={(rp) => onCompleteBuilding(speedupTarget.id, rp)}
              className="px-6"
            >
              Complete {speedupTarget.name}
            </TxButton>
          ) : (
            <SpeedupPanel
              visible
              inline
              remainingSeconds={speedupTarget.remainingSec}
              onSpeedup={onBuildingSpeedup}
              gemBalance={gemBalance}
              gemsPerMinute={1}
            />
          )}
        </div>
      )}

      {/* Build / Upgrade detail */}
      {selectedBuilding != null && buildCostInfo && (
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            {buildingInfo[selectedBuilding]?.status === "active" ? "Upgrade" : "Build"} — {BUILDING_TYPES[selectedBuilding]?.name}
          </h3>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div>
              <div className="text-xs text-text-muted">NOVI Cost</div>
              <div className="text-sm font-semibold text-text-gold">
                {buildCostInfo.baseCost.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-xs text-text-muted">Build Time</div>
              <div className="text-sm font-semibold text-text-secondary">
                {buildCostInfo.baseTimeHours}h
              </div>
            </div>
            <div>
              <div className="text-xs text-text-muted">Tier</div>
              <div className="text-sm font-semibold text-text-secondary">
                T{buildCostInfo.tier}
              </div>
            </div>
          </div>
          {upgradeCostPreview && (
            <div className="mb-4">
              <div className="text-[11px] text-text-muted mb-1">Upgrade costs:</div>
              <div className="flex flex-wrap gap-2">
                {upgradeCostPreview.map((u) => (
                  <div key={u.level} className="rounded border border-border-default px-2 py-1 text-center">
                    <div className="text-[11px] text-text-muted">Lv {u.level} &rarr; {u.level + 1}</div>
                    <div className="text-xs font-semibold text-text-gold">{u.cost.toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <TxButton onClick={onBuild} className="px-6 w-full">
              {buildingInfo[selectedBuilding]?.status === "active" ? "Upgrade" : "Build"} {BUILDING_TYPES[selectedBuilding]?.name}
            </TxButton>
            {buildingInfo[selectedBuilding]?.status === "active" && (
              <TxButton
                onClick={(rp) => onDailyActivity(selectedBuilding, rp)}
                variant="secondary"
                className="px-6 w-full"
              >
                Daily Activity
              </TxButton>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Main Tab ─── */

export function EstateTab() {
  const { data: playerData, isSuccess: playerReady } = usePlayer();
  const { data: estateData, isSuccess: estateReady } = useEstate();
  const { data: geData, isSuccess: geReady } = useGameEngine();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();

  const [selectedBuilding, setSelectedBuilding] = useState<number | null>(null);
  const [speedupBuilding, setSpeedupBuilding] = useState<number | null>(null);
  const player = playerData?.account;
  const estate = estateData?.account;

  const [tick, setTick] = useState(() => Math.floor(Date.now() / 1000));
  const now = tick;

  const timeInfo = useMemo(() => {
    if (!player) return null;
    const longitude = player.currentLong ?? 0;
    const tod = getCurrentTimeOfDay(now, longitude / 10000);
    return {
      name: getTimeOfDayName(tod),
      mult: getActivityMultiplier('hiring' as any, tod),
    };
  }, [player, now]);

  const travelWarning = useMemo(() => {
    if (!player) return null;
    return isTraveling(player) ? "Cannot build while traveling" : null;
  }, [player]);


  const upgradeCostPreview = useMemo(() => {
    if (selectedBuilding == null) return null;
    const building = BUILDING_TYPES[selectedBuilding];
    if (!building) return null;
    const tier = building.tier;
    const baseCost = tier === 1 ? 1_000 : tier === 2 ? 2_000 : 3_000;
    const levels = [1, 2, 3, 4, 5];
    return levels.map((lvl) => ({
      level: lvl,
      cost: calculateUpgradeCost(baseCost, lvl, 2.618),
    }));
  }, [selectedBuilding]);

  const buildingInfo = useMemo(() => {
    if (!estate) return BUILDING_TYPES.map((b) => ({ ...b, slot: null as any, status: "unbuilt" as const, level: 0, constructing: false, remainingSec: 0, ready: false }));
    return BUILDING_TYPES.map((b) => {
      const slot = findBuilding(estate, b.id);
      if (!slot || slot.status === BuildingStatus.Empty) {
        return { ...b, slot: null, status: "unbuilt" as const, level: 0, constructing: false, remainingSec: 0, ready: false };
      }
      const constructing = slot.status === BuildingStatus.Building || slot.status === BuildingStatus.Upgrading;
      const endsAt = slot.constructionEnds?.toNumber?.() ?? 0;
      const remainingSec = constructing ? Math.max(0, endsAt - tick) : 0;
      const ready = constructing && remainingSec === 0;
      const statusLabel = slot.status === BuildingStatus.Active ? "active" as const
        : slot.status === BuildingStatus.Building ? "building" as const
        : "upgrading" as const;
      return { ...b, slot, status: statusLabel, level: slot.level, constructing, remainingSec, ready };
    });
  }, [estate, tick]);

  const buildCostInfo = useMemo(() => {
    if (selectedBuilding == null) return null;
    const building = BUILDING_TYPES[selectedBuilding];
    if (!building) return null;
    const tier = building.tier;
    const baseCost = tier === 1 ? 1_000 : tier === 2 ? 2_000 : 3_000;
    const baseTimeHours = tier === 1 ? 4 : tier === 2 ? 12 : 24;
    // For upgrades, calculate actual cost based on current level (matches on-chain φ² scaling)
    const info = buildingInfo[selectedBuilding];
    const isUpgrade = info?.status === "active";
    const actualCost = isUpgrade ? calculateUpgradeCost(baseCost, info.level, 2.618) : baseCost;
    return { baseCost: actualCost, baseTimeHours, tier };
  }, [selectedBuilding, buildingInfo]);

  const handleBuildingSpeedup = useCallback(async (tier: number, reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || speedupBuilding == null) throw new Error("No building selected");
    const geKey = client.gameEngine;
    const ix = createBuildingSpeedupInstruction(
      { owner: publicKey, gameEngine: geKey },
      { buildingType: speedupBuilding, speedupTier: tier as 1 | 2 },
    );
    return transact.mutateAsync({
      instructions: [ix],
      successMessage: `${BUILDING_TYPES[speedupBuilding]?.name} construction sped up!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  }, [publicKey, speedupBuilding, client, transact]);

  const handleCompleteBuilding = useCallback(async (buildingType: number, reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const geKey = client.gameEngine;
    const ix = createCompleteBuildingInstruction(
      { owner: publicKey, gameEngine: geKey },
      { buildingType },
    );
    return transact.mutateAsync({
      instructions: [ix],
      successMessage: `${BUILDING_TYPES[buildingType]?.name} construction complete!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  }, [publicKey, client, transact]);

  const handleCreateEstate = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const [playerPda] = derivePlayerPda(ge, publicKey);
    const [estatePda] = deriveEstatePda(playerPda);
    const ix = createCreateEstateInstruction(
      { player: playerPda, estate: estatePda, gameEngine: ge, owner: publicKey },
      {}
    );
    return transact.mutateAsync({
      instructions: [ix],
      successMessage: "Estate created!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleBuildOrUpgrade = useCallback(async (reportPhase: (p: TxPhase) => void) => {
    if (selectedBuilding == null || !publicKey) throw new Error("No building selected");
    const ge = client.gameEngine;
    const info = buildingInfo[selectedBuilding];
    const isUpgrade = info?.status === "active";

    const ix = isUpgrade
      ? createUpgradeBuildingInstruction(
          { owner: publicKey, gameEngine: ge },
          { buildingType: selectedBuilding }
        )
      : createBuildBuildingInstruction(
          { player: derivePlayerPda(ge, publicKey)[0], estate: deriveEstatePda(derivePlayerPda(ge, publicKey)[0])[0], gameEngine: ge, owner: publicKey },
          { buildingType: selectedBuilding, slot: 0 }
        );

    return transact.mutateAsync({
      instructions: [ix],
      successMessage: `${isUpgrade ? "Upgrading" : "Building"} ${BUILDING_TYPES[selectedBuilding]?.name}!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  }, [selectedBuilding, publicKey, client, transact, buildingInfo]);

  const handleBuildOrUpgradeAndSpeedup = useCallback(async (tier: number, reportPhase: (p: TxPhase) => void) => {
    if (selectedBuilding == null || !publicKey) throw new Error("No building selected");
    const ge = client.gameEngine;
    const info = buildingInfo[selectedBuilding];
    const isUpgrade = info?.status === "active";

    const mainIx = isUpgrade
      ? createUpgradeBuildingInstruction(
          { owner: publicKey, gameEngine: ge },
          { buildingType: selectedBuilding }
        )
      : createBuildBuildingInstruction(
          { player: derivePlayerPda(ge, publicKey)[0], estate: deriveEstatePda(derivePlayerPda(ge, publicKey)[0])[0], gameEngine: ge, owner: publicKey },
          { buildingType: selectedBuilding, slot: 0 }
        );

    const speedupIx = createBuildingSpeedupInstruction(
      { owner: publicKey, gameEngine: ge },
      { buildingType: selectedBuilding, speedupTier: tier as 1 | 2 },
    );
    return transact.mutateAsync({
      instructions: [mainIx, speedupIx],
      successMessage: `${isUpgrade ? "Upgrading" : "Building"} ${BUILDING_TYPES[selectedBuilding]?.name} (sped up)!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  }, [selectedBuilding, publicKey, client, transact, buildingInfo]);

  // A building's daily mini-game — the score is game_authority-co-signed.
  const handleDailyActivity = async (
    buildingType: number,
    reportPhase: (p: TxPhase) => void,
  ) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const versionedTx = await requestCoSign("/api/cosign/estate/daily-activity", {
      owner: publicKey.toBase58(),
      buildingType,
    });
    return transact.mutateAsync({
      versionedTx,
      invalidateKeys: [["estate"], ["player"]],
      successMessage: "Daily activity complete!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  // Plot costs: φ² scaling from 100k base
  const PLOT_COSTS = [0, 10_000, 26_200, 68_500, 179_400]; // index = plotsOwned (0 unused, costs for plots 2-5)
  const plotsOwned = estate?.plotsOwned ?? 1;
  const maxSlots = plotsOwned * 4;
  const canBuyPlot = plotsOwned < 5;
  const nextPlotCost = canBuyPlot ? PLOT_COSTS[plotsOwned] ?? 0 : 0;

  const handleBuyPlot = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createBuyPlotInstruction({ owner: publicKey, gameEngine: ge });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["estate"], ["player"]],
      successMessage: `Purchased plot ${plotsOwned + 1}! +4 building slots unlocked.`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const constructingBuildings = buildingInfo.filter((b) => b.constructing);
  const activeBuildings = buildingInfo.filter((b) => b.status === "active");
  const unbuiltBuildings = buildingInfo.filter((b) => b.status === "unbuilt");

  useEffect(() => {
    if (constructingBuildings.length === 0) return;
    const interval = setInterval(() => {
      setTick(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [constructingBuildings.length]);

  useEffect(() => {
    if (speedupBuilding != null && !constructingBuildings.some((b) => b.id === speedupBuilding)) {
      setSpeedupBuilding(null);
    }
  }, [speedupBuilding, constructingBuildings]);

  const closePanel = useCallback(() => {
    setSelectedBuilding(null);
    setSpeedupBuilding(null);
  }, []);

  const panelOpen = selectedBuilding != null || (speedupBuilding != null && constructingBuildings.some((b) => b.id === speedupBuilding));

  const detailPanelProps = {
    selectedBuilding,
    speedupBuilding,
    buildingInfo,
    buildCostInfo,
    upgradeCostPreview,
    constructingBuildings,
    playerData,
    onBuild: handleBuildOrUpgrade,
    onBuildAndSpeedup: handleBuildOrUpgradeAndSpeedup,
    onCompleteBuilding: handleCompleteBuilding,
    onBuildingSpeedup: handleBuildingSpeedup,
    onDailyActivity: handleDailyActivity,
    onClose: closePanel,
  };

  return (
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

      {/* Estate exists — 2-column on desktop */}
      {estateData?.exists && (
        <>
          {/* Top bar */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-6 text-sm">
              <div>
                <span className="text-text-muted">Level </span>
                <span className="font-semibold text-text-primary">{estate?.estateLevel ?? 0}</span>
              </div>
              <div>
                <span className="text-text-muted">Plots </span>
                <span className="font-semibold text-text-primary">{plotsOwned}</span>
                <span className="text-text-muted">/5</span>
              </div>
              <div>
                <span className="text-text-muted">Slots </span>
                <span className="font-semibold text-text-primary">{activeBuildings.length + constructingBuildings.length}</span>
                <span className="text-text-muted">/{maxSlots}</span>
              </div>
              {timeInfo && (
                <div>
                  <span className="text-text-muted">{timeInfo.name}</span>
                  {timeInfo.mult !== 1 && (
                    <span className={`ml-1 text-xs ${timeInfo.mult > 1 ? "text-green-600" : "text-amber-600"}`}>
                      ({timeInfo.mult > 1 ? `-${((timeInfo.mult - 1) * 100).toFixed(0)}%` : `+${((1 - timeInfo.mult) / timeInfo.mult * 100).toFixed(0)}%`} cost)
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="ml-auto flex items-center gap-2">
              {canBuyPlot && (
                <TxButton onClick={handleBuyPlot} variant="secondary" className="text-xs px-4">
                  Buy Plot ({(nextPlotCost / 1000).toFixed(0)}k NOVI)
                </TxButton>
              )}
            </div>
          </div>

          {/* Main area: left grid + right detail */}
          <div className="min-h-0 flex-1 grid grid-cols-1 lg:grid-cols-3 gap-3 overflow-hidden">
            {/* Left — building grids (scrollable) */}
            <div className="lg:col-span-2 overflow-y-auto space-y-4">
              {/* Under Construction */}
              {constructingBuildings.length > 0 && (
                <div>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Under Construction</h2>
                  <div className="grid gap-2 grid-cols-1 md:grid-cols-2">
                    {constructingBuildings.map((b) => {
                      const mins = Math.floor(b.remainingSec / 60);
                      const hrs = Math.floor(mins / 60);
                      const timeStr = hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`;
                      const pct = b.slot ? (() => {
                        const started = b.slot.constructionStarted?.toNumber?.() ?? 0;
                        const ends = b.slot.constructionEnds?.toNumber?.() ?? 0;
                        const total = ends - started;
                        return total > 0 ? Math.min(100, Math.round(((total - b.remainingSec) / total) * 100)) : 0;
                      })() : 0;
                      return (
                        <div
                          key={b.id}
                          className="relative overflow-hidden rounded-lg border border-amber-700/60 bg-surface-raised p-3"
                        >
                          <div
                            className="absolute inset-y-0 left-0 bg-amber-900/20"
                            style={{ width: `${pct}%` }}
                          />
                          <div className="relative flex items-center justify-between">
                            <div>
                              <div className="text-sm font-semibold text-text-primary">
                                {b.name}
                                <span className="ml-2 text-xs text-text-muted">
                                  {b.status === "upgrading" ? `Lv ${b.level} upgrading` : "Building"}
                                </span>
                              </div>
                              <div className="text-xs text-amber-600 font-mono tabular-nums">
                                {b.remainingSec > 0 ? `${timeStr} remaining (${pct}%)` : "Ready to complete"}
                              </div>
                            </div>
                            <div className="flex gap-1">
                              {b.ready ? (
                                <TxButton
                                  onClick={(rp) => handleCompleteBuilding(b.id, rp)}
                                  className="px-3 py-1 text-[11px]"
                                >
                                  Complete
                                </TxButton>
                              ) : (
                                <button
                                  onClick={() => { setSpeedupBuilding(b.id); setSelectedBuilding(null); }}
                                  className="rounded border border-amber-700/50 px-2 py-1 text-[11px] font-medium text-amber-600 hover:bg-amber-900/20"
                                >
                                  Speed Up
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Built Buildings */}
              {activeBuildings.length > 0 && (
                <div>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Built ({activeBuildings.length})
                  </h2>
                  <div className="grid gap-2 grid-cols-2 md:grid-cols-3">
                    {activeBuildings.map((b) => (
                      <button
                        key={b.id}
                        onClick={() => { setSelectedBuilding(b.id); setSpeedupBuilding(null); }}
                        className={`rounded-lg border p-3 text-left transition-colors ${
                          selectedBuilding === b.id
                            ? "border-amber-600 bg-amber-900/20"
                            : "border-border-default hover:border-amber-800/40"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-text-primary">{b.name}</span>
                          <span className="rounded bg-surface-overlay px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-text-secondary">
                            Lv {b.level}
                          </span>
                        </div>
                        <div className="text-xs text-text-muted">{b.desc}</div>
                        {b.slot && b.slot.totalNoviInvested && (
                          <div className="mt-1 text-[11px] text-text-muted tabular-nums">
                            {(b.slot.totalNoviInvested.toNumber?.() ?? 0).toLocaleString()} invested
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Available to Build */}
              {unbuiltBuildings.length > 0 && (
                <div>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Available to Build ({unbuiltBuildings.length})
                  </h2>
                  <div className="grid gap-2 grid-cols-2 md:grid-cols-3">
                    {unbuiltBuildings.map((b) => (
                      <button
                        key={b.id}
                        onClick={() => { setSelectedBuilding(b.id); setSpeedupBuilding(null); }}
                        className={`rounded-lg border p-3 text-left transition-colors ${
                          selectedBuilding === b.id
                            ? "border-amber-600 bg-amber-900/20"
                            : "border-border-default opacity-60 hover:opacity-80 hover:border-border-default"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-text-primary">{b.name}</span>
                          <span className={`text-[11px] font-bold ${
                            b.tier === 3 ? "text-amber-500" : b.tier === 2 ? "text-text-gold" : "text-text-muted"
                          }`}>
                            T{b.tier}
                          </span>
                        </div>
                        <div className="text-xs text-text-muted">{b.desc}</div>
                        <div className="mt-1 text-[11px] font-semibold text-text-muted">
                          {b.tier === 1 ? "1k" : b.tier === 2 ? "2k" : "3k"} NOVI
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Game Parameters */}
              {geData?.account && (() => {
                const gp = geData.account.gameplayConfig;
                return (
                  <GameInfoPanel>
                    <InfoGrid items={[
                      { label: "Happy Abandon", value: bpsToPercent(gp.abandonRateHappy), highlight: true },
                      { label: "Content Abandon", value: bpsToPercent(gp.abandonRateContent) },
                      { label: "Unhappy Abandon", value: bpsToPercent(gp.abandonRateUnhappy) },
                      { label: "Miserable Abandon", value: bpsToPercent(gp.abandonRateMiserable) },
                      { label: "Dmg Redist T1→T2", value: bpsToPercent(gp.damageRedistribUnit1ToUnit2) },
                      { label: "Dmg Redist T1→T3", value: bpsToPercent(gp.damageRedistribUnit1ToUnit3) },
                      { label: "Dmg Redist T3→T1", value: bpsToPercent(gp.damageRedistribUnit3ToUnit1) },
                      { label: "Dmg Redist T3→T2", value: bpsToPercent(gp.damageRedistribUnit3ToUnit2) },
                    ]} />
                  </GameInfoPanel>
                );
              })()}
            </div>

            <DetailPanel open={panelOpen} onClose={closePanel}>
              <BuildingDetailPanel {...detailPanelProps} />
            </DetailPanel>
          </div>
        </>
      )}
    </div>
  );
}
