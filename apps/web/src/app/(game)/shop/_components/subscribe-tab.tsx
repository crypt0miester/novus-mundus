"use client";

import { useMemo } from "react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useSubscriptionStatus } from "@/lib/hooks/useDerived";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { GoldCountdown } from "@/components/shared/GoldCountdown";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { GameInfoPanel } from "@/components/shared/GameInfoPanel";
import { InfoGrid } from "@/components/shared/InfoGrid";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { bpsToPercent, bpsToMultiplier, formatNumber } from "@/lib/utils";
import {
  derivePlayerPda,
  createPurchaseSubscriptionInstruction,
  getEffectiveTier,
} from "novus-mundus-sdk";

const TIERS = [
  {
    id: 0,
    name: "Rookie",
    price: 0,
    perks: ["Basic access", "Standard stamina regen"],
    color: "text-zinc-400",
  },
  {
    id: 1,
    name: "Expert",
    price: 500,
    perks: ["2x stamina regen", "+10% loot bonus", "Daily gem bonus"],
    color: "text-green-400",
  },
  {
    id: 2,
    name: "Epic",
    price: 1500,
    perks: ["3x stamina regen", "+25% loot bonus", "Daily gem + NOVI bonus", "Flash sale access"],
    color: "text-fuchsia-400",
  },
  {
    id: 3,
    name: "Legendary",
    price: 5000,
    perks: [
      "5x stamina regen",
      "+50% loot bonus",
      "Max daily rewards",
      "Exclusive items",
      "Priority matchmaking",
    ],
    color: "text-amber-400",
  },
];

export function SubscribeTab() {
  const { data: playerData } = usePlayer();
  const { data: geData } = useGameEngine();
  const player = playerData?.account;
  const sub = useSubscriptionStatus();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();

  const nowSec = Math.floor(Date.now() / 1000);
  const effectiveTier = useMemo(() => {
    if (!player) return 0;
    return getEffectiveTier(player, nowSec);
  }, [player, nowSec]);

  const noviBalance = player?.lockedNovi?.toNumber?.() ?? 0;

  const handlePurchase = async (tierId: number, reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const geAccount = geData?.account;
    if (!geAccount) throw new Error("Game engine not loaded");
    const ix = createPurchaseSubscriptionInstruction(
      {
        owner: publicKey,
        gameEngine: ge,
        paymentAuthority: publicKey,
        treasury: geAccount.treasuryWallet,
      },
      { paymentType: 0, tier: tierId }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: `${TIERS[tierId]?.name} charter held.`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-lg font-semibold text-text-primary">
          A Patron&apos;s Charter
        </h2>
        <p className="mt-1 text-xs text-text-muted">
          A charter is a standing arrangement with a patron. Each tier sets what
          it grants and what it costs. The terms are listed below.
        </p>
      </div>

      {/* Current Status */}
      <div className="card accent-border">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-text-muted">Current Charter</div>
            <div className={`text-lg font-bold ${TIERS[sub.tier]?.color || "text-zinc-400"}`}>
              {sub.tierName}
            </div>
          </div>
          {sub.active && sub.expiresAt > 0 && (
            <div className="text-right">
              <div className="text-xs text-text-muted">Expires</div>
              <GoldCountdown endsAt={sub.expiresAt} format="full" />
            </div>
          )}
        </div>
        <div className="mt-3 text-xs text-text-muted">
          <span>Effective charter: </span>
          <span className={TIERS[effectiveTier]?.color || "text-zinc-400"}>
            {TIERS[effectiveTier]?.name || "Unknown"}
          </span>
        </div>
      </div>

      {/* Tier Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {TIERS.map((tier) => {
          const isCurrent = sub.tier === tier.id && sub.active;
          return (
            <div
              key={tier.id}
              className={`card ${
                isCurrent ? "accent-border-bright" : ""
              }`}
            >
              <div className="flex items-center justify-between">
                <div className={`text-lg font-bold ${tier.color}`}>{tier.name}</div>
                {tier.price > 0 && (
                  <div className="text-sm text-text-gold">
                    ✦ {tier.price}/mo
                    {sub.tier > 0 && tier.id > sub.tier && (
                      <span className="ml-2 text-xs text-green-400">
                        +{(tier.price - TIERS[sub.tier].price).toLocaleString()} from current
                      </span>
                    )}
                  </div>
                )}
              </div>
              <ul className="mt-3 space-y-1">
                {tier.perks.map((perk) => (
                  <li key={perk} className="flex items-center gap-2 text-sm text-text-secondary">
                    <span className="text-amber-400">●</span>
                    {perk}
                  </li>
                ))}
              </ul>
              {tier.price > 0 && !isCurrent && (
                <div className="mt-4">
                  <TxButton
                    onClick={(reportPhase) => handlePurchase(tier.id, reportPhase)}
                    variant={tier.id >= 2 ? "primary" : "secondary"}
                    className="w-full"
                  >
                    {sub.tier < tier.id ? "Move to this charter" : "Hold this charter"}
                  </TxButton>
                  {tier.price > noviBalance && (
                    <p className="mt-1 text-center text-[11px] text-red-400">
                      Need {(tier.price - noviBalance).toLocaleString()} more NOVI
                    </p>
                  )}
                </div>
              )}
              {isCurrent && (
                <div className="mt-4 text-center text-xs text-amber-400">Held</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Game Parameters */}
      {geData?.account && (() => {
        const tiers = geData.account.subscriptionTiers;
        return (
          <GameInfoPanel>
            <div className="space-y-3">
              {tiers.map((t) => (
                <div key={t.tierIndex}>
                  <div className="mb-1 text-xs font-semibold text-zinc-400">{t.name} (Tier {t.tierIndex})</div>
                  <InfoGrid items={[
                    { label: "Cost", value: `$${(t.costInUsdCents?.toNumber?.() ?? 0) / 100}` },
                    { label: "Duration", value: `${t.durationDays ?? 0}d` },
                    { label: "Gen Multiplier", value: bpsToMultiplier(t.generationMultiplier?.toNumber?.() ?? 0) },
                    { label: "Max Locked NOVI", value: formatNumber(t.maxLockedNovi?.toNumber?.() ?? 0) },
                    { label: "Daily Reward Mult", value: bpsToMultiplier(t.dailyRewardMultiplier?.toNumber?.() ?? 0) },
                    { label: "Bonus Units", value: `DU: ${t.du1?.toNumber?.() ?? 0}/${t.du2?.toNumber?.() ?? 0}/${t.du3?.toNumber?.() ?? 0}` },
                    { label: "Rally Cap", value: String(t.rallyCaps?.maxRallySize ?? 0) },
                    { label: "Team Size", value: String(t.maxTeamMembers ?? 0) },
                    { label: "Travel Speed", value: bpsToPercent(t.travelSpeedBonusBps ?? 0), suffix: "bonus" },
                  ]} />
                </div>
              ))}
            </div>
          </GameInfoPanel>
        );
      })()}
    </div>
  );
}
