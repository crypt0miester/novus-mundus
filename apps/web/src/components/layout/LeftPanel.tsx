"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useEstate } from "@/lib/hooks/useEstate";
import { useStamina } from "@/lib/hooks/useStamina";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { GameIcon } from "@/components/shared/GameIcon";
import { WorldClock } from "@/components/shared/WorldClock";
import { StatBar } from "@/components/shared/StatBar";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { getTierInfo, getCachedTier } from "@/lib/hooks/useTierTheme";
import { useDomainName } from "@/lib/hooks/useDomainName";
import { useNoviGenerator } from "@/lib/hooks/useNoviGenerator";
import { cn, formatNumber } from "@/lib/utils";
import { useSheetStore } from "@/lib/store/sheet";
import { WalletMultiButton } from "@/components/shared/wallet-adapter";
import { CairnReport } from "@/components/cairn/CairnReport";
import { createUpdateLockedNoviInstruction, deciToNovi } from "novus-mundus-sdk";
import { useUnread } from "@/lib/hooks/useUnread";

/** Desktop left sidebar — vertical card stack with player data + resources. */
export function LeftPanel() {
  const { publicKey } = useWallet();
  const unread = useUnread();
  const { data: playerData } = usePlayer();
  const { data: estateData } = useEstate();
  const client = useNovusMundusClient();
  const transact = useTransact();
  const player = playerData?.account;
  const estate = estateData?.account;

  const stamina = useStamina(player);

  const domain = useDomainName(publicKey);

  const { tier, active } = player
    ? (() => {
        const now = Math.floor(Date.now() / 1000);
        const end = Number(player.subscriptionEnd);
        return {
          tier: Math.min(player.subscriptionTier, 3),
          active: end > now,
        };
      })()
    : { tier: getCachedTier(), active: false };
  const tierInfo = getTierInfo(tier, active);

  // NOVI accrual ticker — shared with the status bar and mobile sidebar.
  const { pendingNovi } = useNoviGenerator();

  const handleClaim = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const geKey = client.gameEngine;
    const ix = await createUpdateLockedNoviInstruction({
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

  const activeBuildings =
    estate?.buildings?.filter((b: any) => b.status === 2 || b.status === 3).length ?? 0;
  const constructingBuildings =
    estate?.buildings?.filter((b: any) => b.status === 1 || b.status === 4).length ?? 0;
  const plotsOwned = estate?.plotsOwned ?? 0;
  const maxSlots = plotsOwned * 4;

  return (
    // Bottom padding keeps the last card clear of the fixed Cairn (CairnPresence).
    <div className="flex flex-col gap-3 p-3 pb-44">
      {/* Player identity */}
      <div className="rounded-lg border border-border-default bg-surface-raised p-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text-primary truncate">
            {domain || player.name || "Player"}
          </span>
          {tierInfo.hasBadge && <span className="tier-badge text-[10px]">[{tierInfo.badge}]</span>}
        </div>
        <div className="mt-1 text-xs text-text-muted">Level {player.level}</div>
      </div>

      {/* Messages — unread DMs + team war-room (count from useUnread). */}
      <Link
        href="/messages"
        className="flex items-center justify-between rounded-lg border border-border-default bg-surface-raised p-3 transition-colors hover:border-[var(--seal)]"
      >
        <span className="flex items-center gap-1.5 text-xs text-text-muted">
          <MessageSquare className="h-3.5 w-3.5" />
          Messages
        </span>
        {unread.total > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[10px] font-bold text-surface">
            {unread.total}
          </span>
        )}
      </Link>

      {/* Stamina */}
      <div className="rounded-lg border border-border-default bg-surface-raised p-3">
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 text-text-muted">
            <GameIcon id="resource-stamina" size={14} />
            Stamina
          </span>
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
          <span className="flex items-center gap-1.5 text-text-muted">
            <GameIcon id="resource-novi" size={14} />
            NOVI
          </span>
          <GoldNumber value={deciToNovi(player.lockedNovi)} size="sm" format="compact" />
        </div>
        {pendingNovi > 0 && (
          <div className="mt-2 flex items-center justify-between">
            <span className="font-mono text-xs text-emerald-400">
              +{formatNumber(pendingNovi, "compact")}
            </span>
            <TxButton
              onClick={handleClaim}
              className="h-6 px-2 text-[10px] font-semibold leading-none w-20"
            >
              Claim
            </TxButton>
          </div>
        )}
      </div>

      {/* Cash + Gems */}
      <div className="rounded-lg border border-border-default bg-surface-raised p-3 space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 text-text-muted">
            <GameIcon id="resource-cash" size={14} />
            Cash
          </span>
          <GoldNumber value={Number(player.cashOnHand)} size="sm" format="compact" />
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 text-text-muted">
            <GameIcon id="resource-gem" size={14} />
            Gems
          </span>
          <GoldNumber value={Number(player.gems)} size="sm" format="compact" />
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
            <span className="font-semibold text-text-primary">{estate.estateLevel ?? 0}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-muted">Plots</span>
            <span className="text-text-primary">{plotsOwned}/5</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-muted">Buildings</span>
            <span className="text-text-primary">
              {activeBuildings + constructingBuildings}/{maxSlots}
            </span>
          </div>
        </div>
      )}

      <CairnReport />
    </div>
  );
}

