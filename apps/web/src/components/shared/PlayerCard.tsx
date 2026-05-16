import Link from "next/link";
import { cn } from "@/lib/utils";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { Badge } from "@/components/shared/Badge";
import { UnitGrid } from "@/components/shared/UnitGrid";
import type { PlayerAccount } from "novus-mundus-sdk";

interface PlayerCardProps {
  address: string;
  player: PlayerAccount;
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
  const name = player.name || "Unnamed Warrior";
  const tierIndex = Math.min(player.subscriptionTier, 3);

  return (
    <div
      className={cn(
        "card transition-all",
        highlight && "accent-border-bright",
        className
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {rank != null && (
            <span
              className={cn(
                "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold",
                rank === 1
                  ? "bg-amber-900/50 text-amber-400"
                  : rank === 2
                    ? "bg-zinc-700 text-zinc-300"
                    : rank === 3
                      ? "bg-amber-950/50 text-amber-700"
                      : "bg-zinc-800 text-text-muted"
              )}
            >
              {rank}
            </span>
          )}
          <div className="min-w-0">
            <Link
              href={`/world/players/${address}`}
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
              {showCity && cityName && (
                <span className="truncate">{cityName}</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          {showNetworth && (
            <div className="text-right">
              <div className="text-[10px] text-text-muted">Networth</div>
              <GoldNumber value={player.networth.toNumber()} size="sm" />
            </div>
          )}
          {actions && <div>{actions}</div>}
        </div>
      </div>

      {showArmy && !compact && (
        <div className="mt-3 border-t border-border-default pt-3">
          <UnitGrid
            defense={[
              player.defensiveUnit1.toNumber(),
              player.defensiveUnit2.toNumber(),
              player.defensiveUnit3.toNumber(),
            ]}
            offense={[
              player.operativeUnit1.toNumber(),
              player.operativeUnit2.toNumber(),
              player.operativeUnit3.toNumber(),
            ]}
            compact
          />
        </div>
      )}
    </div>
  );
}
