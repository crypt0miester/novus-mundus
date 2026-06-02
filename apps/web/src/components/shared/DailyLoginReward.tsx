"use client";

import { useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useDailyRewards } from "@/lib/hooks/useDerived";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { TxButton } from "./TxButton";
import type { TxPhase } from "./TxButton";
import { GoldCountdown } from "./GoldCountdown";
import { GameIcon, type GameIconId } from "./GameIcon";
import { InfoButton } from "./InfoButton";
import { cn, formatNumber } from "@/lib/utils";
import {
  createClaimDailyRewardInstruction,
  getEffectiveTier,
  calculateDailyRewards,
  applyBpsBonus,
} from "novus-mundus-sdk";

interface DailyLoginRewardProps {
  className?: string;
}

/**
 * The progression daily LOGIN reward (claim_daily_reward, Ix 90) — cash +
 * produce + XP on a 24h rolling cooldown, scaled by subscription tier and any
 * Daily-Rewards research bonus. Distinct from the Mansion login-streak claim on
 * the estate (daily_claim, Ix 165), which mints NOVI + materials.
 *
 * Preflight-gated to mirror the on-chain processor: the button is hidden behind
 * the research unlock (hasDailyRewards -> FeatureLocked) and behind the cooldown
 * (ClaimCooldownActive), so a player never fires a tx that bounces.
 */
export function DailyLoginReward({ className }: DailyLoginRewardProps) {
  const { data: playerData } = usePlayer();
  const { data: geData } = useGameEngine();
  const { publicKey } = useWallet();
  const client = useNovusMundusClient();
  const transact = useTransact();
  const { available, cooldownEnds, hasDailyRewards } = useDailyRewards();

  const player = playerData?.account;

  // Reward preview mirrors claim_daily_reward.rs: the tier multiplier
  // (calculate_daily_rewards) then the research bonus (apply_bp_bonus), each
  // flooring — reuse the SDK ports so the preview can't drift from the chain's
  // two-step rounding. XP is still a floor: the on-chain golden-hour time bonus
  // can push the real grant higher.
  const preview = useMemo(() => {
    if (!player || !geData?.account) return null;
    const tier = getEffectiveTier(player, Math.floor(Date.now() / 1000));
    const gp = geData.account.gameplayConfig;
    const multBps = Number(geData.account.subscriptionTiers[tier].dailyRewardMultiplier);
    const researchBps = player.researchDailyRewardBps;
    const tierRewards = calculateDailyRewards(
      Number(gp.dailyCashBase),
      Number(gp.dailyProduceBase),
      Number(gp.dailyXpBase),
      multBps,
    );
    const withResearch = (v: number) => (researchBps > 0 ? applyBpsBonus(v, researchBps) : v);
    return {
      cash: withResearch(tierRewards.cash),
      produce: withResearch(tierRewards.produce),
      xp: withResearch(tierRewards.xp),
      multBps,
    };
  }, [player, geData]);

  const handleClaim = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ix = await createClaimDailyRewardInstruction({
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

  if (!player) return null;

  return (
    <div className={cn("card", className)}>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Daily Login Reward{" "}
          <InfoButton>
            Cash, produce, and XP once every 24h, scaled by your subscription tier. Separate from the
            Mansion login streak.
          </InfoButton>
        </h3>
        {preview && preview.multBps !== 10_000 && (
          <span className="font-mono text-[10px] text-text-gold">{preview.multBps / 10_000}x</span>
        )}
      </div>

      {!hasDailyRewards ? (
        <p className="text-xs italic text-text-muted">
          Unlock the daily login reward in the Research tree first.
        </p>
      ) : (
        <>
          {preview && (
            <div className="mb-3 grid grid-cols-3 gap-2">
              <RewardCell icon="resource-cash" label="Cash" value={preview.cash} />
              <RewardCell icon="resource-produce" label="Produce" value={preview.produce} />
              <RewardCell icon="buff-xp-gain" label="XP" value={preview.xp} muted />
            </div>
          )}
          {available ? (
            <TxButton onClick={handleClaim} className="w-full">
              Claim Daily Reward
            </TxButton>
          ) : (
            <div className="flex items-center justify-center gap-2 rounded-lg bg-surface-overlay/30 px-3 py-2 text-xs text-text-muted">
              <span>Next claim in</span>
              <GoldCountdown endsAt={cooldownEnds} format="compact" size="sm" />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RewardCell({
  icon,
  label,
  value,
  muted,
}: {
  icon: GameIconId;
  label: string;
  value: number;
  muted?: boolean;
}) {
  return (
    <div className="rounded-lg bg-surface/60 px-2 py-2 text-center">
      <div className="mb-1 flex items-center justify-center">
        <GameIcon id={icon} size={16} />
      </div>
      <div
        className={cn(
          "font-mono text-sm font-semibold tabular-nums",
          muted ? "text-text-secondary" : "text-text-gold",
        )}
      >
        +{formatNumber(value)}
      </div>
      <div className="text-[9px] uppercase tracking-wider text-text-muted">{label}</div>
    </div>
  );
}
