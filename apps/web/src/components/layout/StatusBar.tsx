"use client";

import { useState, useEffect, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useStamina } from "@/lib/hooks/useStamina";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { StatBar } from "@/components/shared/StatBar";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { getTierInfo, getCachedTier } from "@/lib/hooks/useTierTheme";
import { useDomainName } from "@/lib/hooks/useDomainName";
import { formatNumber } from "@/lib/utils";
import { WalletMultiButton } from "@/components/shared/wallet-adapter";
import {
  createUpdateLockedNoviInstruction,
  getEffectiveTier,
  type SubscriptionTierConfig,
} from "novus-mundus-sdk";

const INTERVAL_SECONDS = 300;

/** Persistent status bar at the bottom of the viewport. Shows player info + resources + mini NOVI generator. */
export function StatusBar() {
  const { publicKey } = useWallet();
  const { data: playerData, isSuccess } = usePlayer();
  const { data: geData } = useGameEngine();
  const client = useNovusMundusClient();
  const transact = useTransact();
  const player = playerData?.account;
  const ge = geData?.account;

  const stamina = useStamina(player);

  const domain = useDomainName(publicKey);

  const tier = player ? (() => {
    const now = Math.floor(Date.now() / 1000);
    const end = player.subscriptionEnd.toNumber();
    return player.subscriptionTier > 0 && end > now
      ? Math.min(player.subscriptionTier, 4)
      : 0;
  })() : getCachedTier();
  const tierInfo = getTierInfo(tier);

  // ── Mini NOVI generator state ──
  const [pendingNovi, setPendingNovi] = useState(0);

  const getTierConfig = useCallback((): SubscriptionTierConfig | null => {
    if (!ge || !player) return null;
    const now = Math.floor(Date.now() / 1000);
    const t = getEffectiveTier(player, now);
    return ge.subscriptionTiers[t] ?? null;
  }, [ge, player]);

  useEffect(() => {
    if (!player || !ge) return;

    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      const tierConfig = getTierConfig();
      if (!tierConfig) return;

      const lastUpdated = player.lastUpdatedTokensAt.toNumber();
      const elapsed = Math.max(0, now - lastUpdated);
      const intervals = Math.floor(elapsed / INTERVAL_SECONDS);
      const genRate = tierConfig.generationMultiplier.toNumber();
      const maxCap = tierConfig.maxLockedNovi.toNumber();
      const currentLocked = player.lockedNovi.toNumber();

      const pending = currentLocked >= maxCap ? 0 : Math.min(intervals * genRate, maxCap - currentLocked);
      setPendingNovi(Math.max(0, pending));
    };

    tick();
    const id = setInterval(tick, 5000); // tick every 5s is fine for the status bar
    return () => clearInterval(id);
  }, [player, ge, getTierConfig]);

  const handleClaim = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const geKey = client.gameEngine;
    const ix = createUpdateLockedNoviInstruction({ owner: publicKey, gameEngine: geKey });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: `Claimed ${formatNumber(pendingNovi, "compact")} NOVI!`,
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  if (!player) return null;

  return (
    <>
    <div className="z-40 flex h-10 items-center gap-4 border-b border-border-default bg-[var(--nm-bg-bar)] px-4 text-xs md:border-b-0 md:border-t lg:px-6">
      {/* Player info */}
      <div className="flex items-center gap-2">
        <span className="font-medium text-text-primary">
          {domain || player.name || "Player"}
        </span>
        {tierInfo.hasBadge && (
          <span className="tier-badge">[{tierInfo.badge}]</span>
        )}
        <span className="text-text-muted">Lv {player.level}</span>
      </div>

      <div className="hidden h-4 w-px bg-border-default sm:block" />

      {/* Resources */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1">
          <span className="text-text-muted">⚡</span>
          <GoldNumber
            value={stamina.current}
            size="sm"
            suffix={`/${stamina.max}`}
          />
        </div>
        <div className="hidden items-center gap-1 sm:flex">
          <span className="text-text-muted">◆</span>
          <GoldNumber
            value={player.lockedNovi.toNumber()}
            size="sm"
            format="compact"
          />
        </div>
        <div className="hidden items-center gap-1 sm:flex">
          <span className="text-text-muted">$</span>
          <GoldNumber
            value={player.cashOnHand.toNumber()}
            size="sm"
            format="compact"
          />
        </div>
        <div className="hidden items-center gap-1 sm:flex">
          <span className="text-text-muted">✦</span>
          <GoldNumber
            value={player.gems.toNumber()}
            size="sm"
            format="compact"
          />
        </div>
      </div>

      <div className="hidden h-4 w-px bg-border-default md:block" />

      {/* Stamina bar */}
      <div className="hidden w-20 md:block">
        <StatBar
          current={stamina.current}
          max={stamina.max}
          size="sm"
          showValues={false}
          color="tier"
        />
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Mini NOVI generator — desktop only (mobile uses pulsing dot near player name) */}
      {pendingNovi > 0 && (
        <div className="hidden items-center gap-2 md:flex">
          <span className="font-mono text-emerald-400">
            +{formatNumber(pendingNovi, "compact")}
          </span>
          <TxButton
            onClick={handleClaim}
            className="h-6 px-2 text-[10px] font-semibold leading-none"
          >
            Claim
          </TxButton>
        </div>
      )}

      {/* Wallet button — visible on mobile only (TopBar hidden) */}
      <div className="md:hidden">
        <WalletMultiButton
          style={{
            background: "var(--nm-bg-raised)",
            border: "1px solid var(--nm-border)",
            borderRadius: "0.375rem",
            fontSize: "0.65rem",
            height: "1.5rem",
            padding: "0 0.5rem",
            color: "var(--nm-text-secondary)",
          }}
        />
      </div>
    </div>

    {/* Floating claim pill — mobile only, above bottom nav */}
    {pendingNovi > 0 && (
      <div className="fixed bottom-20 right-3 z-50 md:hidden">
        <TxButton
          onClick={handleClaim}
          className="flex items-center gap-1.5 rounded-full bg-emerald-900/80 px-3 py-1.5 shadow-lg shadow-emerald-900/30 backdrop-blur-sm"
        >
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-mono text-[11px] font-semibold text-emerald-300">
            +{formatNumber(pendingNovi, "compact")}
          </span>
        </TxButton>
      </div>
    )}
    </>
  );
}
