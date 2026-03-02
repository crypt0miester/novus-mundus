"use client";

import { useState, useEffect, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useEstate } from "@/lib/hooks/useEstate";
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
  findBuilding,
  type SubscriptionTierConfig,
} from "@/lib/sdk";

const INTERVAL_SECONDS = 300;

/** Desktop left sidebar — vertical card stack with player data + resources. */
export function LeftPanel() {
  const { publicKey } = useWallet();
  const { data: playerData } = usePlayer();
  const { data: geData } = useGameEngine();
  const { data: estateData } = useEstate();
  const client = useNovusMundusClient();
  const transact = useTransact();
  const player = playerData?.account;
  const ge = geData?.account;
  const estate = estateData?.account;

  const stamina = useStamina(
    player?.encounterStamina?.toNumber(),
    player?.lastStaminaUpdate?.toNumber(),
    player?.maxEncounterStamina?.toNumber(),
    player ? 1 / 60 : undefined
  );

  const domain = useDomainName(publicKey);

  const tier = player
    ? (() => {
        const now = Math.floor(Date.now() / 1000);
        const end = player.subscriptionEnd.toNumber();
        return player.subscriptionTier > 0 && end > now
          ? Math.min(player.subscriptionTier, 4)
          : 0;
      })()
    : getCachedTier();
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

      const pending =
        currentLocked >= maxCap
          ? 0
          : Math.min(intervals * genRate, maxCap - currentLocked);
      setPendingNovi(Math.max(0, pending));
    };

    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, [player, ge, getTierConfig]);

  const handleClaim = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const geKey = client.gameEngine;
    const ix = createUpdateLockedNoviInstruction({
      owner: publicKey,
      gameEngine: geKey,
    });
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

  const activeBuildings = estate?.buildings?.filter(
    (b: any) => b.status === 2 || b.status === 3
  ).length ?? 0;
  const constructingBuildings = estate?.buildings?.filter(
    (b: any) => b.status === 1 || b.status === 4
  ).length ?? 0;
  const plotsOwned = estate?.plotsOwned ?? 0;
  const maxSlots = plotsOwned * 4;

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Player identity */}
      <div className="rounded-lg border border-border-default bg-surface-raised p-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text-primary truncate">
            {domain || player.name || "Player"}
          </span>
          {tierInfo.hasBadge && (
            <span className="tier-badge text-[10px]">[{tierInfo.badge}]</span>
          )}
        </div>
        <div className="mt-1 text-xs text-text-muted">
          Level {player.level}
        </div>
      </div>

      {/* Stamina */}
      <div className="rounded-lg border border-border-default bg-surface-raised p-3">
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="text-text-muted">Stamina</span>
          <span className="font-mono tabular-nums text-text-secondary">
            {stamina.current}/{stamina.max}
          </span>
        </div>
        <StatBar
          current={stamina.current}
          max={stamina.max}
          size="sm"
          showValues={false}
          color="tier"
        />
      </div>

      {/* NOVI + Claim */}
      <div className="rounded-lg border border-border-default bg-surface-raised p-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-muted">NOVI</span>
          <GoldNumber
            value={player.lockedNovi.toNumber()}
            size="sm"
            format="compact"
          />
        </div>
        {pendingNovi > 0 && (
          <div className="mt-2 flex items-center justify-between">
            <span className="font-mono text-xs text-emerald-400">
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
      </div>

      {/* Cash + Gems */}
      <div className="rounded-lg border border-border-default bg-surface-raised p-3 space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-muted">Cash</span>
          <GoldNumber
            value={player.cashOnHand.toNumber()}
            size="sm"
            format="compact"
          />
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-muted">Gems</span>
          <GoldNumber
            value={player.gems.toNumber()}
            size="sm"
            format="compact"
          />
        </div>
      </div>

      {/* Estate summary */}
      {estate && (
        <div className="rounded-lg border border-border-default bg-surface-raised p-3 space-y-1.5">
          <div className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            Estate
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-muted">Level</span>
            <span className="font-semibold text-text-primary">
              {estate.estateLevel ?? 0}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-muted">Plots</span>
            <span className="text-text-primary">
              {plotsOwned}/5
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-muted">Buildings</span>
            <span className="text-text-primary">
              {activeBuildings + constructingBuildings}/{maxSlots}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Mobile collapsible top bar — compact summary that expands to full data. */
export function LeftPanelMobile() {
  const { publicKey } = useWallet();
  const { data: playerData } = usePlayer();
  const { data: geData } = useGameEngine();
  const client = useNovusMundusClient();
  const transact = useTransact();
  const player = playerData?.account;
  const ge = geData?.account;

  const stamina = useStamina(
    player?.encounterStamina?.toNumber(),
    player?.lastStaminaUpdate?.toNumber(),
    player?.maxEncounterStamina?.toNumber(),
    player ? 1 / 60 : undefined
  );

  const domain = useDomainName(publicKey);

  const tier = player
    ? (() => {
        const now = Math.floor(Date.now() / 1000);
        const end = player.subscriptionEnd.toNumber();
        return player.subscriptionTier > 0 && end > now
          ? Math.min(player.subscriptionTier, 4)
          : 0;
      })()
    : getCachedTier();
  const tierInfo = getTierInfo(tier);

  const [expanded, setExpanded] = useState(false);

  // ── NOVI generator ──
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

      const pending =
        currentLocked >= maxCap
          ? 0
          : Math.min(intervals * genRate, maxCap - currentLocked);
      setPendingNovi(Math.max(0, pending));
    };

    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, [player, ge, getTierConfig]);

  const handleClaim = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const geKey = client.gameEngine;
    const ix = createUpdateLockedNoviInstruction({
      owner: publicKey,
      gameEngine: geKey,
    });
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
    <div className="border-b border-border-default bg-[var(--nm-bg-bar)]">
      {/* Collapsed bar */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex h-10 w-full items-center gap-3 px-4 text-xs"
      >
        <span className="font-medium text-text-primary truncate">
          {domain || player.name || "Player"}
        </span>
        {tierInfo.hasBadge && (
          <span className="tier-badge text-[9px]">[{tierInfo.badge}]</span>
        )}
        <span className="text-text-muted">Lv {player.level}</span>
        <div className="h-3 w-px bg-border-default" />
        <span className="text-text-muted">
          {stamina.current}/{stamina.max}
        </span>
        <div className="h-3 w-px bg-border-default" />
        <span className="text-text-muted">
          <GoldNumber
            value={player.lockedNovi.toNumber()}
            size="sm"
            format="compact"
          />
        </span>
        <div className="ml-auto flex items-center gap-2">
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
          <span className="text-text-muted">
            {expanded ? "\u25B2" : "\u25BC"}
          </span>
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-border-default px-4 py-3 space-y-3">
          {/* Resources row */}
          <div className="grid grid-cols-4 gap-3 text-xs">
            <div>
              <div className="text-text-muted">NOVI</div>
              <GoldNumber
                value={player.lockedNovi.toNumber()}
                size="sm"
                format="compact"
              />
            </div>
            <div>
              <div className="text-text-muted">Cash</div>
              <GoldNumber
                value={player.cashOnHand.toNumber()}
                size="sm"
                format="compact"
              />
            </div>
            <div>
              <div className="text-text-muted">Gems</div>
              <GoldNumber
                value={player.gems.toNumber()}
                size="sm"
                format="compact"
              />
            </div>
            <div>
              <div className="text-text-muted">Stamina</div>
              <div className="font-mono tabular-nums text-text-secondary">
                {stamina.current}/{stamina.max}
              </div>
            </div>
          </div>

          {/* Stamina bar */}
          <StatBar
            current={stamina.current}
            max={stamina.max}
            size="sm"
            showValues={false}
            color="tier"
          />

          {/* NOVI claim */}
          {pendingNovi > 0 && (
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-emerald-400">
                +{formatNumber(pendingNovi, "compact")} NOVI pending
              </span>
              <TxButton
                onClick={handleClaim}
                className="h-6 px-2 text-[10px] font-semibold leading-none"
              >
                Claim
              </TxButton>
            </div>
          )}
        </div>
      )}

      {/* Floating claim pill — mobile only, above bottom nav */}
      {pendingNovi > 0 && !expanded && (
        <div className="fixed bottom-20 right-3 z-50">
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
    </div>
  );
}
