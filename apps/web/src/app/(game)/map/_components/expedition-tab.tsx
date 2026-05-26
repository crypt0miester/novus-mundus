"use client";

import { useState, useMemo } from "react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useExpedition } from "@/lib/hooks/useExpedition";
import { useEstate } from "@/lib/hooks/useEstate";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useLockedHeroes, NO_HERO_SLOT } from "@/lib/hooks/useLockedHeroes";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { GameIcon, type GameIconId } from "@/components/shared/GameIcon";
import { GoldCountdown } from "@/components/shared/GoldCountdown";
import { StatBar } from "@/components/shared/StatBar";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { SpeedupPanel, maxExpeditionSpeedupCount } from "@/components/shared/SpeedupPanel";
import { GameInfoPanel } from "@/components/shared/GameInfoPanel";
import { InfoGrid } from "@/components/shared/InfoGrid";
import {
  TripleCountInput,
  OPERATIVE_UNIT_LABELS,
  OPERATIVE_UNIT_ICONS,
} from "@/components/shared/TripleCountInput";
import { bpsToPercent } from "@/lib/utils";
import {
  deriveHeroCollectionPda,
  createExpeditionStartInstruction,
  createExpeditionClaimInstruction,
  createExpeditionAbortInstruction,
  createExpeditionSpeedupInstruction,
  getExpeditionEndTime,
  getExpeditionDurationSeconds,
  isTraveling,
  isNullPubkey,
  findBuilding,
  BuildingType,
  BuildingStatus,
  MINING_WORKSHOP_REQ,
  FISHING_DOCK_REQ,
  ENCOUNTER_STAMINA_COSTS,
  formatNoviAmount,
} from "novus-mundus-sdk";
import { useCoSign } from "@/lib/cosign";

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
  const { data: estateData } = useEstate();
  const { data: geData } = useGameEngine();
  const ge = geData?.account;
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();
  const { requestCoSign } = useCoSign();

  const player = playerData?.account;
  const expedition = expeditionData?.account;
  const hasExpedition = expeditionData?.exists && expedition;

  const [selectedType, setSelectedType] = useState(1);
  // Expedition configuration the player commits when starting.
  const [expeditionTier, setExpeditionTier] = useState(0);
  const [expeditionOps, setExpeditionOps] = useState<[number, number, number]>([0, 0, 0]);
  const [expeditionHeroSlot, setExpeditionHeroSlot] = useState(NO_HERO_SLOT);
  const availOps: [number, number, number] = [
    player?.operativeUnit1?.toNumber?.() ?? 0,
    player?.operativeUnit2?.toNumber?.() ?? 0,
    player?.operativeUnit3?.toNumber?.() ?? 0,
  ];

  // The player's locked heroes (slots 0-2); one may optionally join the expedition.
  const lockedHeroes = useLockedHeroes();

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

  // Building gate — Mining needs the Mine, Fishing the Dock, at the level the
  // chosen tier demands. The on-chain error (BuildingLevelInsufficient) is
  // generic and never names the building, so resolve it here.
  const buildingReq = useMemo(() => {
    const isMining = selectedType === 1;
    const name = isMining ? "Mine" : "Dock";
    const type = isMining ? BuildingType.Mine : BuildingType.Dock;
    const required = (isMining ? MINING_WORKSHOP_REQ : FISHING_DOCK_REQ)[expeditionTier] ?? 20;
    const estate = estateData?.account;
    // Estate still loading — let the on-chain check be the backstop.
    if (!estate) return { ok: true, message: null as string | null };
    // `findBuilding` already skips Empty slots, so a null result means "not built".
    const b = findBuilding(estate, type);
    if (!b) {
      return { ok: false, message: `Requires a ${name} (Lv ${required}+) — not built yet.` };
    }
    if (b.status !== BuildingStatus.Active && b.status !== BuildingStatus.Upgrading) {
      return { ok: false, message: `Your ${name} is still under construction.` };
    }
    if (b.level < required) {
      // While an upgrade is in flight, `b.level` is still the old level — the
      // chain only commits the new one on `complete_upgrade`. Surface the
      // in-progress upgrade so the player isn't told "yours is Lv X" when
      // they're actively building toward Lv X+1.
      const isUpgrading = b.status === BuildingStatus.Upgrading;
      return {
        ok: false,
        message: isUpgrading
          ? `${name} Lv ${b.level} is upgrading to Lv ${b.level + 1} — Tier ${expeditionTier} needs Lv ${required}.`
          : `Tier ${expeditionTier} needs ${name} Lv ${required} — yours is Lv ${b.level}.`,
      };
    }
    return { ok: true, message: null };
  }, [estateData, selectedType, expeditionTier]);

  // Can only start once stamina + at least one operative are committed, and the
  // tier's required building is in place.
  const canStartNow =
    canStart && hasStamina && buildingReq.ok && expeditionOps.some((n) => n > 0);

  // Expedition time remaining
  const expeditionRemaining = hasExpedition
    ? Math.max(0, getExpeditionEndTime(expedition) - Math.floor(Date.now() / 1000))
    : 0;

  // Hold-to-charge caps for the speedup tiers — how many speedup instructions
  // one tx can usefully hold (timer-collapse ∧ gem affordability). The
  // expedition processor prices a speedup on the time it removes, with a flat
  // 100 gems/minute rate, so the cap is computed with maxExpeditionSpeedupCount.
  const EXPEDITION_SPEEDUP_GEMS_PER_MINUTE = 100;
  const expeditionGemBalance = playerData?.account?.gems?.toNumber?.() ?? 0;
  const speedupTiers = [
    {
      tier: 1,
      label: "Hasten",
      description: "50% time reduction",
      maxCount: maxExpeditionSpeedupCount({
        remainingSeconds: expeditionRemaining,
        reductionBps: 5000,
        costMultiplier: 1,
        gemsPerMinute: EXPEDITION_SPEEDUP_GEMS_PER_MINUTE,
        gemBalance: expeditionGemBalance,
      }),
    },
    {
      tier: 2,
      label: "Rush",
      description: "75% time reduction",
      maxCount: maxExpeditionSpeedupCount({
        remainingSeconds: expeditionRemaining,
        reductionBps: 7500,
        costMultiplier: 2,
        gemsPerMinute: EXPEDITION_SPEEDUP_GEMS_PER_MINUTE,
        gemBalance: expeditionGemBalance,
      }),
    },
  ];

  // Reward preview for selected expedition type (tier 0 = base tier)
  const rewardPreview = useMemo(() => {
    const tier = expeditionTier;
    const ops = expeditionOps[0] + expeditionOps[1] + expeditionOps[2];

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
        resourceIcon: "resource-gem" as GameIconId,
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
        resourceIcon: "resource-produce" as GameIconId,
      };
    }
  }, [selectedType, expeditionTier, expeditionOps]);

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
        icon: "resource-gem" as GameIconId,
      };
    } else {
      const hours = FISHING_DURATION_HOURS[tier] ?? 1;
      const producePerOpHour = FISHING_PRODUCE_PER_OP_HOUR[tier] ?? 15;
      const fragments = FISHING_FRAGMENT_BONUS[tier] ?? 1;
      return {
        estimated: Math.floor(ops * producePerOpHour * hours),
        fragments,
        label: "Produce",
        icon: "resource-produce" as GameIconId,
      };
    }
  }, [expedition]);

  const handleStart = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    if (expeditionOps.every((n) => n === 0)) {
      throw new Error("Send at least one operative");
    }
    const ge = client.gameEngine;
    const hero = expeditionHeroSlot < 3 ? lockedHeroes[expeditionHeroSlot] : null;
    const ix = createExpeditionStartInstruction(
      {
        owner: publicKey,
        gameEngine: ge,
        heroMint: hero?.mint,
        heroCollection: hero ? deriveHeroCollectionPda()[0] : undefined,
      },
      {
        expeditionType: selectedType,
        tier: expeditionTier,
        operativeUnit1: expeditionOps[0],
        operativeUnit2: expeditionOps[1],
        operativeUnit3: expeditionOps[2],
      },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["expedition"], ["player"]],
        successMessage: "Expedition started!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleClaim = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const expHeroMint =
      expedition && !isNullPubkey(expedition.heroMint) ? expedition.heroMint : null;
    const ix = createExpeditionClaimInstruction({
      owner: publicKey,
      gameEngine: ge,
      heroMint: expHeroMint ?? undefined,
      heroCollection: expHeroMint ? deriveHeroCollectionPda()[0] : undefined,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["expedition"], ["player"]],
        successMessage: "Expedition rewards claimed!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleAbort = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const expHeroMint =
      expedition && !isNullPubkey(expedition.heroMint) ? expedition.heroMint : null;
    const ix = createExpeditionAbortInstruction({
      owner: publicKey,
      gameEngine: ge,
      heroMint: expHeroMint ?? undefined,
      heroCollection: expHeroMint ? deriveHeroCollectionPda()[0] : undefined,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["expedition"], ["player"]],
        successMessage: "Expedition aborted.",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleSpeedup = async (
    tier: number,
    reportPhase: (p: TxPhase) => void,
    count: number = 1,
  ) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const geKey = client.gameEngine;
    // Hold-to-charge packs `count` speedups into one tx; each reads the live timer.
    const n = Math.max(1, Math.floor(count));
    const instructions = Array.from({ length: n }, () =>
      createExpeditionSpeedupInstruction(
        { owner: publicKey, gameEngine: geKey },
        { speedupTier: tier as 1 | 2 },
      ),
    );
    return transact
      .mutateAsync({
        instructions,
        invalidateKeys: [["expedition"], ["player"]],
        successMessage: n > 1 ? `Expedition sped up ×${n}!` : "Expedition sped up!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleStartAndSpeedup = async (tier: number, reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    if (expeditionOps.every((n) => n === 0)) {
      throw new Error("Send at least one operative");
    }
    const ge = client.gameEngine;
    const hero = expeditionHeroSlot < 3 ? lockedHeroes[expeditionHeroSlot] : null;
    const startIx = createExpeditionStartInstruction(
      {
        owner: publicKey,
        gameEngine: ge,
        heroMint: hero?.mint,
        heroCollection: hero ? deriveHeroCollectionPda()[0] : undefined,
      },
      {
        expeditionType: selectedType,
        tier: expeditionTier,
        operativeUnit1: expeditionOps[0],
        operativeUnit2: expeditionOps[1],
        operativeUnit3: expeditionOps[2],
      },
    );
    const speedupIx = createExpeditionSpeedupInstruction(
      { owner: publicKey, gameEngine: ge },
      { speedupTier: tier as 1 | 2 },
    );
    return transact
      .mutateAsync({
        instructions: [startIx, speedupIx],
        invalidateKeys: [["expedition"], ["player"]],
        successMessage: `${EXPEDITION_TYPES.find((t) => t.id === selectedType)?.name} expedition started (sped up)!`,
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  // A strike is a skill action — the score is game_authority-co-signed.
  const handleStrike = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const versionedTx = await requestCoSign("/api/cosign/expedition/strike");
    return transact
      .mutateAsync({
        versionedTx,
        invalidateKeys: [["expedition"], ["player"]],
        successMessage: "Strike landed!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  return (
    <div className="space-y-4">
      {/* Traveling Warning */}
      {playerTraveling && (
        <div className="rounded-lg border border-border-gold/50 bg-accent/20 p-3 text-sm text-danger">
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
                {EXPEDITION_TYPES.find((t) => t.id === expedition.expeditionType)?.name ||
                  "Unknown"}
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
              Time remaining:{" "}
              <span className="text-text-gold">
                {Math.floor(expeditionRemaining / 3600)}h{" "}
                {Math.floor((expeditionRemaining % 3600) / 60)}m {expeditionRemaining % 60}s
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
                  <div className="flex items-center gap-1 text-text-gold">
                    <GameIcon id={activeRewardInfo.icon} title={activeRewardInfo.label} size={14} />
                    <GoldNumber value={activeRewardInfo.estimated} />
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
            <TxButton onClick={handleStrike} variant="secondary">
              Strike
            </TxButton>
            <TxButton onClick={handleClaim}>Claim Rewards</TxButton>
            <TxButton onClick={handleAbort} variant="danger">
              Abort
            </TxButton>
          </div>
          <p className="mt-1 text-center text-[11px] text-text-muted">
            One strike unlocks per elapsed hour — higher average score lifts the final yield.
          </p>
          {/* Speedup */}
          <SpeedupPanel
            visible={expeditionRemaining > 0}
            remainingSeconds={expeditionRemaining}
            tiers={speedupTiers}
            onSpeedup={(tier, rp, count) => handleSpeedup(tier, rp, count)}
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
                    <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                      Stamina
                    </span>
                    <span className="text-xs">
                      <span className={playerStamina > 0 ? "text-green-400" : "text-red-400"}>
                        {playerStamina}
                      </span>
                      <span className="text-text-muted"> / {playerMaxStamina}</span>
                    </span>
                  </div>
                  <StatBar
                    current={playerStamina}
                    max={playerMaxStamina}
                    color="gold"
                    size="sm"
                    showValues={false}
                  />
                </div>
              </div>
              {EXPEDITION_STAMINA_COST > 0 && (
                <div className="mt-2 text-[11px] text-text-muted">
                  Expedition stamina cost:{" "}
                  <span className={hasStamina ? "text-text-secondary" : "text-red-400"}>
                    {EXPEDITION_STAMINA_COST}
                  </span>
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
                      ? "border-border-gold bg-accent/20"
                      : "border-zinc-800 hover:border-zinc-700"
                  }`}
                >
                  <div className="text-3xl">{type.icon}</div>
                  <div className="mt-2 text-lg font-semibold text-text-primary">{type.name}</div>
                  <div className="text-sm text-text-muted">{type.desc}</div>
                </button>
              ))}
            </div>

            {/* Tier — higher tier = longer duration, better rewards */}
            <div className="mt-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Tier
              </div>
              <div className="mt-2 grid grid-cols-5 gap-2">
                {(() => {
                  const durations =
                    selectedType === 1 ? MINING_DURATION_HOURS : FISHING_DURATION_HOURS;
                  return [0, 1, 2, 3, 4].map((t) => (
                    <button
                      key={t}
                      onClick={() => setExpeditionTier(t)}
                      className={`rounded-lg border p-2 text-center transition-all ${
                        expeditionTier === t
                          ? "border-border-gold bg-accent/20 text-text-primary"
                          : "border-zinc-800 text-text-muted hover:border-zinc-700"
                      }`}
                    >
                      <div className="text-xs font-semibold">T{t}</div>
                      <div className="text-[10px] text-text-muted">{durations[t]}h</div>
                    </button>
                  ));
                })()}
              </div>
            </div>

            {/* Operatives to send — locked for the expedition's duration */}
            <div className="mt-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Operatives to Send
              </div>
              <TripleCountInput
                labels={OPERATIVE_UNIT_LABELS}
                icons={OPERATIVE_UNIT_ICONS}
                available={availOps}
                value={expeditionOps}
                onChange={setExpeditionOps}
              />
            </div>

            {/* Hero — optional, grants bonus yield */}
            <div className="mt-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Hero (optional)
              </div>
              <select
                value={expeditionHeroSlot}
                onChange={(e) => setExpeditionHeroSlot(Number(e.target.value))}
                className="mt-2 w-full rounded border border-zinc-800 bg-surface px-2 py-1.5 text-sm text-text-primary"
              >
                <option value={NO_HERO_SLOT}>No hero</option>
                {lockedHeroes.map((h, i) =>
                  h ? (
                    <option key={i} value={i}>
                      Slot {i}: {h.name}
                    </option>
                  ) : null,
                )}
              </select>
            </div>

            {/* Reward Preview */}
            {rewardPreview && (
              <div className="mt-4 rounded-lg border border-zinc-800 bg-surface/50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
                  Reward Preview (Tier {expeditionTier})
                </div>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div>
                    <div className="text-xs text-text-muted">Duration</div>
                    <div className="text-text-gold text-sm font-semibold">
                      {rewardPreview.duration}h
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-text-muted">
                      Est. {rewardPreview.resourceLabel}
                    </div>
                    <div className="flex items-center gap-1 text-text-gold text-sm">
                      <GameIcon
                        id={rewardPreview.resourceIcon}
                        title={rewardPreview.resourceLabel}
                        size={14}
                      />
                      <GoldNumber value={rewardPreview.estimatedGems} size="sm" />
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-text-muted">Bonus Fragments</div>
                    <div className="text-text-secondary text-sm">+{rewardPreview.fragments}</div>
                  </div>
                  <div>
                    <div className="text-xs text-text-muted">NOVI Cost</div>
                    <div className="flex items-center gap-1 text-text-secondary text-sm">
                      <GameIcon id="resource-novi" size={14} />
                      {formatNoviAmount(rewardPreview.cost)}
                    </div>
                  </div>
                </div>
                <div className="mt-1 text-[11px] text-text-muted">
                  Estimated for{" "}
                  {(expeditionOps[0] + expeditionOps[1] + expeditionOps[2]).toLocaleString()}{" "}
                  operatives sent.
                </div>
              </div>
            )}

            {/* Validation Messages */}
            {hasExpedition && (
              <div className="mt-3 text-center text-[11px] text-red-400">
                You already have an active expedition. Claim or abort it first.
              </div>
            )}
            {!hasExpedition && buildingReq.message && (
              <div className="mt-3 text-center text-[11px] text-red-400">
                {buildingReq.message}
              </div>
            )}

            <div className="mt-4 space-y-3">
              <div className="flex justify-center">
                <TxButton
                  onClick={handleStart}
                  className="px-8 py-3 text-lg"
                  disabled={!canStartNow}
                >
                  Start Expedition
                </TxButton>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <TxButton
                  onClick={(rp) => handleStartAndSpeedup(1, rp)}
                  variant="secondary"
                  className="text-xs"
                  disabled={!canStartNow}
                >
                  Start &amp; Hasten (50% faster, costs gems)
                </TxButton>
                <TxButton
                  onClick={(rp) => handleStartAndSpeedup(2, rp)}
                  variant="secondary"
                  className="text-xs"
                  disabled={!canStartNow}
                >
                  Start &amp; Rush (75% faster, costs gems)
                </TxButton>
              </div>
            </div>
          </div>
        </>
      )}
      {/* Game Parameters */}
      {ge &&
        (() => {
          const ec = ge.expeditionConfig;
          return (
            <GameInfoPanel>
              <InfoGrid
                items={[
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
                  {
                    label: "Perfect Bonus",
                    value: bpsToPercent(ec.perfectExpeditionBonusBps),
                    highlight: true,
                  },
                  {
                    label: "Op T1 Mult",
                    value: bpsToPercent(ec.operativeTier1MultiplierBps.toNumber()),
                  },
                  {
                    label: "Op T2 Mult",
                    value: bpsToPercent(ec.operativeTier2MultiplierBps.toNumber()),
                  },
                  {
                    label: "Op T3 Mult",
                    value: bpsToPercent(ec.operativeTier3MultiplierBps.toNumber()),
                  },
                ]}
              />
            </GameInfoPanel>
          );
        })()}
    </div>
  );
}
