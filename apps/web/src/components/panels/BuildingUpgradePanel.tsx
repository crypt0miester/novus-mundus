"use client";

import { useMemo, useState, useCallback, useEffect } from "react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useEstate } from "@/lib/hooks/useEstate";
import { useEstateActions } from "@/lib/hooks/useEstateActions";
import { useRightPanelStore } from "@/lib/store/right-panel";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { SpeedupPanel } from "@/components/shared/SpeedupPanel";
import { BUILDING_FEATURE_MAP } from "@/lib/config/building-features";
import { findBuilding } from "novus-mundus-sdk";
import { buildingPhase } from "@/lib/narrative";

/** Renders in the right panel when a building is selected for build/upgrade/speedup. */
export function BuildingUpgradePanel({
  buildingId,
  mode,
}: {
  buildingId: number;
  mode: "detail" | "speedup";
}) {
  const { data: playerData } = usePlayer();
  const { data: estateData } = useEstate();
  const close = useRightPanelStore((s) => s.close);
  const estate = estateData?.account;

  const {
    handleBuildOrUpgrade,
    handleBuildingSpeedup,
    handleCompleteBuilding,
    getBuildCostInfo,
    getUpgradeCostPreview,
  } = useEstateActions();

  const config = BUILDING_FEATURE_MAP.get(buildingId);
  const slot = estate ? findBuilding(estate, buildingId) : null;

  const [tick, setTick] = useState(() => Math.floor(Date.now() / 1000));
  const phase = buildingPhase(slot, tick);
  const isConstructing =
    phase === "rising" ||
    phase === "raised" ||
    phase === "improving" ||
    phase === "improved";
  useEffect(() => {
    if (!isConstructing) return;
    const interval = setInterval(() => setTick(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(interval);
  }, [isConstructing]);

  const remainingSec = isConstructing
    ? Math.max(0, (slot?.constructionEnds?.toNumber?.() ?? 0) - tick)
    : 0;
  const ready = phase === "raised" || phase === "improved";

  const noviBalance = playerData?.account?.lockedNovi?.toNumber?.() ?? 0;
  const gemBalance = playerData?.account?.gems?.toNumber?.() ?? 0;

  const costInfo = useMemo(() => getBuildCostInfo(buildingId), [getBuildCostInfo, buildingId]);
  const costPreview = useMemo(
    () => getUpgradeCostPreview(buildingId),
    [getUpgradeCostPreview, buildingId]
  );

  const cost = costInfo?.baseCost ?? 0;
  const hasEnough = noviBalance >= cost;
  const deficit = cost - noviBalance;

  if (!config) return null;

  // ── Speedup mode ──
  if (mode === "speedup" && isConstructing) {
    return (
      <div className="flex flex-col gap-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Speed Up {config.name}
        </h3>

        {ready ? (
          <TxButton
            onClick={(rp) => handleCompleteBuilding(buildingId, rp)}
            className="px-6 w-full"
          >
            Complete {config.name}
          </TxButton>
        ) : (
          <SpeedupPanel
            visible
            inline
            remainingSeconds={remainingSec}
            onSpeedup={(tier, rp) => handleBuildingSpeedup(buildingId, tier, rp)}
            gemBalance={gemBalance}
            gemsPerMinute={1}
          />
        )}
      </div>
    );
  }

  // ── Detail / build / upgrade mode ──
  const isUpgrade = costInfo?.isUpgrade ?? false;

  return (
    <div className="flex flex-col gap-4">
      {/* NOVI Balance */}
      <div
        className={`rounded-lg px-3 py-2 text-xs ${
          hasEnough ? "bg-surface/60" : "bg-red-900/20 border border-red-800/40"
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="text-zinc-500">NOVI Balance</span>
          <span
            className={`font-mono tabular-nums font-semibold ${
              hasEnough ? "text-text-gold" : "text-red-400"
            }`}
          >
            {noviBalance.toLocaleString()}
          </span>
        </div>
        {cost > 0 && (
          <div className="mt-0.5 flex items-center justify-between">
            <span className="text-zinc-500">Cost</span>
            <span
              className={`font-mono tabular-nums ${
                hasEnough ? "text-text-muted" : "text-red-400"
              }`}
            >
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

      {/* Build / Upgrade detail */}
      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
          {isUpgrade ? "Upgrade" : "Build"} — {config.name}
        </h3>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div>
            <div className="text-xs text-text-muted">NOVI Cost</div>
            <div className="text-sm font-semibold text-text-gold">
              {cost.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-xs text-text-muted">Build Time</div>
            <div className="text-sm font-semibold text-text-secondary">
              {costInfo?.baseTimeHours ?? 0}h
            </div>
          </div>
          <div>
            <div className="text-xs text-text-muted">Tier</div>
            <div className="text-sm font-semibold text-text-secondary">
              T{costInfo?.tier ?? 0}
            </div>
          </div>
        </div>

        {/* Upgrade cost preview */}
        {costPreview && (
          <div className="mb-4">
            <div className="text-[11px] text-text-muted mb-1">Upgrade costs:</div>
            <div className="flex flex-wrap gap-2">
              {costPreview.map((u) => (
                <div
                  key={u.level}
                  className="rounded border border-border-default px-2 py-1 text-center"
                >
                  <div className="text-[11px] text-text-muted">
                    Lv {u.level} &rarr; {u.level + 1}
                  </div>
                  <div className="text-xs font-semibold text-text-gold">
                    {u.cost.toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <TxButton
          onClick={(rp) => handleBuildOrUpgrade(buildingId, rp)}
          className="px-6 w-full"
        >
          {isUpgrade ? "Upgrade" : "Build"} {config.name}
        </TxButton>
      </div>
    </div>
  );
}