/** Mobile collapsible top bar — compact summary that expands to full data. */
export function LeftPanelMobile() {
  const { publicKey } = useWallet();
  const { data: playerData } = usePlayer();
  const client = useNovusMundusClient();
  const transact = useTransact();
  const player = playerData?.account;

  const stamina = useStamina(player);

  const domain = useDomainName(publicKey);

  const { tier, active } = player
    ? (() => {
        const now = Math.floor(Date.now() / 1000);
        const end = Number(player.subscriptionEnd);
        return {
          tier: Math.min(player.subscriptionTier, 3),
          active: end > now,
        };
      })()
    : { tier: getCachedTier(), active: false };
  const tierInfo = getTierInfo(tier, active);

  const [expanded, setExpanded] = useState(false);

  // /map turns the page into a fullscreen disc (z-30) with its own
  // floating chrome — lift the data bar above the parchment so the
  // player's identity strip stays readable. Other routes keep the
  // default stacking so the bar doesn't poke through the wallet
  // modal scrim (z-50).
  const pathname = usePathname();
  const mapFullscreen = pathname === "/map" || pathname?.startsWith("/map/");

  // Open intent drops the instant a sheet is dismissed (before its close
  // animation): drop the full data panel down while a detail sheet is open —
  // the player is mid-decision and wants resources in view — and collapse it
  // the moment the sheet closes, with no lingering delay.
  const sheetOpen = useSheetStore((s) => s.openSheets.length > 0);
  useEffect(() => {
    setExpanded(sheetOpen);
  }, [sheetOpen]);

  // NOVI accrual ticker — shared via useNoviGenerator (see LeftPanel above).
  const { pendingNovi } = useNoviGenerator();

  const handleClaim = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const geKey = client.gameEngine;
    const ix = await createUpdateLockedNoviInstruction({
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
    <div
      className={cn(
        "border-b border-border-default bg-[var(--nm-bg-bar)]",
        mapFullscreen && "relative z-[55]",
      )}
    >
      <div className="flex h-10 w-full items-center gap-2 px-2 text-xs">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className="font-medium text-text-primary truncate">
            {domain || player.name || "Player"}
          </span>
          {tierInfo.hasBadge && <span className="tier-badge text-[9px]">[{tierInfo.badge}]</span>}
          <span className="text-text-muted">Lv {player.level}</span>
          <span className="text-text-muted">
            <GoldNumber value={deciToNovi(player.lockedNovi)} size="sm" format="compact" />
          </span>
        </button>
        <WorldClock compact />
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
        <button
          onClick={() => setExpanded(!expanded)}
          aria-label={expanded ? "Collapse details" : "Expand details"}
          className="flex-shrink-0 text-text-muted"
        >
          {expanded ? "\u25B2" : "\u25BC"}
        </button>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-border-default px-4 py-3 space-y-3">
          {/* Resources row */}
          <div className="grid grid-cols-4 gap-3 text-xs">
            <div>
              <div className="flex items-center gap-1 text-text-muted">
                <GameIcon id="resource-novi" size={12} />
                NOVI
              </div>
              <GoldNumber value={deciToNovi(player.lockedNovi)} size="sm" format="compact" />
            </div>
            <div>
              <div className="flex items-center gap-1 text-text-muted">
                <GameIcon id="resource-cash" size={12} />
                Cash
              </div>
              <GoldNumber value={Number(player.cashOnHand)} size="sm" format="compact" />
            </div>
            <div>
              <div className="flex items-center gap-1 text-text-muted">
                <GameIcon id="resource-gem" size={12} />
                Gems
              </div>
              <GoldNumber value={Number(player.gems)} size="sm" format="compact" />
            </div>
            <div>
              <div className="flex items-center gap-1 text-text-muted">
                <GameIcon id="resource-stamina" size={12} />
                Stamina
              </div>
              <GoldNumber value={stamina.current} size="sm" format="compact" />
              /
              <GoldNumber value={stamina.max} size="sm" format="compact" animate={false} />
            </div>
          </div>

          {/* NOVI claim */}
          {pendingNovi > 0 && (
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-emerald-400">
                +{formatNumber(pendingNovi, "compact")} NOVI pending
              </span>
              <TxButton
                onClick={handleClaim}
                className="h-6 px-2 text-[10px] font-semibold leading-none w-auto"
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
