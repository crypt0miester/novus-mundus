"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useStamina } from "@/lib/hooks/useStamina";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { GameIcon } from "@/components/shared/GameIcon";
import { WorldClock } from "@/components/shared/WorldClock";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { getTierInfo, getCachedTier } from "@/lib/hooks/useTierTheme";
import { useDomainName } from "@/lib/hooks/useDomainName";
import { useNoviGenerator } from "@/lib/hooks/useNoviGenerator";
import { cn, formatNumber } from "@/lib/utils";
import { useSheetStore } from "@/lib/store/sheet";
import { WalletMultiButton } from "@/components/shared/wallet-adapter";
import { createUpdateLockedNoviInstruction, deciToNovi } from "novus-mundus-sdk";

// The desktop resource HUD that used to live here was retired into
// ResourceFooter (it now pins to the foot of the contextual SideDrawer at md+).
// Only the mobile (<md) collapsible top bar remains.

/** Mobile collapsible top bar: compact summary that expands to full data. */
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

  // /map turns the page into a fullscreen disc (z-30) with its own floating
  // chrome, so lift the data bar above the parchment so the player's identity
  // strip stays readable. Other routes keep the default stacking so the bar
  // doesn't poke through the wallet modal scrim (z-50).
  const pathname = usePathname();
  const mapFullscreen = pathname === "/map" || pathname?.startsWith("/map/");

  // Open intent drops the instant a sheet is dismissed (before its close
  // animation): drop the full data panel down while a detail sheet is open (the
  // player is mid-decision and wants resources in view) and collapse it the
  // moment the sheet closes, with no lingering delay.
  const sheetOpen = useSheetStore((s) => s.openSheets.length > 0);
  useEffect(() => {
    setExpanded(sheetOpen);
  }, [sheetOpen]);

  // NOVI accrual ticker, shared via useNoviGenerator (see ResourceFooter).
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

  if (!player) {
    return (
      <div
        className={cn(
          "border-b border-border-default bg-[var(--nm-bg-bar)]",
          mapFullscreen && "relative z-[55]",
        )}
      >
        <div className="flex h-10 w-full items-center gap-2 px-2 text-xs">
          <Link
            href="/estate"
            className="tier-accent-text flex min-w-0 flex-1 items-center gap-1.5 truncate text-left font-semibold"
          >
            Spectating
            <span className="text-text-muted">- claim your seat</span>
          </Link>
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
        </div>
      </div>
    );
  }

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
          {expanded ? "▲" : "▼"}
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

      {/* Floating claim pill: mobile only, above bottom nav */}
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
