"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useUser } from "@/lib/hooks/useUser";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useLoot } from "@/lib/hooks/useLoot";
import { useNoviBalance } from "@/lib/hooks/useNoviBalance";
import { useStamina } from "@/lib/hooks/useStamina";
import { useCombatPower, useTravelProgress, useSubscriptionStatus } from "@/lib/hooks/useDerived";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { GameIcon } from "@/components/shared/GameIcon";
import { ProgressRing } from "@/components/shared/ProgressRing";
import { useNoviGenerator } from "@/lib/hooks/useNoviGenerator";
import { GoldCountdown } from "@/components/shared/GoldCountdown";
import { UnitGrid } from "@/components/shared/UnitGrid";
import { PageTransition } from "@/components/shared/PageTransition";
import { NoviGenerator } from "@/components/shared/NoviGenerator";
import { NoviRewards } from "@/components/shared/NoviRewards";
import { ActivityFeed } from "@/components/shared/ActivityFeed";
import { LoadingSequence, getLoadingSteps } from "@/components/loading/LoadingSequence";
import { useRightPanelStore } from "@/lib/store/right-panel";
import Link from "next/link";
import { GameInfoPanel } from "@/components/shared/GameInfoPanel";
import { InfoGrid } from "@/components/shared/InfoGrid";
import { bpsToMultiplier, formatTime, formatNumber } from "@/lib/utils";
import { xpRequiredForLevel, levelProgressPercent, deciToNovi } from "novus-mundus-sdk";

