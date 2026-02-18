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
import { useEstate } from "@/lib/hooks/useEstate";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { GoldCountdown } from "@/components/shared/GoldCountdown";
import { StatBar } from "@/components/shared/StatBar";
import { UnitGrid } from "@/components/shared/UnitGrid";
import { PageTransition } from "@/components/shared/PageTransition";
import { NoviGenerator } from "@/components/shared/NoviGenerator";
import { NoviRewards } from "@/components/shared/NoviRewards";
import { ActivityFeed } from "@/components/shared/ActivityFeed";
import { LoadingSequence, getLoadingSteps } from "@/components/loading/LoadingSequence";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";
import { BuildingId, BuildingName } from "@/lib/hooks/useFeatureGate";
import Link from "next/link";
import { GameInfoPanel } from "@/components/shared/GameInfoPanel";
import { InfoGrid } from "@/components/shared/InfoGrid";
import { bpsToMultiplier, formatTime } from "@/lib/utils";
import {
  xpRequiredForLevel, levelProgressPercent,
  getCurrentTimeOfDay, getTimeOfDayName, getActivityMultiplier,
} from "@/lib/sdk";

export default function DashboardPage() {
  const { data: playerData, isSuccess: playerReady } = usePlayer();
  const { data: userData, isSuccess: userReady } = useUser();
  const { data: geData, isSuccess: geReady } = useGameEngine();
  const { data: lootData, isSuccess: lootReady } = useLoot();
  const { data: estateData } = useEstate();

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

  // Onboarding check
  if (!playerData?.exists && playerReady) {
    return <OnboardingFlow />;
  }

  const lootCount = lootData?.length ?? 0;

  return (
    <LoadingSequence steps={getLoadingSteps("dashboard")} completedKeys={completedKeys}>
      <PageTransition>
        <div className="mx-auto max-w-5xl space-y-6">
          <h1 className="tier-title font-display text-3xl font-bold tracking-wide">
            COMMAND CENTER
          </h1>
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span>{todName}</span>
          </div>

          {player && (
            <>
              {/* Player Card */}
              <div className="card accent-border">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-lg font-semibold text-text-primary">
                      {player.name || "Unnamed Warrior"}
                    </div>
                    <div className="mt-1 flex items-center gap-4 text-sm text-text-muted">
                      <span>City: {player.currentCity}</span>
                      <span>{sub.tierName} {sub.active ? "♛" : ""}</span>
                      {sub.active && sub.expiresAt > 0 && (
                        <GoldCountdown endsAt={sub.expiresAt} format="compact" size="sm" label="Expires" />
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-4xl font-bold text-text-gold">
                      {player.level}
                    </div>
                    <div className="text-xs text-text-muted">LEVEL</div>
                  </div>
                </div>
                <div className="mt-3">
                  <StatBar
                    current={player.currentXp.toNumber()}
                    max={xpForNext}
                    label="XP"
                    color="gold"
                  />
                  <div className="mt-1 flex justify-between text-[11px] text-text-muted">
                    <span>{player.currentXp.toNumber().toLocaleString()} / {xpForNext.toLocaleString()} XP</span>
                    <span>{xpProgress.toFixed(1)}%</span>
                  </div>
                </div>
              </div>

              {/* NOVI — Generator + Rewards */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <NoviGenerator />
                <NoviRewards />
              </div>

              {/* Quest Steps */}
              <QuestSteps player={player} estate={estateData?.account} />

              {/* Treasury + Power */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="card">
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Treasury
                  </h3>
                  <div className="space-y-2">
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
                      <span className="text-text-secondary">Stamina</span>
                      <GoldNumber value={stamina.current} suffix={`/${stamina.max}`} size="sm" />
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-text-secondary">Fragments</span>
                      <GoldNumber value={player.fragments.toNumber()} prefix="◇ " glow={false} />
                    </div>
                    <div className="mt-2 border-t border-zinc-800 pt-2 flex justify-between text-sm">
                      <span className="text-text-secondary">Net Worth</span>
                      <GoldNumber value={networth} prefix="⊕ " size="sm" />
                    </div>
                  </div>
                </div>

                <div className="card">
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Power
                  </h3>
                  <div className="mb-4 text-center">
                    <GoldNumber value={power.total} size="xl" />
                    <div className="text-xs text-text-muted">Total Combat Power</div>
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

              {/* Active Operations */}
              <div className="card">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Active Operations
                </h3>
                <div className="space-y-3">
                  {travel.traveling && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-text-secondary">
                        ● Traveling to City {player.destinationCity}
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
                      className="flex items-center justify-between text-sm text-amber-400 hover:text-amber-300"
                    >
                      <span>▲ {lootCount} unclaimed loot drops</span>
                      <span className="animate-pulse">Claim →</span>
                    </Link>
                  )}
                  {!travel.traveling && lootCount === 0 && (
                    <p className="text-sm text-text-muted">
                      No active operations. Start exploring!
                    </p>
                  )}
                </div>
              </div>

              {/* Activity Feed */}
              <div className="max-h-64 overflow-y-auto">
                <ActivityFeed />
              </div>

              {/* Game Parameters */}
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
                      { label: "New Player Protection", value: formatTime(gp.newPlayerProtectionDuration.toNumber(), "compact") },
                      { label: "Daily Cash", value: gp.dailyCashBase.toNumber().toLocaleString() },
                      { label: "Daily Produce", value: gp.dailyProduceBase.toNumber().toLocaleString() },
                      { label: "Daily XP", value: gp.dailyXpBase.toNumber().toLocaleString() },
                      { label: "Daily Cooldown", value: formatTime(gp.dailyRewardCooldown.toNumber(), "compact") },
                      { label: "Attack Mult", value: bpsToMultiplier(tm.attackMultiplier) },
                      { label: "Defense Mult", value: bpsToMultiplier(tm.defenseMultiplier) },
                      { label: "Collection Mult", value: bpsToMultiplier(tm.collectionMultiplier) },
                      { label: "Encounter HP Mult", value: bpsToMultiplier(tm.encounterHealthMultiplier) },
                    ]} />
                  </GameInfoPanel>
                );
              })()}

              {/* Quick Actions */}
              <div className="flex flex-wrap gap-3">
                <Link href="/economy" className="accent-border rounded-lg bg-surface-raised px-4 py-2 text-sm font-medium text-text-gold transition-all">
                  ⚔ Hire Units
                </Link>
                <Link href="/economy" className="accent-border rounded-lg bg-surface-raised px-4 py-2 text-sm font-medium text-text-gold transition-all">
                  ◆ Collect
                </Link>
                {lootCount > 0 && (
                  <Link href="/inventory" className="accent-border-bright rounded-lg bg-surface-raised px-4 py-2 text-sm font-medium text-text-gold transition-all">
                    ★ Claim Loot ▲{lootCount}
                  </Link>
                )}
                <Link href="/shop" className="accent-border rounded-lg bg-surface-raised px-4 py-2 text-sm font-medium text-text-gold transition-all">
                  ◇ Shop
                </Link>
              </div>
            </>
          )}
        </div>
      </PageTransition>
    </LoadingSequence>
  );
}

