"use client";

import { useState, useMemo } from "react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useExpedition } from "@/lib/hooks/useExpedition";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { GoldCountdown } from "@/components/shared/GoldCountdown";
import { StatBar } from "@/components/shared/StatBar";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { SpeedupPanel } from "@/components/shared/SpeedupPanel";
import { GameInfoPanel } from "@/components/shared/GameInfoPanel";
import { InfoGrid } from "@/components/shared/InfoGrid";
import { bpsToPercent } from "@/lib/utils";
import {
  derivePlayerPda,
  deriveExpeditionPda,
  createExpeditionStartInstruction,
  createExpeditionClaimInstruction,
  createExpeditionAbortInstruction,
  createExpeditionSpeedupInstruction,
  getExpeditionEndTime,
  getExpeditionDurationSeconds,
  isTraveling,
  ENCOUNTER_STAMINA_COSTS,
} from "@/lib/sdk";

// Expedition reward constants (from novus_mundus constants)
const MINING_DURATION_HOURS = [1, 2, 4, 8, 16] as const;
const FISHING_DURATION_HOURS = [1, 2, 4, 8, 16] as const;
const MINING_GEMS_PER_OP_HOUR = [10, 18, 30, 50, 80] as const;
const FISHING_PRODUCE_PER_OP_HOUR = [15, 25, 40, 60, 100] as const;
const MINING_FRAGMENT_BONUS = [1, 3, 8, 20, 50] as const;
const FISHING_FRAGMENT_BONUS = [1, 2, 5, 12, 30] as const;
const MINING_NOVI_COST = [100, 500, 2_000, 8_000, 30_000] as const;
const FISHING_NOVI_COST = [100, 500, 2_000, 8_000, 30_000] as const;

// Expedition stamina cost uses encounter type 0 (common encounter cost)
const EXPEDITION_STAMINA_COST = ENCOUNTER_STAMINA_COSTS[0] ?? 10;

const EXPEDITION_TYPES = [
  { id: 1, name: "Mining", icon: "\u26CF", desc: "Extract minerals and rare ores" },
  { id: 2, name: "Fishing", icon: "\uD83C\uDFA3", desc: "Catch fish and aquatic resources" },
];

