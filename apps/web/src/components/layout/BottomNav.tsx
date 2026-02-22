"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useEstate } from "@/lib/hooks/useEstate";
import { cn } from "@/lib/utils";
import { PRIMARY, SECONDARY } from "./nav-config";

export function BottomNav() {
  const pathname = usePathname();
  const { data: playerData, isSuccess } = usePlayer();
  const { data: estateData } = useEstate();
  const player = playerData?.account;

  const hasPlayer = !!player;
  const hasEstate = !!estateData?.account;
  const buildings = estateData?.account?.buildings;
  const extensions = player?.extensions ?? 0;
  const hasBuilding = (type: number) =>
    !!buildings?.some((b: any) => b.buildingType === type && (b.status === 2 || b.status === 3) && b.level >= 1);

  const pageLocked: Record<string, boolean> = hasPlayer
    ? {
        "/combat": !hasEstate,
        "/map": !hasEstate || !hasBuilding(17),
        "/team": !(extensions & (1 << 2)),
        "/shop": !(extensions & (1 << 0)),
      }
    : {};

  const disabled = isSuccess && !hasPlayer;

  const isActive = (href: string) =>
    pathname === href || pathname?.startsWith(href + "/");

  return (
    <div className="z-40 flex flex-col border-t border-border-default bg-[var(--nm-bg-bar)] md:hidden">
      {/* Secondary row */}
      <nav className="flex items-center justify-center gap-4 px-2 py-1.5 border-b border-zinc-800/40">
        {SECONDARY.map((item) => {
          const active = isActive(item.href);
          const locked = !!pageLocked[item.href];
          if (disabled) {
            return (
              <span key={item.href} className="text-[10px] text-zinc-700">
                {item.label}
              </span>
            );
          }
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "text-[10px] font-medium transition-colors whitespace-nowrap",
                active
                  ? "tier-accent-text"
                  : locked
                    ? "text-zinc-600"
                    : "text-text-muted hover:text-text-secondary",
              )}
            >
              {item.label}
              {locked && <span className="ml-0.5 text-[8px] text-zinc-700">&#9676;</span>}
            </Link>
          );
        })}
      </nav>

      {/* Primary row */}
      <nav className="flex items-stretch">
        {PRIMARY.map((item) => {
          const active = isActive(item.href);
          const locked = !!pageLocked[item.href];
          if (disabled) {
            return (
              <span
                key={item.href}
                className="flex flex-1 items-center justify-center py-2.5 text-[11px] font-semibold text-zinc-700"
              >
                {item.label}
              </span>
            );
          }
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-1 items-center justify-center py-2.5 text-[11px] font-semibold transition-colors",
                active
                  ? "tier-accent-text bg-surface-overlay/50"
                  : locked
                    ? "text-zinc-600"
                    : "text-text-secondary active:bg-surface-overlay/30",
              )}
            >
              {item.label}
              {locked && <span className="ml-0.5 text-[8px] text-zinc-700">&#9676;</span>}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