// ─── Quest Steps ────────────────────────────────────────────
function QuestSteps({ player, estate }: { player: any; estate: any }) {
  const buildings = estate?.buildings as Array<{ buildingType: number; status: number; level: number }> | undefined;
  const hasBuilding = (type: number) =>
    !!buildings?.some((b) => b.buildingType === type && (b.status === 2 || b.status === 3) && b.level >= 1);

  const totalUnits =
    (player.defensiveUnit1?.toNumber?.() ?? 0) +
    (player.defensiveUnit2?.toNumber?.() ?? 0) +
    (player.defensiveUnit3?.toNumber?.() ?? 0) +
    (player.operativeUnit1?.toNumber?.() ?? 0) +
    (player.operativeUnit2?.toNumber?.() ?? 0) +
    (player.operativeUnit3?.toNumber?.() ?? 0);

  const steps = [
    { label: "Create Player", done: true, href: "/dashboard", detail: "Account created" },
    { label: "Create Estate", done: !!estate, href: "/estate", detail: "Build your base of operations" },
    { label: "Build Barracks", done: hasBuilding(BuildingId.Barracks), href: "/estate", detail: "Train defensive units" },
    { label: "Build Camp", done: hasBuilding(BuildingId.Camp), href: "/estate", detail: "Train operative units" },
    { label: "Hire Units", done: totalUnits > 0, href: "/economy", detail: "Recruit your first soldiers" },
    { label: "Build Market", done: hasBuilding(BuildingId.Market), href: "/estate", detail: "Purchase equipment" },
    { label: "Build Academy", done: hasBuilding(BuildingId.Academy), href: "/estate", detail: "Unlock research" },
    { label: "Start Research", done: (player.attackBps ?? 0) > 0, href: "/estate?tab=research", detail: "Boost your stats" },
    { label: "Build Stables", done: hasBuilding(BuildingId.Stables), href: "/estate", detail: "Travel between cities" },
    { label: "Travel Between Cities", done: (player.totalIntercityTravels?.toNumber?.() ?? 0) > 0, href: "/travel", detail: "Explore the world" },
    { label: "Fight an Encounter", done: (player.totalEncounterAttacks?.toNumber?.() ?? 0) > 0, href: "/combat", detail: "Battle for loot" },
  ];

  const firstIncomplete = steps.findIndex((s) => !s.done);
  const allDone = firstIncomplete === -1;

  const [collapsed, setCollapsed] = useState(false);

  if (allDone) return null;

  const completedCount = steps.filter((s) => s.done).length;

  return (
    <div className="card">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center justify-between"
      >
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Quest Steps ({completedCount}/{steps.length})
        </h3>
        <span className="text-xs text-text-muted">{collapsed ? "+" : "−"}</span>
      </button>
      {!collapsed && <div className="mt-3 space-y-1.5">
        {steps.map((step, i) => {
          const isCurrent = i === firstIncomplete;
          const isFuture = i > firstIncomplete;
          return (
            <div key={step.label} className="flex items-center gap-3">
              <span className={`w-5 text-center text-sm ${step.done ? "text-green-500" : isCurrent ? "text-text-gold" : "text-zinc-700"}`}>
                {step.done ? "\u2713" : isCurrent ? "\u2192" : "\u25CC"}
              </span>
              <div className="flex-1 min-w-0">
                <span className={`text-sm ${step.done ? "text-text-muted line-through" : isCurrent ? "text-text-primary font-medium" : "text-zinc-600"}`}>
                  {step.label}
                </span>
                {isCurrent && (
                  <span className="ml-2 text-xs text-text-muted">{step.detail}</span>
                )}
              </div>
              {isCurrent && (
                <Link
                  href={step.href}
                  className="shrink-0 rounded-md border border-amber-800/50 bg-amber-900/20 px-2.5 py-1 text-xs font-medium text-text-gold transition-colors hover:bg-amber-900/40"
                >
                  Go &rarr;
                </Link>
              )}
            </div>
          );
        })}
      </div>}
    </div>
  );
}
