"use client";

import { useState, useMemo } from "react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useUser } from "@/lib/hooks/useUser";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useLoot } from "@/lib/hooks/useLoot";
import { useStamina } from "@/lib/hooks/useStamina";
import {
  useCombatPower,
  useTravelProgress,
  useSubscriptionStatus,
  useDailyRewards,
} from "@/lib/hooks/useDerived";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { GoldCountdown } from "@/components/shared/GoldCountdown";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { StatBar } from "@/components/shared/StatBar";
import { UnitGrid } from "@/components/shared/UnitGrid";
import { PageTransition } from "@/components/shared/PageTransition";
import { NoviGenerator } from "@/components/shared/NoviGenerator";
import { NoviRewards } from "@/components/shared/NoviRewards";
import { ActivityFeed } from "@/components/shared/ActivityFeed";
import { LoadingSequence, getLoadingSteps } from "@/components/loading/LoadingSequence";
import { useWallet } from "@solana/wallet-adapter-react";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useTransact } from "@/lib/hooks/useTransact";
import Link from "next/link";
import { GameInfoPanel } from "@/components/shared/GameInfoPanel";
import { InfoGrid } from "@/components/shared/InfoGrid";
import { bpsToMultiplier, formatTime } from "@/lib/utils";
import {
  xpRequiredForLevel, levelProgressPercent,
  getCurrentTimeOfDay, getTimeOfDayName, getActivityMultiplier,
  createClaimDailyRewardInstruction,
} from "novus-mundus-sdk";

