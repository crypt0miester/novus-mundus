"use client";

import { useState, useMemo } from "react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useEstate } from "@/lib/hooks/useEstate";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { SpeedupPanel } from "@/components/shared/SpeedupPanel";
import { GameInfoPanel } from "@/components/shared/GameInfoPanel";
import { InfoGrid } from "@/components/shared/InfoGrid";
import { bpsToPercent } from "@/lib/utils";
import {
  derivePlayerPda,
  deriveEstatePda,
  createCreateEstateInstruction,
  createBuildBuildingInstruction,
  createBuildingSpeedupInstruction,
  createDailyActivityInstruction,
  createRecoverTroopsInstruction,
  createConvertMaterialsInstruction,
  calculateUpgradeCost,
  calculateRecoveryCost,
  getCurrentTimeOfDay,
  getTimeOfDayName,
  getActivityMultiplier,
  isTraveling,
} from "@/lib/sdk";

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

export function EstateTab() {
  const { data: playerData, isSuccess: playerReady } = usePlayer();
  const { data: estateData, isSuccess: estateReady } = useEstate();
  const { data: geData, isSuccess: geReady } = useGameEngine();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();

  const [selectedBuilding, setSelectedBuilding] = useState<number | null>(null);
  const [speedupBuilding, setSpeedupBuilding] = useState<number | null>(null);
  const [recoverUnitType, setRecoverUnitType] = useState(0);
  const [recoverAmount, setRecoverAmount] = useState(1);
  const [convertFromTier, setConvertFromTier] = useState(0);
  const [convertAmount, setConvertAmount] = useState(1);

  const player = playerData?.account;
  const estate = estateData?.account;

  // Time-of-day indicator
  const now = Math.floor(Date.now() / 1000);
  const timeInfo = useMemo(() => {
    if (!player) return null;
    const longitude = player.currentLong ?? 0;
    const tod = getCurrentTimeOfDay(now, longitude / 10000);
    return {
      name: getTimeOfDayName(tod),
      mult: getActivityMultiplier('hiring' as any, tod),
    };
  }, [player, now]);

  // Traveling warning
  const travelWarning = useMemo(() => {
    if (!player) return null;
    return isTraveling(player) ? "Cannot build while traveling" : null;
  }, [player]);

  // Build cost for newly selected building (level 0 -> 1)
  const buildCostInfo = useMemo(() => {
    if (selectedBuilding == null) return null;
    const building = BUILDING_TYPES[selectedBuilding];
    if (!building) return null;
    const tier = building.tier;
    const baseCost = tier === 1 ? 10_000 : tier === 2 ? 50_000 : 200_000;
    const baseTimeHours = tier === 1 ? 4 : tier === 2 ? 12 : 24;
    return { baseCost, baseTimeHours, tier };
  }, [selectedBuilding]);

  // Upgrade cost preview (simulated for levels 1-5)
  const upgradeCostPreview = useMemo(() => {
    if (selectedBuilding == null) return null;
    const building = BUILDING_TYPES[selectedBuilding];
    if (!building) return null;
    const tier = building.tier;
    const baseCost = tier === 1 ? 10_000 : tier === 2 ? 50_000 : 200_000;
    // Show cost for levels 1->2, 2->3, 3->4 using phi-squared scaling
    const levels = [1, 2, 3, 4, 5];
    return levels.map((lvl) => ({
      level: lvl,
      cost: calculateUpgradeCost(baseCost, lvl, 2.618),
    }));
  }, [selectedBuilding]);

  const WOUNDED_UNITS = [
    { type: 0, label: "Infantry", field: "woundedDef1" as const },
    { type: 1, label: "Cavalry", field: "woundedDef2" as const },
    { type: 2, label: "Siege", field: "woundedDef3" as const },
    { type: 3, label: "Laborer", field: "woundedOp1" as const },
    { type: 4, label: "Artisan", field: "woundedOp2" as const },
    { type: 5, label: "Engineer", field: "woundedOp3" as const },
  ];

  const woundedCounts = useMemo(() => {
    if (!estate) return WOUNDED_UNITS.map((u) => ({ ...u, count: 0 }));
    return WOUNDED_UNITS.map((u) => ({ ...u, count: estate[u.field] ?? 0 }));
  }, [estate]);

  const totalWounded = woundedCounts.reduce((sum, u) => sum + u.count, 0);

  const selectedWoundedMax = woundedCounts[recoverUnitType]?.count ?? 0;

  const recoveryCostPreview = useMemo(() => {
    if (!geData?.account || recoverAmount <= 0) return null;
    const ec = geData.account.economicConfig;
    const baseCosts = [
      ec.defensiveUnit1Cost, ec.defensiveUnit2Cost, ec.defensiveUnit3Cost,
      ec.operativeUnit1Cost, ec.operativeUnit2Cost, ec.operativeUnit3Cost,
    ];
    const baseCost = baseCosts[recoverUnitType]?.toNumber() ?? 0;
    // Infirmary level discount: 25 bps per level
    let infirmaryLevelDiscount = 0;
    if (estate) {
      const infirmaryBuilding = estate.buildings.find((b: any) => b.buildingType === 18 && b.level > 0);
      if (infirmaryBuilding) {
        infirmaryLevelDiscount = infirmaryBuilding.level * 25;
      }
    }
    const dailyBps = estate?.infirmaryRecoveryDailyBps ?? 0;
    return calculateRecoveryCost(baseCost, infirmaryLevelDiscount, dailyBps, recoverAmount);
  }, [geData, recoverUnitType, recoverAmount, estate]);

  const handleRecoverTroops = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    if (recoverAmount <= 0 || recoverAmount > selectedWoundedMax) {
      throw new Error("Invalid recovery amount");
    }
    const ge = client.gameEngine;
    const ix = createRecoverTroopsInstruction(
      { owner: publicKey, gameEngine: ge },
      { unitType: recoverUnitType, amount: recoverAmount }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["estate"], ["player"]],
      successMessage: `Recovered ${recoverAmount} ${WOUNDED_UNITS[recoverUnitType]?.label}!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleBuildingSpeedup = async (tier: number, reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || speedupBuilding == null) throw new Error("No building selected");
    const geKey = client.gameEngine;
    const ix = createBuildingSpeedupInstruction(
      { owner: publicKey, gameEngine: geKey },
      { buildingType: speedupBuilding, speedupTier: tier as 1 | 2 },
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["estate"], ["player"]],
      successMessage: `${BUILDING_TYPES[speedupBuilding]?.name} construction sped up!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

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
      invalidateKeys: [["estate"], ["player"]],
      successMessage: "Estate created!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleBuild = async (reportPhase: (p: TxPhase) => void) => {
    if (selectedBuilding == null || !publicKey) throw new Error("No building selected");
    const ge = client.gameEngine;
    const [playerPda] = derivePlayerPda(ge, publicKey);
    const [estatePda] = deriveEstatePda(playerPda);
    const ix = createBuildBuildingInstruction(
      { player: playerPda, estate: estatePda, gameEngine: ge, owner: publicKey },
      { buildingType: selectedBuilding, slot: 0 }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["estate"], ["player"]],
      successMessage: `Building ${BUILDING_TYPES[selectedBuilding]?.name}!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleBuildAndSpeedup = async (tier: number, reportPhase: (p: TxPhase) => void) => {
    if (selectedBuilding == null || !publicKey) throw new Error("No building selected");
    const ge = client.gameEngine;
    const [playerPda] = derivePlayerPda(ge, publicKey);
    const [estatePda] = deriveEstatePda(playerPda);
    const buildIx = createBuildBuildingInstruction(
      { player: playerPda, estate: estatePda, gameEngine: ge, owner: publicKey },
      { buildingType: selectedBuilding, slot: 0 }
    );
    const speedupIx = createBuildingSpeedupInstruction(
      { owner: publicKey, gameEngine: ge },
      { buildingType: selectedBuilding, speedupTier: tier as 1 | 2 },
    );
    return transact.mutateAsync({
      instructions: [buildIx, speedupIx],
      invalidateKeys: [["estate"], ["player"]],
      successMessage: `Building ${BUILDING_TYPES[selectedBuilding]?.name} (sped up)!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleDailyActivity = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const [playerPda] = derivePlayerPda(ge, publicKey);
    const [estatePda] = deriveEstatePda(playerPda);
    const ix = createDailyActivityInstruction(
      { player: playerPda, estate: estatePda, gameEngine: ge, owner: publicKey },
      {}
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["estate"], ["player"]],
      successMessage: "Daily activity claimed!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const MATERIAL_TIERS = [
    { id: 0, name: "Common", field: "commonMaterials" as const },
    { id: 1, name: "Uncommon", field: "uncommonMaterials" as const },
    { id: 2, name: "Rare", field: "rareMaterials" as const },
    { id: 3, name: "Epic", field: "epicMaterials" as const },
  ];

  const handleConvertMaterials = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createConvertMaterialsInstruction(
      { owner: publicKey, gameEngine: ge },
      { fromTier: convertFromTier, conversions: convertAmount },
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["estate"], ["player"]],
      successMessage: `Converted ${convertAmount * 100} ${MATERIAL_TIERS[convertFromTier]?.name} to ${convertAmount * 20} ${MATERIAL_TIERS[convertFromTier + 1]?.name}!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  return (
    <div className="space-y-6">
      {travelWarning && (
        <div className="rounded-lg border border-amber-800/50 bg-amber-900/20 p-3 text-sm text-amber-300">
          {travelWarning}
        </div>
      )}

      {/* No estate yet */}
      {!estateData?.exists && estateReady && (
        <div className="card accent-border text-center">
          <p className="mb-4 text-text-secondary">
            You haven't established your estate yet. Build your domain!
          </p>
          <TxButton onClick={handleCreateEstate}>Establish Estate</TxButton>
        </div>
      )}

      {/* Estate exists */}
      {estateData?.exists && (
        <>
          {/* Estate Overview */}
          <div className="card accent-border">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div>
                <div className="text-xs text-text-muted">Status</div>
                <div className="text-sm font-semibold text-text-gold">Active</div>
              </div>
              {timeInfo && (
                <div>
                  <div className="text-xs text-text-muted">Time of Day</div>
                  <div className="text-sm font-semibold text-text-secondary">{timeInfo.name}</div>
                  {timeInfo.mult > 1 && (
                    <div className="text-[11px] text-green-400">
                      Cost bonus: {((timeInfo.mult - 1) * 100).toFixed(0)}% off
                    </div>
                  )}
                  {timeInfo.mult < 1 && (
                    <div className="text-[11px] text-amber-400">
                      Cost premium: +{((1 - timeInfo.mult) / timeInfo.mult * 100).toFixed(0)}%
                    </div>
                  )}
                </div>
              )}
              <div>
                <TxButton onClick={handleDailyActivity} variant="secondary" className="text-xs w-full">
                  Daily Claim
                </TxButton>
              </div>
            </div>
          </div>

          {/* Building Grid */}
          <div>
            <h2 className="mb-3 text-lg font-semibold text-text-primary">Buildings</h2>
            <div className="grid gap-2 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {BUILDING_TYPES.map((building) => (
                <button
                  key={building.id}
                  onClick={() => setSelectedBuilding(building.id)}
                  className={`rounded-lg border p-3 text-left transition-all ${
                    selectedBuilding === building.id
                      ? "border-amber-600 bg-amber-900/20"
                      : "border-zinc-800 hover:border-zinc-700"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-text-primary">{building.name}</div>
                    <span className={`text-[11px] ${
                      building.tier === 3 ? "text-amber-400" : building.tier === 2 ? "text-text-gold" : "text-text-muted"
                    }`}>
                      T{building.tier}
                    </span>
                  </div>
                  <div className="text-xs text-text-muted">{building.desc}</div>
                  <div className="text-[11px] text-text-muted mt-1">
                    {building.tier === 1 ? "10k" : building.tier === 2 ? "50k" : "200k"} NOVI
                  </div>
                </button>
              ))}
            </div>
          </div>

          {selectedBuilding != null && buildCostInfo && (
            <div className="card">
              {/* Build cost preview */}
              <div className="mb-4 space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Build Cost — {BUILDING_TYPES[selectedBuilding]?.name}
                </h3>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  <div>
                    <div className="text-xs text-text-muted">NOVI Cost</div>
                    <div className="text-sm font-semibold text-text-gold">
                      {buildCostInfo.baseCost.toLocaleString()} NOVI
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
                    <div className={`text-sm font-semibold ${
                      buildCostInfo.tier === 3 ? "text-amber-400" : buildCostInfo.tier === 2 ? "text-text-gold" : "text-text-secondary"
                    }`}>
                      Tier {buildCostInfo.tier}
                    </div>
                  </div>
                </div>
                {/* Upgrade cost preview */}
                {upgradeCostPreview && (
                  <div className="mt-3">
                    <div className="text-[11px] text-text-muted mb-1">Upgrade Cost Preview (next levels):</div>
                    <div className="flex flex-wrap gap-2">
                      {upgradeCostPreview.map((u) => (
                        <div key={u.level} className="rounded border border-zinc-800 px-2 py-1 text-center">
                          <div className="text-[11px] text-text-muted">Lv {u.level} &rarr; {u.level + 1}</div>
                          <div className="text-xs font-semibold text-text-gold">{u.cost.toLocaleString()}</div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-1 text-[11px] text-text-muted">
                      Cost scales by phi-squared (2.618x) per level
                    </div>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <TxButton onClick={handleBuild} className="px-6">
                  Build {BUILDING_TYPES[selectedBuilding]?.name}
                </TxButton>
                <TxButton
                  onClick={(rp) => handleBuildAndSpeedup(1, rp)}
                  variant="secondary"
                  className="text-xs"
                >
                  Build &amp; Hasten (50% faster, costs gems)
                </TxButton>
                <TxButton
                  onClick={(rp) => handleBuildAndSpeedup(2, rp)}
                  variant="secondary"
                  className="text-xs"
                >
                  Build &amp; Rush (75% faster, costs gems)
                </TxButton>
              </div>
            </div>
          )}

          {/* Building Speedup */}
          <div className="card">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Speed Up Construction
            </h3>
            <p className="mb-3 text-xs text-text-secondary">
              Select a building under construction to speed up.
            </p>
            <div className="mb-4 grid gap-2 grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {BUILDING_TYPES.map((building) => (
                <button
                  key={building.id}
                  onClick={() => setSpeedupBuilding(building.id)}
                  className={`rounded-lg border p-2 text-center text-xs transition-all ${
                    speedupBuilding === building.id
                      ? "border-amber-600 bg-amber-900/20"
                      : "border-zinc-800 hover:border-zinc-700"
                  }`}
                >
                  {building.name}
                </button>
              ))}
            </div>
            {speedupBuilding != null && (
              <SpeedupPanel
                visible
                remainingSeconds={3600}
                onSpeedup={handleBuildingSpeedup}
                gemsPerMinute={1}
                gemBalance={playerData?.account?.gems?.toNumber?.()}
              />
            )}
          </div>

          {/* Infirmary — Troop Recovery */}
          <div className="card">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Infirmary
            </h3>
            {totalWounded === 0 ? (
              <p className="text-sm text-text-muted">No wounded units to recover.</p>
            ) : (
              <div className="space-y-4">
                {/* Wounded overview */}
                <div className="grid gap-2 grid-cols-3 md:grid-cols-6">
                  {woundedCounts.map((u) => (
                    <button
                      key={u.type}
                      onClick={() => {
                        setRecoverUnitType(u.type);
                        setRecoverAmount(Math.min(recoverAmount, u.count || 1));
                      }}
                      disabled={u.count === 0}
                      className={`rounded-lg border p-3 text-center transition-all ${
                        recoverUnitType === u.type && u.count > 0
                          ? "border-red-600 bg-red-900/20"
                          : u.count > 0
                            ? "border-zinc-800 hover:border-zinc-700"
                            : "border-zinc-900 opacity-40"
                      }`}
                    >
                      <div className="text-xs text-text-muted">{u.label}</div>
                      <div className={`text-lg font-semibold ${u.count > 0 ? "text-red-400" : "text-text-muted"}`}>
                        {u.count.toLocaleString()}
                      </div>
                    </button>
                  ))}
                </div>

                {/* Recovery controls */}
                {selectedWoundedMax > 0 && (
                  <div className="rounded-lg border border-zinc-800 bg-surface/50 p-4 space-y-3">
                    <div className="flex items-center gap-4">
                      <div>
                        <label className="mb-1 block text-xs text-text-muted">
                          Recover {woundedCounts[recoverUnitType]?.label}
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={recoverAmount}
                            onChange={(e) => setRecoverAmount(
                              Math.max(1, Math.min(selectedWoundedMax, parseInt(e.target.value) || 1))
                            )}
                            className="w-24 rounded border border-zinc-700 bg-surface px-2 py-1 text-sm text-text-primary"
                            min={1}
                            max={selectedWoundedMax}
                          />
                          <button
                            onClick={() => setRecoverAmount(selectedWoundedMax)}
                            className="rounded border border-zinc-700 px-2 py-1 text-xs text-text-muted hover:text-text-secondary"
                          >
                            Max ({selectedWoundedMax.toLocaleString()})
                          </button>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-text-muted">Est. Cost</div>
                        <div className="text-sm font-semibold text-text-gold">
                          {recoveryCostPreview != null ? recoveryCostPreview.toLocaleString() : "—"} NOVI
                        </div>
                        <div className="text-[11px] text-text-muted">
                          50% of hire cost{estate?.infirmaryRecoveryDailyBps ? ` + ${bpsToPercent(estate.infirmaryRecoveryDailyBps)} daily buff` : ""}
                        </div>
                      </div>
                    </div>
                    <TxButton
                      onClick={handleRecoverTroops}
                      disabled={recoverAmount <= 0 || recoverAmount > selectedWoundedMax}
                      className="w-full"
                    >
                      Recover {recoverAmount} {woundedCounts[recoverUnitType]?.label}
                    </TxButton>
                  </div>
                )}
              </div>
            )}
          </div>
          {/* Convert Materials */}
          <div className="card">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Convert Materials
            </h3>
            <p className="mb-3 text-xs text-text-muted">
              Convert 100 lower-tier materials into 20 higher-tier materials per conversion.
            </p>
            {/* Current material counts */}
            {player && (
              <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
                {[
                  { name: "Common", val: player.commonMaterials?.toNumber?.() ?? 0 },
                  { name: "Uncommon", val: player.uncommonMaterials?.toNumber?.() ?? 0 },
                  { name: "Rare", val: player.rareMaterials?.toNumber?.() ?? 0 },
                  { name: "Epic", val: player.epicMaterials?.toNumber?.() ?? 0 },
                  { name: "Legendary", val: player.legendaryMaterials?.toNumber?.() ?? 0 },
                ].map((m) => (
                  <div key={m.name} className="rounded border border-zinc-800 p-2 text-center">
                    <div className="text-[11px] text-text-muted">{m.name}</div>
                    <div className="text-sm font-semibold text-text-gold">{m.val.toLocaleString()}</div>
                  </div>
                ))}
              </div>
            )}
            {/* From tier selector */}
            <div className="mb-3">
              <div className="text-xs text-text-muted mb-2">Convert From:</div>
              <div className="flex gap-2">
                {MATERIAL_TIERS.map((tier) => (
                  <button
                    key={tier.id}
                    onClick={() => setConvertFromTier(tier.id)}
                    className={`rounded-lg border px-3 py-2 text-sm transition-all ${
                      convertFromTier === tier.id
                        ? "border-amber-600 bg-amber-900/20 text-text-gold"
                        : "border-zinc-800 text-text-muted hover:border-zinc-700"
                    }`}
                  >
                    {tier.name}
                  </button>
                ))}
              </div>
              <div className="mt-1 text-[11px] text-text-muted">
                {MATERIAL_TIERS[convertFromTier]?.name} &rarr; {MATERIAL_TIERS[convertFromTier + 1]?.name ?? "Legendary"}
              </div>
            </div>
            {/* Amount */}
            <div className="flex items-center gap-4">
              <label className="text-sm text-text-muted">Conversions:</label>
              <input
                type="number"
                value={convertAmount}
                onChange={(e) => setConvertAmount(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-24 rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm text-text-primary"
                min={1}
              />
              <div className="text-xs text-text-muted">
                = {(convertAmount * 100).toLocaleString()} {MATERIAL_TIERS[convertFromTier]?.name} &rarr; {(convertAmount * 20).toLocaleString()} {MATERIAL_TIERS[convertFromTier + 1]?.name ?? "Legendary"}
              </div>
            </div>
            <div className="mt-3">
              <TxButton onClick={handleConvertMaterials}>
                Convert Materials
              </TxButton>
            </div>
          </div>
        </>
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
  );
}
