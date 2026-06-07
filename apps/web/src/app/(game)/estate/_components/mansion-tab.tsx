"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { createDailyClaimInstruction, findBuilding } from "novus-mundus-sdk";
import { BuildingId } from "@/lib/hooks/useFeatureGate";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useEstate } from "@/lib/hooks/useEstate";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { TxButton, type TxPhase } from "@/components/shared/TxButton";
import { ProgressRing } from "@/components/shared/ProgressRing";
import { GoldCountdown } from "@/components/shared/GoldCountdown";
import { FeatureLayout } from "./feature-layout";
import { BuildingShowcase } from "./building-showcase";

// Mirrors `EstateAccount::get_streak_multiplier_bps` on-chain. Keep in sync if
// the on-chain tiers ever change — there is no SDK helper for this yet.
function streakMultiplierBps(streak: number): number {
  if (streak >= 90) return 30000;
  if (streak >= 60) return 25000;
  if (streak >= 30) return 20000;
  if (streak >= 14) return 15000;
  if (streak >= 7) return 12500;
  if (streak >= 1) return 10000;
  return 10000;
}

interface Milestone {
  day: number;
  novi: number;
  extra: string;
}

const MILESTONES: readonly Milestone[] = [
  { day: 7, novi: 500, extra: "100 uncommon" },
  { day: 14, novi: 1_000, extra: "50 rare" },
  { day: 30, novi: 5_000, extra: "25 epic · Dedicated title" },
  { day: 60, novi: 15_000, extra: "10 legendary · cosmetic" },
  { day: 90, novi: 30_000, extra: "Artifact · Unwavering title" },
  { day: 180, novi: 100_000, extra: "Legendary artifact · permanent +5%" },
] as const;

function nextMilestone(streak: number): Milestone | null {
  return MILESTONES.find((m) => m.day > streak) ?? null;
}

function fmtMultiplier(bps: number): string {
  const mult = bps / 10000;
  return mult === Math.floor(mult) ? `${mult}x` : `${mult.toFixed(2).replace(/\.?0+$/, "")}x`;
}

function fmtPct(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;
}

