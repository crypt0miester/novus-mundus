"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useStamina } from "@/lib/hooks/useStamina";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { StatBar } from "@/components/shared/StatBar";
import { getTierInfo, getCachedTier } from "@/lib/hooks/useTierTheme";
import { useDomainName } from "@/lib/hooks/useDomainName";

/** Persistent status bar at the bottom of the viewport. Shows player info + resources + alerts. */
export function StatusBar() {
  const { publicKey } = useWallet();
  const { data: playerData, isSuccess } = usePlayer();
  const player = playerData?.account;

  const stamina = useStamina(
    player?.encounterStamina?.toNumber(),
    player?.lastStaminaUpdate?.toNumber(),
    player?.maxEncounterStamina?.toNumber(),
    player ? 1 / 60 : undefined
  );

  const domain = useDomainName(publicKey);

  const tier = player ? (() => {
    const now = Math.floor(Date.now() / 1000);
    const end = player.subscriptionEnd.toNumber();
    return player.subscriptionTier > 0 && end > now
      ? Math.min(player.subscriptionTier, 4)
      : 0;
  })() : getCachedTier();
  const tierInfo = getTierInfo(tier);

  if (!player) return null;

  return (
    <footer className="z-40 flex h-10 items-center gap-4 border-t border-border-default bg-[var(--nm-bg-bar)] px-4 text-xs lg:px-6">
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
    </footer>
  );
}