export default function DashboardPage() {
  const { data: playerData, isSuccess: playerReady } = usePlayer();
  const { data: userData, isSuccess: userReady } = useUser();
  const { data: geData, isSuccess: geReady } = useGameEngine();
  const { data: lootData, isSuccess: lootReady } = useLoot();

  const player = playerData?.account;
  const power = useCombatPower();
  const travel = useTravelProgress();
  const sub = useSubscriptionStatus();
  const daily = useDailyRewards();
  const stamina = useStamina(
    player?.encounterStamina?.toNumber(),
    player?.lastStaminaUpdate?.toNumber(),
    player?.maxEncounterStamina?.toNumber(),
    player ? 1 / 60 : undefined
  );

  const nowSec = Math.floor(Date.now() / 1000);
  const tod = useMemo(() => getCurrentTimeOfDay(nowSec, 0), [nowSec]);
  const todName = getTimeOfDayName(tod);

  const xpForNext = player ? xpRequiredForLevel(player.level + 1) : 0;
  const xpProgress = player ? levelProgressPercent(player.level, player.currentXp.toNumber()) : 0;
  const networth = player ? player.networth.toNumber() : 0;

  const [completedKeys] = useState(() => new Set<string>());
  if (playerReady) completedKeys.add("player");
  if (geReady) completedKeys.add("gameEngine");
  if (userReady) completedKeys.add("user");
  if (lootReady) completedKeys.add("loot");

  // No player yet — the (game) layout redirects to /estate, where the Arrival lives.
  if (!playerData?.exists && playerReady) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-text-muted">
        Taking you to your holding…
      </div>
    );
  }

  const lootCount = lootData?.length ?? 0;

  return (
    <LoadingSequence steps={getLoadingSteps("dashboard")} screen="dashboard" completedKeys={completedKeys}>
      <PageTransition>
        <div className="flex flex-col gap-3">
          {/* Header row */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
            <h1 className="tier-title font-display text-xl font-bold tracking-wide sm:text-2xl">
              STATUS
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted sm:gap-3">
              <span>{todName}</span>
              {player && (
                <div className="flex flex-wrap gap-2">
                  <Link href="/estate?tab=market" className="accent-border rounded bg-surface-raised px-2.5 py-1 text-xs font-medium text-text-gold">
                    Collect
                  </Link>
                  {lootCount > 0 && (
                    <Link href="/inventory" className="accent-border-bright rounded bg-surface-raised px-2.5 py-1 text-xs font-medium text-text-gold">
                      Claim Loot ({lootCount})
                    </Link>
                  )}
                  <Link href="/shop" className="accent-border rounded bg-surface-raised px-2.5 py-1 text-xs font-medium text-text-gold">
                    Shop
                  </Link>
                </div>
              )}
            </div>
          </div>

          {player && (
            <>
              {/* Active Operations — full width alert bar */}
              {(travel.traveling || lootCount > 0) && (
                <div className="card flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                  {travel.traveling && (
                    <div className="flex flex-1 items-center justify-between">
                      <span className="text-sm text-text-secondary">
                        Traveling to City {player.destinationCity}
                      </span>
                      <GoldCountdown
                        endsAt={travel.endsAt}
                        startedAt={travel.startedAt}
                        showProgress
                        format="compact"
                        size="sm"
                      />
                    </div>
                  )}
                  {lootCount > 0 && (
                    <Link
                      href="/inventory"
                      className="flex items-center justify-between text-sm text-text-gold hover:opacity-80 sm:gap-2"
                    >
                      <span>{lootCount} unclaimed loot</span>
                      <span>Claim &rarr;</span>
                    </Link>
                  )}
                </div>
              )}

              {/* Main grid: player stuff (left 2/3) + NOVI stuff (right 1/3) */}
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                {/* Left column: Player Card → Treasury/Power → Activity → Game Info */}
                <div className="flex flex-col gap-3 lg:col-span-2">
                  <div className="card accent-border">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-base font-semibold text-text-primary">
                          {player.name || "Unnamed Warrior"}
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-xs text-text-muted">
                          <span>City {player.currentCity}</span>
                          <span>{sub.tierName} {sub.active ? "♛" : ""}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-3xl font-bold text-text-gold">{player.level}</div>
                        <div className="text-[10px] text-text-muted">LEVEL</div>
                      </div>
                    </div>
                    <div className="mt-2">
                      <StatBar current={player.currentXp.toNumber()} max={xpForNext} label="XP" color="gold" />
                      <div className="mt-0.5 flex justify-between text-[10px] text-text-muted">
                        <span>{player.currentXp.toNumber().toLocaleString()} / {xpForNext.toLocaleString()}</span>
                        <span>{xpProgress.toFixed(1)}%</span>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                    <div className="card">
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Treasury</h3>
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-sm">
                          <span className="text-text-secondary">NOVI</span>
                          <GoldNumber value={player.lockedNovi.toNumber()} prefix="◆ " delta />
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-text-secondary">Cash</span>
                          <GoldNumber value={player.cashOnHand.toNumber()} prefix="$ " format="full" />
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-text-secondary">Vault</span>
                          <GoldNumber value={player.cashInVault.toNumber()} prefix="$ " format="full" glow={false} />
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-text-secondary">Gems</span>
                          <GoldNumber value={player.gems.toNumber()} prefix="✦ " />
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-text-secondary">Fragments</span>
                          <GoldNumber value={player.fragments.toNumber()} prefix="◇ " glow={false} />
                        </div>
                        <div className="mt-1.5 border-t border-border-default pt-1.5 flex justify-between text-sm">
                          <span className="text-text-secondary">Net Worth</span>
                          <GoldNumber value={networth} prefix="⊕ " size="sm" />
                        </div>
                      </div>
                    </div>

                    <div className="card">
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Power</h3>
                      <div className="mb-3 text-center">
                        <GoldNumber value={power.total} size="xl" />
                        <div className="text-[10px] text-text-muted">Total Combat Power</div>
                      </div>
                      <UnitGrid
                        defense={[
                          player.defensiveUnit1.toNumber(),
                          player.defensiveUnit2.toNumber(),
                          player.defensiveUnit3.toNumber(),
                        ]}
                        offense={[
                          player.operativeUnit1.toNumber(),
                          player.operativeUnit2.toNumber(),
                          player.operativeUnit3.toNumber(),
                        ]}
                      />
                    </div>
                  </div>

                  <ActivityFeed />

                  {geData?.account && (() => {
                    const ge = geData.account;
                    const gp = ge.gameplayConfig;
                    const tm = ge.themeConfig.themeMultipliers;
                    return (
                      <GameInfoPanel>
                        <InfoGrid items={[
                          { label: "Kingdom", value: ge.kingdomName, highlight: true },
                          { label: "Theme", value: ge.kingdomTheme.toString() },
                          { label: "Total Players", value: ge.totalPlayers.toNumber().toLocaleString() },
                          { label: "Protection", value: formatTime(gp.newPlayerProtectionDuration.toNumber(), "compact") },
                          { label: "Daily Cash", value: gp.dailyCashBase.toNumber().toLocaleString() },
                          { label: "Daily XP", value: gp.dailyXpBase.toNumber().toLocaleString() },
                          { label: "Attack Mult", value: bpsToMultiplier(tm.attackMultiplier) },
                          { label: "Defense Mult", value: bpsToMultiplier(tm.defenseMultiplier) },
                          { label: "Collection Mult", value: bpsToMultiplier(tm.collectionMultiplier) },
                        ]} />
                      </GameInfoPanel>
                    );
                  })()}
                </div>

                {/* Right column: NOVI Generator + Rewards */}
                <div className="flex flex-col gap-3">
                  <NoviGenerator />
                  <NoviRewards />
                  <DailyRewardCard daily={daily} />
                </div>
              </div>
            </>
          )}
        </div>
      </PageTransition>
    </LoadingSequence>
  );
}

// Daily Reward
function DailyRewardCard({
  daily,
}: {
  daily: { available: boolean; cooldownEnds: number; hasDailyRewards: boolean };
}) {
  const { publicKey } = useWallet();
  const client = useNovusMundusClient();
  const transact = useTransact();

  if (!daily.hasDailyRewards) return null;

  const handleClaim = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ix = createClaimDailyRewardInstruction({
      owner: publicKey,
      gameEngine: client.gameEngine,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: "Daily reward claimed!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  return (
    <div className="card accent-border">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
        Daily Reward
      </h3>
      {daily.available ? (
        <>
          <p className="mb-3 text-sm text-text-secondary">
            Your daily login reward is ready to claim.
          </p>
          <TxButton onClick={handleClaim} className="w-full">
            Claim Daily Reward
          </TxButton>
        </>
      ) : (
        <div className="flex items-center justify-between">
          <span className="text-sm text-text-muted">Next reward</span>
          <GoldCountdown endsAt={daily.cooldownEnds} format="compact" size="sm" />
        </div>
      )}
    </div>
  );
}