export default function DashboardPage() {
  const { data: playerData, isSuccess: playerReady } = usePlayer();
  const { data: userData, isSuccess: userReady } = useUser();
  const { data: geData, isSuccess: geReady } = useGameEngine();
  const { data: lootData, isSuccess: lootReady } = useLoot();

  const player = playerData?.account;
  const power = useCombatPower();
  const travel = useTravelProgress();
  const sub = useSubscriptionStatus();
  const stamina = useStamina(player);
  const novi = useNoviBalance();
  const noviGen = useNoviGenerator();
  const showPanel = useRightPanelStore((s) => s.show);

  const xpForNext = player ? xpRequiredForLevel(player.level + 1) : 0;
  const xpProgress = player ? levelProgressPercent(player.level, Number(player.currentXp)) : 0;
  const networth = player ? Number(player.networth) : 0;
  const staminaPct = stamina.max > 0 ? (stamina.current / stamina.max) * 100 : 0;

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
    <LoadingSequence
      steps={getLoadingSteps("dashboard")}
      screen="dashboard"
      completedKeys={completedKeys}
    >
      <PageTransition>
        <div className="flex flex-col gap-3">
          {/* Header row */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
            <h1 className="tier-title font-display text-xl font-bold tracking-wide sm:text-2xl">
              STATUS
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted sm:gap-3">
              {player && (
                <div className="flex flex-wrap gap-2">
                  <Link
                    href="/estate?building=vault"
                    className="accent-border rounded bg-surface-raised px-2.5 py-1 text-xs font-medium text-text-gold"
                  >
                    Collect
                  </Link>
                  {lootCount > 0 && (
                    <button
                      type="button"
                      onClick={() => showPanel("Inventory", "inventory")}
                      className="accent-border-bright rounded bg-surface-raised px-2.5 py-1 text-xs font-medium text-text-gold"
                    >
                      Claim Loot ({lootCount})
                    </button>
                  )}
                  <Link
                    href="/shop"
                    className="accent-border rounded bg-surface-raised px-2.5 py-1 text-xs font-medium text-text-gold"
                  >
                    Shop
                  </Link>
                  <Link
                    href="/shop?tab=subscribe"
                    className="accent-border rounded bg-surface-raised px-2.5 py-1 text-xs font-medium text-text-gold"
                  >
                    Subscribe
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
                    <div className="flex flex-1 items-center gap-3">
                      <ProgressRing percent={travel.pct} size={44} strokeWidth={8}>
                        <span className="text-[9px] font-bold tabular-nums text-text-gold">
                          {Math.floor(travel.pct)}%
                        </span>
                      </ProgressRing>
                      <div className="flex flex-1 items-center justify-between gap-2">
                        <span className="text-sm text-text-secondary">
                          Traveling to City {player.destinationCity}
                        </span>
                        <GoldCountdown
                          endsAt={travel.endsAt}
                          startedAt={travel.startedAt}
                          format="compact"
                          size="sm"
                        />
                      </div>
                    </div>
                  )}
                  {lootCount > 0 && (
                    <button
                      type="button"
                      onClick={() => showPanel("Inventory", "inventory")}
                      className="flex items-center justify-between text-sm text-text-gold hover:opacity-80 sm:gap-2"
                    >
                      <span>{lootCount} unclaimed loot</span>
                      <span className="inline-flex items-center gap-0.5">
                        Claim
                        <ChevronRight className="h-3.5 w-3.5" />
                      </span>
                    </button>
                  )}
                </div>
              )}

              {/* Main grid: player stuff (left 2/3) + NOVI stuff (right 1/3) */}
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                {/* `display:contents` on mobile so these cards join the page grid and
                    `order-*` can interleave them with the right column; lg restores
                    the two-column layout. */}
                <div className="contents lg:flex lg:flex-col lg:gap-3 lg:col-span-2">
                  {/* Vitals — Level/Stamina/NOVI rings. Identity omitted; the left
                      panel and status bar already carry it. */}
                  <div className="card accent-border order-3 lg:order-none">
                    <div className="flex flex-wrap items-center justify-around gap-3">
                      <div className="flex flex-col items-center gap-2">
                        <ProgressRing percent={xpProgress} size={96}>
                          <span className="font-mono text-2xl font-bold leading-none tabular-nums text-text-gold">
                            {player.level}
                          </span>
                          <span className="mt-0.5 text-[9px] uppercase tracking-wider text-text-muted">
                            Level
                          </span>
                        </ProgressRing>
                        <div className="text-center text-[11px] text-text-muted">
                          <span className="font-mono tabular-nums text-text-secondary">
                            {formatNumber(Number(player.currentXp), "compact")}
                          </span>{" "}
                          / {formatNumber(xpForNext, "compact")} XP
                        </div>
                      </div>
                      <div className="flex flex-col items-center gap-2">
                        <ProgressRing percent={staminaPct} size={96}>
                          <span className="font-mono text-2xl font-bold leading-none tabular-nums text-text-gold">
                            {stamina.current}
                          </span>
                          <span className="mt-0.5 text-[9px] uppercase tracking-wider text-text-muted">
                            / {stamina.max}
                          </span>
                        </ProgressRing>
                        <div className="text-center text-[11px] text-text-muted">Stamina</div>
                      </div>
                      <div className="flex flex-col items-center gap-2">
                        <ProgressRing percent={noviGen.fillPct} size={96}>
                          <span className="font-mono text-lg font-bold leading-none tabular-nums text-text-gold">
                            {formatNumber(noviGen.displayNovi, "compact")}
                          </span>
                          <span className="mt-0.5 text-[9px] uppercase tracking-wider text-text-muted">
                            NOVI
                          </span>
                        </ProgressRing>
                        <div className="text-center text-[11px] text-text-muted">
                          {Math.floor(noviGen.fillPct)}% to cap
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 order-4 lg:order-none">
                    <div className="card">
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                        Treasury
                      </h3>
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-sm">
                          <span className="text-text-secondary">NOVI</span>
                          <span className="flex items-center gap-1">
                            <GameIcon id="resource-novi" size={14} />
                            <GoldNumber value={deciToNovi(novi.raw)} />
                          </span>
                        </div>
                        {/* Surface a desync between the wallet's spendable
                            NOVI (ATA balance — what hire/build burn from) and
                            the game-state accounting (player.lockedNovi).
                            They should match; when they don't, the spendable
                            number is the wallet's, not the accounting's. */}
                        {!novi.loading &&
                          deciToNovi(player.lockedNovi) !== deciToNovi(novi.raw) && (
                            <div className="flex justify-between text-[11px] text-text-muted">
                              <span>Vault accounting</span>
                              <span className="font-mono tabular-nums">
                                ◆ {deciToNovi(player.lockedNovi).toLocaleString()}
                              </span>
                            </div>
                          )}
                        <div className="flex justify-between text-sm">
                          <span className="text-text-secondary">Cash</span>
                          <span className="flex items-center gap-1">
                            <GameIcon id="resource-cash" size={14} />
                            <GoldNumber value={Number(player.cashOnHand)} format="full" />
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-text-secondary">Vault</span>
                          <span className="flex items-center gap-1">
                            <GameIcon id="resource-cash" size={14} />
                            <GoldNumber
                              value={Number(player.cashInVault)}
                              format="full"
                              glow={false}
                            />
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-text-secondary">Gems</span>
                          <span className="flex items-center gap-1">
                            <GameIcon id="resource-gem" size={14} />
                            <GoldNumber value={Number(player.gems)} />
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-text-secondary">Fragments</span>
                          <span className="flex items-center gap-1">
                            <GameIcon id="resource-fragments" size={14} />
                            <GoldNumber value={Number(player.fragments)} glow={false} />
                          </span>
                        </div>
                        <div className="mt-1.5 border-t border-border-default pt-1.5 flex justify-between text-sm">
                          <span className="text-text-secondary">Net Worth</span>
                          <GoldNumber value={networth} prefix="⊕ " size="sm" />
                        </div>
                      </div>
                    </div>

                    <div className="card">
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                        Power
                      </h3>
                      <div className="mb-3 text-center">
                        <GoldNumber value={power.total} size="xl" />
                        <div className="text-[10px] text-text-muted">Total Combat Power</div>
                      </div>
                      <UnitGrid
                        defense={[
                          Number(player.defensiveUnit1),
                          Number(player.defensiveUnit2),
                          Number(player.defensiveUnit3),
                        ]}
                        offense={[
                          Number(player.operativeUnit1),
                          Number(player.operativeUnit2),
                          Number(player.operativeUnit3),
                        ]}
                      />
                    </div>
                  </div>

                  <div className="order-6 lg:order-none">
                    <ActivityFeed />
                  </div>

                  {geData?.account &&
                    (() => {
                      const ge = geData.account;
                      const gp = ge.gameplayConfig;
                      const tm = ge.themeConfig.themeMultipliers;
                      return (
                        <div className="order-7 lg:order-none">
                          <GameInfoPanel>
                            <InfoGrid
                              items={[
                                { label: "Kingdom", value: ge.kingdomName, highlight: true },
                                { label: "Theme", value: ge.kingdomTheme.toString() },
                                {
                                  label: "Total Players",
                                  value: Number(ge.totalPlayers).toLocaleString(),
                                },
                                {
                                  label: "Protection",
                                  value: formatTime(
                                    Number(gp.newPlayerProtectionDuration),
                                    "compact",
                                  ),
                                },
                                {
                                  label: "Daily Cash",
                                  value: Number(gp.dailyCashBase).toLocaleString(),
                                },
                                {
                                  label: "Daily XP",
                                  value: Number(gp.dailyXpBase).toLocaleString(),
                                },
                                {
                                  label: "Attack Mult",
                                  value: bpsToMultiplier(tm.attackMultiplier),
                                },
                                {
                                  label: "Defense Mult",
                                  value: bpsToMultiplier(tm.defenseMultiplier),
                                },
                                {
                                  label: "Collection Mult",
                                  value: bpsToMultiplier(tm.collectionMultiplier),
                                },
                              ]}
                            />
                          </GameInfoPanel>
                        </div>
                      );
                    })()}
                </div>

                {/* `display:contents` on mobile (see left column) so these interleave. */}
                <div className="contents lg:flex lg:flex-col lg:gap-3">
                  <div className="order-2 lg:order-none">
                    <NoviGenerator />
                  </div>
                  <div className="order-5 lg:order-none">
                    <NoviRewards />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </PageTransition>
    </LoadingSequence>
  );
}
