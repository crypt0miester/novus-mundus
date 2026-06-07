"use client";

import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useEstate } from "@/lib/hooks/useEstate";
import { useStamina } from "@/lib/hooks/useStamina";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { GameIcon } from "@/components/shared/GameIcon";
import { StatBar } from "@/components/shared/StatBar";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { getTierInfo, getCachedTier } from "@/lib/hooks/useTierTheme";
import { useSubscriptionStatus } from "@/lib/hooks/useDerived";
import { useDomainName } from "@/lib/hooks/useDomainName";
import { useNoviGenerator } from "@/lib/hooks/useNoviGenerator";
import { formatNumber } from "@/lib/utils";
import { createUpdateLockedNoviInstruction, deciToNovi } from "novus-mundus-sdk";

// The condensed resource HUD pinned to the drawer foot: identity + tier badge,
// Stamina, NOVI + Claim, Cash, Gems, Estate summary. Lifted verbatim from
// `LeftPanel` (same components, same spacing) so the two stay in lock-step
// during the transitional phase; the spectator variant points at the claim
// flow instead. Phase 2 mounts it inside the statically-open drawer; the
// LeftPanel aside it replaces is removed from the desktop shell.
export function ResourceFooter() {
  const { publicKey } = useWallet();
  const { data: playerData } = usePlayer();
  const { data: estateData } = useEstate();
  const client = useNovusMundusClient();
  const transact = useTransact();
  const player = playerData?.account;
  const estate = estateData?.account;

  const stamina = useStamina(player);
  const domain = useDomainName(publicKey);

  // Reuse the shared subscription resolver; getTierInfo clamps the tier itself.
  // No player keeps the cached-tier theme rather than snapping to tier 0.
  const sub = useSubscriptionStatus();
  const { tier, active } = player
    ? { tier: sub.tier, active: sub.active }
    : { tier: getCachedTier(), active: false };
  const tierInfo = getTierInfo(tier, active);

  // NOVI accrual ticker, shared with the status bar and mobile sidebar.
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

  if (!player) return <SpectatorFooter />;

  const activeBuildings =
    estate?.buildings?.filter((b: any) => b.status === 2 || b.status === 3).length ?? 0;
  const constructingBuildings =
    estate?.buildings?.filter((b: any) => b.status === 1 || b.status === 4).length ?? 0;
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
          {tierInfo.hasBadge && <span className="tier-badge text-[10px]">[{tierInfo.badge}]</span>}
        </div>
        <div className="mt-1 text-xs text-text-muted">Level {player.level}</div>
      </div>

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
    </div>
  );
}

// Spectator variant, shown in place of the resource stack when there is no
// claimed player. Keeps the drawer foot from going blank and points the visitor
// at the claim flow (estate onboarding). Mirrors LeftPanel's SpectatorRail.
function SpectatorFooter() {
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="rounded-lg border border-border-default bg-surface-raised p-4">
        <div className="text-sm font-semibold text-text-primary">Spectating</div>
        <p className="mt-1 text-xs text-text-muted">
          You are watching the realm. Claim your seat to build an estate, raise an army, and act.
        </p>
        <Link
          href="/estate"
          className="tier-accent-border tier-accent-text mt-3 inline-flex w-full items-center justify-center rounded-md border bg-surface-overlay/40 px-3 py-2 text-xs font-semibold transition-colors hover:bg-surface-overlay/70"
        >
          Claim your seat
        </Link>
      </div>
    </div>
  );
}
