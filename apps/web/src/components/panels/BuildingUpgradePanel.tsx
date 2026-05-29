"use client";

import { useMemo, useState, useEffect } from "react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useEstate } from "@/lib/hooks/useEstate";
import { useEstateActions } from "@/lib/hooks/useEstateActions";
import { useMorphActions } from "@/lib/hooks/useMorphActions";
import type { PanelAction } from "@/lib/store/right-panel";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { SpeedupPanel, maxSpeedupCount } from "@/components/shared/SpeedupPanel";
import { GoldCountdown } from "@/components/shared/GoldCountdown";
import { cn, formatNumber } from "@/lib/utils";
import { BUILDING_FEATURE_MAP } from "@/lib/config/building-features";
import { deciToNovi, findBuilding, formatNoviAmount } from "novus-mundus-sdk";
import { buildingFraming, buildingPhase } from "@/lib/narrative";
import { GameIcon } from "../shared/GameIcon";

/** Hours to compact "4h" / "10.5h" string. */
function fmtHours(h: number): string {
  return `${h < 10 ? h.toFixed(1) : Math.round(h)}h`;
}

/**
 * Renders in the right panel when a building is selected. The view follows the
 * building's live phase: a building under construction shows speed-up /
 * complete, anything else shows build / upgrade. Costs are read live from the
 * on-chain BuildingTemplate config (see useEstateActions).
 */