export function MansionTab() {
  const { publicKey } = useWallet();
  const { data: playerData } = usePlayer();
  const { data: estateData } = useEstate();
  const client = useNovusMundusClient();
  const transact = useTransact();

  const player = playerData?.account;
  const estate = estateData?.account;

  const mansionLevel = estate ? (findBuilding(estate, BuildingId.Mansion)?.level ?? 0) : 0;
  const streak = estate?.loginStreak ?? 0;
  const longestStreak = estate?.longestLoginStreak ?? 0;
  const permanentBonusBps = estate?.permanentBonusBps ?? 0;
  const lastLoginDate = estate?.lastLoginDate ?? 0;

  const streakBps = streakMultiplierBps(streak);
  const mansionBonusBps = mansionLevel * 500;
  const milestone = nextMilestone(streak);

  // The on-chain mansion claim gates on calendar-day comparison
  // (`current_day == last_login_date` → already claimed). The next claim window
  // opens at the next UTC midnight, not 24h after the last claim.
  const now = Math.floor(Date.now() / 1000);
  const currentDay = Math.floor(now / 86400);
  const available = currentDay > lastLoginDate;
  const nextMidnight = (currentDay + 1) * 86400;
  const cooldownPct = available
    ? 100
    : Math.max(0, Math.min(100, ((now - currentDay * 86400) / 86400) * 100));

  const handleClaim = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ix = await createDailyClaimInstruction({
      owner: publicKey,
      gameEngine: client.gameEngine,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"], ["estate"]],
        successMessage: "Daily reward claimed!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  if (!player || !estate) {
    return <div className="card text-center text-sm text-text-muted">Loading the hall…</div>;
  }

  if (mansionLevel < 1) {
    return (
      <div className="card text-center">
        <p className="text-sm text-text-secondary">
          The hall has no roof yet. Raise the Mansion to begin the daily ledger.
        </p>
      </div>
    );
  }

  return (
    <FeatureLayout
      aside={
        <>
          <div className="card accent-border">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Daily Reward
            </h3>
            <div className="flex items-center gap-4">
              <ProgressRing percent={cooldownPct} size={84}>
                {available ? (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-text-gold">
                    Ready
                  </span>
                ) : (
                  <span className="font-mono text-sm font-bold tabular-nums text-text-gold">
                    {Math.floor(cooldownPct)}%
                  </span>
                )}
              </ProgressRing>
              <div className="min-w-0 flex-1">
                {available ? (
                  <>
                    <p className="mb-2 text-sm text-text-secondary">
                      The hall keeps a ledger. Today's entry is yours to take.
                    </p>
                    <TxButton onClick={handleClaim} className="w-auto px-4 py-1.5 text-xs">
                      Claim
                    </TxButton>
                  </>
                ) : (
                  <>
                    <div className="text-xs text-text-muted">Next reward in</div>
                    <GoldCountdown endsAt={nextMidnight} format="compact" size="sm" />
                    <p className="mt-2 text-[11px] text-text-muted">
                      Miss a day and the streak resets to zero.
                    </p>
                  </>
                )}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded border border-border-default/60 px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-wider text-text-muted">Base</div>
                <div className="mt-0.5 font-mono text-xs font-semibold text-text-secondary">
                  50 NOVI
                </div>
              </div>
              <div className="rounded border border-border-default/60 px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-wider text-text-muted">
                  Materials
                </div>
                <div className="mt-0.5 font-mono text-xs font-semibold text-text-secondary">
                  100
                </div>
              </div>
              <div className="rounded border border-border-default/60 px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-wider text-text-muted">XP</div>
                <div className="mt-0.5 font-mono text-xs font-semibold text-text-secondary">10</div>
              </div>
            </div>
          </div>

          {milestone ? (
            <div className="card">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Next Milestone
              </h3>
              <div className="flex items-baseline justify-between gap-3">
                <div>
                  <div className="font-display text-2xl font-bold tabular-nums text-text-gold">
                    Day {milestone.day}
                  </div>
                  <div className="text-[11px] text-text-muted">
                    in {milestone.day - streak} day{milestone.day - streak === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm font-semibold text-text-secondary tabular-nums">
                    +{milestone.novi.toLocaleString()} NOVI
                  </div>
                  <div className="text-[11px] text-text-muted">{milestone.extra}</div>
                </div>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-overlay">
                <div
                  className="h-full bg-gradient-to-r from-[var(--nm-accent)] to-[var(--nm-accent-bright)]"
                  style={{ width: `${Math.min(100, (streak / milestone.day) * 100)}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="card">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Milestones
              </h3>
              <p className="text-sm text-text-secondary">
                Every milestone reached. The hall remembers — keep returning.
              </p>
            </div>
          )}
        </>
      }
      main={
        <>
          <BuildingShowcase buildingId={BuildingId.Mansion} icon="nav-estate" />

          <div className="card">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Login Streak
            </h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-text-muted">Current</div>
                <div className="mt-1 font-display text-3xl font-bold tabular-nums text-text-gold">
                  {streak}
                </div>
                <div className="text-[10px] text-text-muted">day{streak === 1 ? "" : "s"}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-text-muted">
                  Multiplier
                </div>
                <div className="mt-1 font-display text-3xl font-bold tabular-nums text-text-gold">
                  {fmtMultiplier(streakBps)}
                </div>
                <div className="text-[10px] text-text-muted">streak bonus</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-text-muted">Longest</div>
                <div className="mt-1 font-display text-3xl font-bold tabular-nums text-text-secondary">
                  {longestStreak}
                </div>
                <div className="text-[10px] text-text-muted">
                  day{longestStreak === 1 ? "" : "s"}
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Permanent Bonuses
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-text-muted">
                  Mansion Level
                </div>
                <div className="mt-0.5 font-mono text-sm font-semibold text-text-secondary tabular-nums">
                  Lv {mansionLevel} · +{fmtPct(mansionBonusBps)}
                </div>
                <div className="text-[10px] text-text-muted">on every daily payout</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-text-muted">
                  180-Day Bonus
                </div>
                <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
                  {permanentBonusBps > 0 ? (
                    <span className="text-text-gold">+{fmtPct(permanentBonusBps)}</span>
                  ) : (
                    <span className="text-text-muted">—</span>
                  )}
                </div>
                <div className="text-[10px] text-text-muted">
                  {permanentBonusBps > 0 ? "Unwavering, applied always" : "earned at day 180"}
                </div>
              </div>
            </div>
          </div>
        </>
      }
    />
  );
}
