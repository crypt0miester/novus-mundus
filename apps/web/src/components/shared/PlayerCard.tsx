import Link from "next/link";
import { cn } from "@/lib/utils";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { Badge } from "@/components/shared/Badge";
import { UnitGrid } from "@/components/shared/UnitGrid";
import type { PlayerAccount } from "novus-mundus-sdk";

interface PlayerCardProps {
  address: string;
  player: PlayerAccount;
  /** Shown when the player has no on-chain name (e.g. a resolved domain). */
  displayName?: string;
  rank?: number;
  showCity?: boolean;
  cityName?: string;
  showNetworth?: boolean;
  showArmy?: boolean;
  actions?: React.ReactNode;
  compact?: boolean;
  highlight?: boolean;
  className?: string;
}

const TIER_LABELS = ["Rookie", "Expert", "Epic", "Legendary"] as const;
const TIER_VARIANTS = ["default", "info", "epic", "legendary"] as const;

export function PlayerCard({
  address,
  player,
  displayName,
  rank,
  showCity,
  cityName,
  showNetworth = true,
  showArmy,
  actions,
  compact,
  highlight,
  className,
}: PlayerCardProps) {
  const name = player.name || displayName || "Unnamed Warrior";
  const tierIndex = Math.min(player.subscriptionTier, 3);

  return (
    <div className={cn("card transition-all", highlight && "accent-border-bright", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {rank != null && (
            <span
              className={cn(
                "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold",
                rank === 1
                  ? "bg-accent/50 text-gold-400"
                  : rank === 2
                    ? "bg-zinc-700 text-zinc-300"
                    : rank === 3
                      ? "bg-accent/50 text-gold-700"
                      : "bg-zinc-800 text-text-muted",
              )}
            >
              {rank}
            </span>
          )}
          <div className="min-w-0">
            <Link
              href={`/players/${address}`}
              className="block truncate text-sm font-semibold text-text-primary hover:text-text-gold transition-colors"
            >
              {name}
            </Link>
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <span>Lv {player.level}</span>
              {tierIndex > 0 && (
                <Badge variant={TIER_VARIANTS[tierIndex] as any} className="text-[10px] px-1 py-0">
                  {TIER_LABELS[tierIndex]}
                </Badge>
              )}
              {showCity && cityName && <span className="truncate">{cityName}</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          {showNetworth && (
            <div className="text-right">
              <div className="text-[10px] text-text-muted">Networth</div>
              <GoldNumber value={Number(player.networth)} size="sm" />
            </div>
          )}
          {actions && <div>{actions}</div>}
        </div>
      </div>

      {showArmy && !compact && (
        <div className="mt-3 border-t border-border-default pt-3">
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
            compact
          />
        </div>
      )}
    </div>
  );
}