export function BuildingUpgradePanel({ buildingId }: { buildingId: number }) {
  const { data: playerData } = usePlayer();
  const { data: estateData } = useEstate();
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
    phase === "rising" || phase === "raised" || phase === "improving" || phase === "improved";
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

  // Speedup tiers with hold-to-charge caps — how many speedup instructions one
  // tx can usefully hold (timer-collapse ∧ gem affordability). Recomputed each
  // tick as the construction timer counts down.
  const speedupTiers = useMemo(
    () => [
      {
        tier: 1,
        label: "Hasten",
        description: "50% time reduction",
        maxCount: maxSpeedupCount({
          remainingSeconds: remainingSec,
          timeMultiplier: 0.5,
          costMultiplier: 1,
          gemsPerMinute: 1,
          gemBalance,
        }),
      },
      {
        tier: 2,
        label: "Rush",
        description: "75% time reduction",
        maxCount: maxSpeedupCount({
          remainingSeconds: remainingSec,
          timeMultiplier: 0.25,
          costMultiplier: 2,
          gemsPerMinute: 1,
          gemBalance,
        }),
      },
    ],
    [remainingSec, gemBalance],
  );

  const costInfo = useMemo(() => getBuildCostInfo(buildingId), [getBuildCostInfo, buildingId]);
  const costPreview = useMemo(
    () => getUpgradeCostPreview(buildingId),
    [getUpgradeCostPreview, buildingId],
  );

  const morphActions = useMemo<PanelAction[] | null>(() => {
    if (!config) return null;
    if (isConstructing) {
      if (ready) {
        return [
          {
            id: "complete-building",
            label: `Complete ${config.name}`,
            variant: "primary" as const,
            onClick: (rp) => handleCompleteBuilding(buildingId, rp),
          },
        ];
      }
      const remainingMinutes = Math.max(1, Math.ceil(remainingSec / 60));
      const t1Cost = remainingMinutes;
      const t2Cost = remainingMinutes * 2;
      // Mirror the desktop SpeedupPanel tier caps onto the morph buttons so
      // mobile gets the same hold-to-charge (count threaded through onHold).
      return [
        {
          id: "hasten-building",
          label: "Hasten",
          onClick: (rp) => handleBuildingSpeedup(buildingId, 1, rp),
          onHold: (rp, count) => handleBuildingSpeedup(buildingId, 1, rp, count),
          holdMax: speedupTiers[0]?.maxCount,
          disabled: gemBalance < t1Cost,
        },
        {
          id: "rush-building",
          label: "Rush",
          onClick: (rp) => handleBuildingSpeedup(buildingId, 2, rp),
          onHold: (rp, count) => handleBuildingSpeedup(buildingId, 2, rp, count),
          holdMax: speedupTiers[1]?.maxCount,
          disabled: gemBalance < t2Cost,
        },
      ];
    }
    const ci = costInfo;
    if (!ci || ci.atMaxLevel) return null;
    const hasEnough = noviBalance >= (ci.baseCost ?? 0);
    return [
      {
        id: "build-upgrade",
        label: !hasEnough ? "Insufficient NOVI" : ci.isUpgrade ? `Upgrade` : `Build`,
        variant: "primary" as const,
        disabled: !hasEnough,
        onClick: (rp) => handleBuildOrUpgrade(buildingId, rp),
      },
    ];
  }, [
    config,
    isConstructing,
    ready,
    remainingSec,
    costInfo,
    noviBalance,
    gemBalance,
    buildingId,
    speedupTiers,
    handleCompleteBuilding,
    handleBuildOrUpgrade,
    handleBuildingSpeedup,
  ]);
  useMorphActions(morphActions);

  if (!config) return null;

  if (isConstructing) {
    const constructionEndsAt = slot?.constructionEnds?.toNumber?.() ?? 0;
    const constructionStartedAt = slot?.constructionStarted?.toNumber?.() ?? undefined;
    return (
      <div className="flex flex-col gap-4">
        <div
          className={cn(
            "rounded-xl border px-4 py-5 text-center",
            ready
              ? "tier-accent-border tier-accent-glow bg-surface-raised/40"
              : "border-border-default bg-surface-raised/60",
          )}
        >
          <div
            className={cn(
              "mb-2 text-[10px] font-semibold uppercase tracking-[0.18em]",
              ready ? "tier-accent-text" : "text-text-muted",
            )}
          >
            {ready ? "Construction Complete" : `Constructing ${config.name}`}
          </div>
          {ready ? (
            <p className="text-sm font-semibold text-text-gold">Ready to break ground.</p>
          ) : (
            <GoldCountdown
              endsAt={constructionEndsAt}
              startedAt={constructionStartedAt}
              format="full"
              size="lg"
              showProgress
            />
          )}
        </div>

        {ready ? (
          <TxButton
            onClick={(rp) => handleCompleteBuilding(buildingId, rp)}
            className="w-full px-6"
          >
            Complete {config.name}
          </TxButton>
        ) : (
          <SpeedupPanel
            visible
            inline
            remainingSeconds={remainingSec}
            tiers={speedupTiers}
            onSpeedup={(tier, rp, count) => handleBuildingSpeedup(buildingId, tier, rp, count)}
            gemBalance={gemBalance}
            gemsPerMinute={1}
          />
        )}
      </div>
    );
  }

  const isUpgrade = costInfo?.isUpgrade ?? false;
  const cost = costInfo?.baseCost ?? 0;
  const tier = costInfo?.tier ?? config.tier;
  const level = costInfo?.level ?? 0;
  const maxLevel = costInfo?.maxLevel ?? 20;
  const atMaxLevel = costInfo?.atMaxLevel ?? false;
  const hasEnough = noviBalance >= cost;
  const deficit = cost - noviBalance;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent/40 text-sm font-bold text-text-gold">
          T{tier}
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text-primary">{config.name}</div>
          <div className="text-xs text-text-muted">
            Tier {tier} {isUpgrade ? "building" : "— not yet built"}
          </div>
          {isUpgrade && (
            <div className="text-[11px] text-text-gold">
              Level {level}/{maxLevel}
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      {config.desc && (
        <div className="-mt-1 text-xs leading-snug text-text-muted">{config.desc}</div>
      )}

      {/* Lore — the building as a place, not a stat source */}
      <p className="text-xs italic leading-snug text-text-muted">
        {buildingFraming(buildingId).line}
      </p>

      {/* NOVI balance */}
      <div className="rounded-lg bg-surface/60 px-3 py-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-500">Your NOVI</span>
          <span
            className={`font-mono tabular-nums ${
              hasEnough || atMaxLevel ? "text-text-gold" : "text-red-400"
            }`}
          >
            <GameIcon id="resource-novi" size={14} className="mr-2" />
            {formatNoviAmount(noviBalance)}
          </span>
        </div>
        {!atMaxLevel && costInfo && (
          <div className="mt-1 flex items-center justify-between text-xs">
            <span className="text-zinc-500">
              {isUpgrade ? `Lv ${level + 1} Cost` : "Build Cost"}
            </span>
            <span className="font-mono tabular-nums text-text-muted">
              {formatNoviAmount(cost)} NOVI · {fmtHours(costInfo.baseTimeHours)}
            </span>
          </div>
        )}
        {!hasEnough && !atMaxLevel && costInfo && (
          <div className="mt-1 text-[11px] text-red-400">
            Need {formatNoviAmount(deficit)} more NOVI
          </div>
        )}
      </div>

      {/* Cost preview */}
      {costPreview && costPreview.length > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-surface/50 p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            Cost Preview
          </div>
          <div className="flex flex-wrap gap-2">
            {costPreview.map((u) => {
              const isNext = u.level === level;
              const isDone = u.level < level;
              return (
                <div
                  key={u.level}
                  className={`rounded border px-2 py-1 text-center ${
                    isNext
                      ? "border-border-gold bg-accent/20"
                      : isDone
                        ? "border-green-800/50 bg-green-900/10"
                        : "border-zinc-800"
                  }`}
                >
                  <div className="text-[11px] text-text-muted">Lv {u.level + 1}</div>
                  <div className="text-xs font-semibold text-text-gold">{formatNumber(deciToNovi(u.cost))}</div>
                  <div className="text-[11px] text-text-muted">~{fmtHours(u.timeHours)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Action */}
      {!costInfo ? (
        <div className="rounded-lg border border-zinc-800 bg-surface py-3 text-center text-xs text-text-muted">
          Loading building costs…
        </div>
      ) : atMaxLevel ? (
        <div className="rounded-lg border border-border-gold/50 bg-accent/20 py-3 text-center text-sm font-semibold uppercase tracking-wider text-text-gold">
          Max Level Reached
        </div>
      ) : (
        <TxButton
          onClick={(rp: (p: TxPhase) => void) => handleBuildOrUpgrade(buildingId, rp)}
          className="w-full"
          disabled={!hasEnough}
        >
          {!hasEnough ? "Insufficient NOVI" : isUpgrade ? `Upgrade` : `Build`}
        </TxButton>
      )}
    </div>
  );
}