export function ExpeditionTab() {
  const { data: playerData } = usePlayer();
  const { data: expeditionData } = useExpedition();
  const { data: geData } = useGameEngine();
  const ge = geData?.account;
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();

  const player = playerData?.account;
  const expedition = expeditionData?.account;
  const hasExpedition = expeditionData?.exists && expedition;

  const [selectedType, setSelectedType] = useState(1);

  // Traveling check
  const playerTraveling = player ? isTraveling(player) : false;

  // Stamina info
  const playerStamina = player?.encounterStamina?.toNumber?.() ?? 0;
  const playerMaxStamina = player?.maxEncounterStamina?.toNumber?.() ?? 100;
  const hasStamina = playerStamina >= EXPEDITION_STAMINA_COST;

  // Validate: can start expedition
  const canStart = useMemo(() => {
    if (!player) return false;
    if (playerTraveling) return false;
    if (hasExpedition) return false;
    return true;
  }, [player, playerTraveling, hasExpedition]);

  // Expedition time remaining
  const expeditionRemaining = hasExpedition
    ? Math.max(0, getExpeditionEndTime(expedition) - Math.floor(Date.now() / 1000))
    : 0;

  // Reward preview for selected expedition type (tier 0 = base tier)
  const rewardPreview = useMemo(() => {
    const tier = 0;
    const ops = player
      ? (player.operativeUnit1?.toNumber?.() ?? 0) +
        (player.operativeUnit2?.toNumber?.() ?? 0) +
        (player.operativeUnit3?.toNumber?.() ?? 0)
      : 0;

    if (selectedType === 1) {
      // Mining
      const hours = MINING_DURATION_HOURS[tier] ?? 1;
      const gemsPerOpHour = MINING_GEMS_PER_OP_HOUR[tier] ?? 10;
      const fragments = MINING_FRAGMENT_BONUS[tier] ?? 1;
      const cost = MINING_NOVI_COST[tier] ?? 100;
      const estimatedGems = Math.floor(ops * gemsPerOpHour * hours);
      return {
        duration: hours,
        estimatedGems,
        fragments,
        cost,
        resourceLabel: "Gems",
        resourceIcon: "\u25C7",
      };
    } else {
      // Fishing
      const hours = FISHING_DURATION_HOURS[tier] ?? 1;
      const producePerOpHour = FISHING_PRODUCE_PER_OP_HOUR[tier] ?? 15;
      const fragments = FISHING_FRAGMENT_BONUS[tier] ?? 1;
      const cost = FISHING_NOVI_COST[tier] ?? 100;
      const estimatedProduce = Math.floor(ops * producePerOpHour * hours);
      return {
        duration: hours,
        estimatedGems: estimatedProduce,
        fragments,
        cost,
        resourceLabel: "Produce",
        resourceIcon: "\uD83C\uDF3E",
      };
    }
  }, [selectedType, player]);

  // Active expedition reward display
  const activeRewardInfo = useMemo(() => {
    if (!expedition) return null;
    const tier = expedition.tier ?? 0;
    const ops =
      (expedition.operativeUnit1?.toNumber?.() ?? 0) +
      (expedition.operativeUnit2?.toNumber?.() ?? 0) +
      (expedition.operativeUnit3?.toNumber?.() ?? 0);

    if (expedition.expeditionType === 1) {
      const hours = MINING_DURATION_HOURS[tier] ?? 1;
      const gemsPerOpHour = MINING_GEMS_PER_OP_HOUR[tier] ?? 10;
      const fragments = MINING_FRAGMENT_BONUS[tier] ?? 1;
      return {
        estimated: Math.floor(ops * gemsPerOpHour * hours),
        fragments,
        label: "Gems",
        icon: "\u25C7",
      };
    } else {
      const hours = FISHING_DURATION_HOURS[tier] ?? 1;
      const producePerOpHour = FISHING_PRODUCE_PER_OP_HOUR[tier] ?? 15;
      const fragments = FISHING_FRAGMENT_BONUS[tier] ?? 1;
      return {
        estimated: Math.floor(ops * producePerOpHour * hours),
        fragments,
        label: "Produce",
        icon: "\uD83C\uDF3E",
      };
    }
  }, [expedition]);

  const handleStart = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const [playerPda] = derivePlayerPda(ge, publicKey);
    const [expPda] = deriveExpeditionPda(playerPda);
    const ix = createExpeditionStartInstruction(
      { player: playerPda, expedition: expPda, gameEngine: ge, owner: publicKey },
      { expeditionType: selectedType }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["expedition"], ["player"]],
      successMessage: "Expedition started!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleClaim = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const [playerPda] = derivePlayerPda(ge, publicKey);
    const [expPda] = deriveExpeditionPda(playerPda);
    const ix = createExpeditionClaimInstruction(
      { player: playerPda, expedition: expPda, gameEngine: ge, owner: publicKey }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["expedition"], ["player"]],
      successMessage: "Expedition rewards claimed!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleAbort = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const [playerPda] = derivePlayerPda(ge, publicKey);
    const [expPda] = deriveExpeditionPda(playerPda);
    const ix = createExpeditionAbortInstruction(
      { player: playerPda, expedition: expPda, gameEngine: ge, owner: publicKey }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["expedition"], ["player"]],
      successMessage: "Expedition aborted.",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleSpeedup = async (tier: number, reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const geKey = client.gameEngine;
    const ix = createExpeditionSpeedupInstruction(
      { owner: publicKey, gameEngine: geKey },
      { speedupTier: tier },
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["expedition"], ["player"]],
      successMessage: "Expedition sped up!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleStartAndSpeedup = async (tier: number, reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const [playerPda] = derivePlayerPda(ge, publicKey);
    const [expPda] = deriveExpeditionPda(playerPda);
    const startIx = createExpeditionStartInstruction(
      { player: playerPda, expedition: expPda, gameEngine: ge, owner: publicKey },
      { expeditionType: selectedType }
    );
    const speedupIx = createExpeditionSpeedupInstruction(
      { owner: publicKey, gameEngine: ge },
      { speedupTier: tier },
    );
    return transact.mutateAsync({
      instructions: [startIx, speedupIx],
      invalidateKeys: [["expedition"], ["player"]],
      successMessage: `${EXPEDITION_TYPES.find((t) => t.id === selectedType)?.name} expedition started (sped up)!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  return (
    <div className="space-y-4">
      {/* Traveling Warning */}
      {playerTraveling && (
        <div className="rounded-lg border border-amber-800/50 bg-amber-900/20 p-3 text-sm text-amber-300">
          You are currently traveling. Complete or cancel travel before starting an expedition.
        </div>
      )}

      {/* Active Expedition */}
      {hasExpedition && (
        <div className="card accent-border">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-text-muted">Active Expedition</div>
              <div className="text-lg font-semibold text-text-primary">
                {EXPEDITION_TYPES.find((t) => t.id === expedition.expeditionType)?.name || "Unknown"}
              </div>
            </div>
            <div className="text-right">
              <GoldCountdown
                endsAt={getExpeditionEndTime(expedition)}
                startedAt={expedition.startTime?.toNumber?.() ?? 0}
                showProgress
                format="full"
              />
            </div>
          </div>
          <div className="mt-3">
            <StatBar
              current={Math.max(0, Date.now() / 1000 - (expedition.startTime?.toNumber?.() ?? 0))}
              max={Math.max(1, getExpeditionDurationSeconds(expedition))}
              color="gold"
              showValues={false}
            />
          </div>

          {/* Time Remaining Display */}
          {expeditionRemaining > 0 && (
            <div className="mt-2 text-center text-[11px] text-text-muted">
              Time remaining: <span className="text-text-gold">
                {Math.floor(expeditionRemaining / 3600)}h {Math.floor((expeditionRemaining % 3600) / 60)}m {expeditionRemaining % 60}s
              </span>
            </div>
          )}
          {expeditionRemaining === 0 && (
            <div className="mt-2 text-center text-[11px] text-green-400 font-semibold">
              Expedition complete -- ready to claim!
            </div>
          )}

          {/* Expedition Reward Preview */}
          {activeRewardInfo && (
            <div className="mt-3 rounded-lg border border-zinc-800 bg-surface/50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
                Estimated Rewards
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-text-muted">{activeRewardInfo.label}</div>
                  <div className="text-text-gold">
                    {activeRewardInfo.icon} <GoldNumber value={activeRewardInfo.estimated} />
                  </div>
                </div>
                <div>
                  <div className="text-xs text-text-muted">Bonus Fragments</div>
                  <GoldNumber value={activeRewardInfo.fragments} prefix={"+ "} />
                </div>
              </div>
              <div className="mt-1 text-[11px] text-text-muted">
                Actual rewards depend on score and operative tier bonuses.
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-3">
            <TxButton onClick={handleClaim}>Claim Rewards</TxButton>
            <TxButton onClick={handleAbort} variant="danger">
              Abort
            </TxButton>
          </div>
          {/* Speedup */}
          <SpeedupPanel
            visible={expeditionRemaining > 0}
            remainingSeconds={expeditionRemaining}
            onSpeedup={handleSpeedup}
            gemsPerMinute={100}
            gemBalance={playerData?.account?.gems?.toNumber?.()}
            className="mt-4"
          />
        </div>
      )}

      {/* Start New Expedition */}
      {!hasExpedition && (
        <>
          {/* Stamina Display */}
          {player && (
            <div className="card">
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-[200px]">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">Stamina</span>
                    <span className="text-xs">
                      <span className={playerStamina > 0 ? "text-green-400" : "text-red-400"}>{playerStamina}</span>
                      <span className="text-text-muted"> / {playerMaxStamina}</span>
                    </span>
                  </div>
                  <StatBar current={playerStamina} max={playerMaxStamina} color="gold" size="sm" showValues={false} />
                </div>
              </div>
              {EXPEDITION_STAMINA_COST > 0 && (
                <div className="mt-2 text-[11px] text-text-muted">
                  Expedition stamina cost: <span className={hasStamina ? "text-text-secondary" : "text-red-400"}>{EXPEDITION_STAMINA_COST}</span>
                  {!hasStamina && <span className="ml-2 text-red-400">Insufficient stamina</span>}
                </div>
              )}
            </div>
          )}

          <div className="card">
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Choose Expedition
            </h3>
            <div className="grid gap-4 md:grid-cols-2">
              {EXPEDITION_TYPES.map((type) => (
                <button
                  key={type.id}
                  onClick={() => setSelectedType(type.id)}
                  className={`rounded-lg border p-6 text-left transition-all ${
                    selectedType === type.id
                      ? "border-amber-600 bg-amber-900/20"
                      : "border-zinc-800 hover:border-zinc-700"
                  }`}
                >
                  <div className="text-3xl">{type.icon}</div>
                  <div className="mt-2 text-lg font-semibold text-text-primary">{type.name}</div>
                  <div className="text-sm text-text-muted">{type.desc}</div>
                </button>
              ))}
            </div>

            {/* Reward Preview */}
            {rewardPreview && (
              <div className="mt-4 rounded-lg border border-zinc-800 bg-surface/50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
                  Reward Preview (Tier 0)
                </div>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div>
                    <div className="text-xs text-text-muted">Duration</div>
                    <div className="text-text-gold text-sm font-semibold">{rewardPreview.duration}h</div>
                  </div>
                  <div>
                    <div className="text-xs text-text-muted">Est. {rewardPreview.resourceLabel}</div>
                    <div className="text-text-gold text-sm">
                      {rewardPreview.resourceIcon} <GoldNumber value={rewardPreview.estimatedGems} size="sm" />
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-text-muted">Bonus Fragments</div>
                    <div className="text-text-secondary text-sm">+{rewardPreview.fragments}</div>
                  </div>
                  <div>
                    <div className="text-xs text-text-muted">NOVI Cost</div>
                    <div className="text-text-secondary text-sm">
                      <GoldNumber value={rewardPreview.cost} prefix="$ " size="sm" />
                    </div>
                  </div>
                </div>
                <div className="mt-1 text-[11px] text-text-muted">
                  Estimated rewards based on your {(player?.operativeUnit1?.toNumber?.() ?? 0) + (player?.operativeUnit2?.toNumber?.() ?? 0) + (player?.operativeUnit3?.toNumber?.() ?? 0)} operative units.
                </div>
              </div>
            )}

            {/* Validation Messages */}
            {hasExpedition && (
              <div className="mt-3 text-center text-[11px] text-red-400">
                You already have an active expedition. Claim or abort it first.
              </div>
            )}

            <div className="mt-4 space-y-3">
              <div className="flex justify-center">
                <TxButton onClick={handleStart} className="px-8 py-3 text-lg" disabled={!canStart || !hasStamina}>
                  Start Expedition
                </TxButton>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <TxButton
                  onClick={(rp) => handleStartAndSpeedup(1, rp)}
                  variant="secondary"
                  className="text-xs"
                  disabled={!canStart || !hasStamina}
                >
                  Start &amp; Hasten (50% faster, costs gems)
                </TxButton>
                <TxButton
                  onClick={(rp) => handleStartAndSpeedup(2, rp)}
                  variant="secondary"
                  className="text-xs"
                  disabled={!canStart || !hasStamina}
                >
                  Start &amp; Rush (75% faster, costs gems)
                </TxButton>
              </div>
            </div>
          </div>
        </>
      )}
      {/* Game Parameters */}
      {ge && (() => {
        const ec = ge.expeditionConfig;
        return (
          <GameInfoPanel>
            <InfoGrid items={[
              ...ec.miningNoviCost.map((c, i) => ({
                label: `Mining Cost T${i}`,
                value: c.toNumber().toLocaleString(),
                suffix: "NOVI",
              })),
              ...ec.fishingNoviCost.map((c, i) => ({
                label: `Fishing Cost T${i}`,
                value: c.toNumber().toLocaleString(),
                suffix: "NOVI",
              })),
              ...ec.miningFragmentBonus.map((b, i) => ({
                label: `Mining Frag T${i}`,
                value: `+${b.toNumber()}`,
              })),
              ...ec.miningDurationHours.map((h, i) => ({
                label: `Mining Dur T${i}`,
                value: `${h}h`,
              })),
              ...ec.miningRareChanceBps.map((c, i) => ({
                label: `Mining Rare T${i}`,
                value: bpsToPercent(c),
              })),
              { label: "Perfect Bonus", value: bpsToPercent(ec.perfectExpeditionBonusBps), highlight: true },
              { label: "Op T1 Mult", value: bpsToPercent(ec.operativeTier1MultiplierBps.toNumber()) },
              { label: "Op T2 Mult", value: bpsToPercent(ec.operativeTier2MultiplierBps.toNumber()) },
              { label: "Op T3 Mult", value: bpsToPercent(ec.operativeTier3MultiplierBps.toNumber()) },
            ]} />
          </GameInfoPanel>
        );
      })()}
    </div>
  );
}
