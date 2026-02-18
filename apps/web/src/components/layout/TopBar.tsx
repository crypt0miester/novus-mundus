"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@/components/shared/wallet-adapter";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useEstate } from "@/lib/hooks/useEstate";
import { cn } from "@/lib/utils";
import { useState } from "react";

// Staggered nav priority tiers (typography only, single row)
const PRIMARY = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/estate", label: "Estate" },
  { href: "/combat", label: "Combat" },
  { href: "/economy", label: "Economy" },
];

const SECONDARY = [
  { href: "/travel", label: "Travel" },
  { href: "/hero", label: "Hero" },
  { href: "/team", label: "Team" },
  { href: "/castle", label: "Castle" },
  { href: "/city", label: "City" },
  { href: "/shop", label: "Shop" },
];

const TERTIARY = [
  { href: "/inventory", label: "Inventory" },
  { href: "/map", label: "Map" },
  { href: "/settings", label: "Settings" },
  { href: "/world/leaderboard", label: "Leaderboard" },
];

export function TopBar() {
  const pathname = usePathname();
  const { publicKey } = useWallet();
  const { data: playerData, isSuccess } = usePlayer();
  const { data: estateData } = useEstate();
  const player = playerData?.account;
  const [moreOpen, setMoreOpen] = useState(false);

  // Lock checks
  const hasPlayer = !!player;
  const hasEstate = !!estateData?.account;
  const buildings = estateData?.account?.buildings;
  const extensions = player?.extensions ?? 0;
  const teamKey = player?.team;
  const hasTeam = !!teamKey && teamKey.toBase58() !== "11111111111111111111111111111111";
  const hasBuilding = (type: number) =>
    !!buildings?.some((b: any) => b.buildingType === type && (b.status === 2 || b.status === 3) && b.level >= 1);

  const pageLocked: Record<string, boolean> = hasPlayer ? {
    "/economy": !hasEstate,
    "/combat": !hasEstate,
    "/travel": !hasEstate || !hasBuilding(17),
    "/hero": !hasEstate || !hasBuilding(9),
    "/team": !(extensions & (1 << 2)),
    "/castle": !hasTeam,
    "/shop": !(extensions & (1 << 0)),
  } : {};

  const isActive = (href: string) =>
    pathname === href || pathname?.startsWith(href + "/");

  const disabled = isSuccess && !hasPlayer;

  function NavLink({ href, label, size }: { href: string; label: string; size: "primary" | "secondary" | "tertiary" }) {
    const active = isActive(href);
    const locked = pageLocked[href];
    const sizeClass = size === "primary"
      ? "text-sm font-semibold"
      : size === "secondary"
        ? "text-xs font-medium"
        : "text-[11px] text-text-muted";

    if (disabled) {
      return (
        <span className={cn(sizeClass, "pointer-events-none text-zinc-700")}>
          {label}
        </span>
      );
    }

    return (
      <Link
        href={href}
        className={cn(
          sizeClass,
          "transition-colors whitespace-nowrap",
          active
            ? "tier-accent-text"
            : locked
              ? "text-zinc-600 hover:text-zinc-500"
              : "text-text-secondary hover:text-text-primary"
        )}
      >
        {label}
        {locked && <span className="ml-0.5 text-[9px] text-zinc-700">&#9676;</span>}
      </Link>
    );
  }

  return (
    <header className="z-40 flex h-12 items-center gap-4 bg-[var(--nm-bg-bar)] px-4 lg:px-6">
      {/* Logo */}
      <Link href="/dashboard" className="flex-shrink-0">
        <span className="tier-title font-display text-sm font-semibold tracking-wide">
          NM
        </span>
      </Link>

      {/* Primary nav — always visible */}
      <nav className="flex items-center gap-3">
        {PRIMARY.map((item) => (
          <NavLink key={item.href} href={item.href} label={item.label} size="primary" />
        ))}
      </nav>

      {/* Secondary nav — hidden on small mobile */}
      <nav className="hidden items-center gap-2.5 md:flex">
        {SECONDARY.map((item) => (
          <NavLink key={item.href} href={item.href} label={item.label} size="secondary" />
        ))}
      </nav>

      {/* Tertiary nav — hidden below lg */}
      <nav className="hidden items-center gap-2 lg:flex">
        {TERTIARY.map((item) => (
          <NavLink key={item.href} href={item.href} label={item.label} size="tertiary" />
        ))}
      </nav>

      {/* Mobile overflow menu */}
      <div className="relative md:hidden">
        <button
          onClick={() => setMoreOpen(!moreOpen)}
          className="text-xs text-text-muted hover:text-text-primary"
        >
          More
        </button>
        {moreOpen && (
          <div className="absolute right-0 top-full mt-1 z-50 flex flex-col gap-1 rounded-lg border border-border-default bg-surface-raised p-2 shadow-lg min-w-[140px]">
            {[...SECONDARY, ...TERTIARY].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMoreOpen(false)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs transition-colors",
                  isActive(item.href)
                    ? "tier-accent-text"
                    : "text-text-secondary hover:bg-surface-overlay"
                )}
              >
                {item.label}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Wallet */}
      <WalletMultiButton
        style={{
          background: "var(--nm-bg-raised)",
          border: "1px solid var(--nm-border)",
          borderRadius: "0.375rem",
          fontSize: "0.75rem",
          height: "2rem",
          padding: "0 0.75rem",
          color: "var(--nm-text-secondary)",
        }}
      />
    </header>
  );
}
