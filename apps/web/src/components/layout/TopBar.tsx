"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@/components/shared/wallet-adapter";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useEstate } from "@/lib/hooks/useEstate";
import { useRightPanelStore } from "@/lib/store/right-panel";
import { cn } from "@/lib/utils";
import { PRIMARY, SECONDARY } from "./nav-config";

function NavLink({
  href,
  label,
  size,
  active,
  locked,
  disabled,
}: {
  href: string;
  label: string;
  size: "primary" | "secondary";
  active: boolean;
  locked: boolean;
  disabled: boolean;
}) {
  const sizeClass = size === "primary"
    ? "text-sm font-semibold"
    : "text-[11px] font-medium text-text-muted";

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
            : size === "secondary"
              ? "text-text-muted hover:text-text-secondary"
              : "text-text-secondary hover:text-text-primary"
      )}
    >
      {label}
      {locked && <span className="ml-0.5 text-[9px] text-zinc-700">&#9676;</span>}
    </Link>
  );
}

export function TopBar() {
  const pathname = usePathname();
  const { publicKey } = useWallet();
  const { data: playerData, isSuccess } = usePlayer();
  const { data: estateData } = useEstate();
  const player = playerData?.account;
  const showPanel = useRightPanelStore((s) => s.show);

  // Lock checks
  const hasPlayer = !!player;
  const hasEstate = !!estateData?.account;
  const buildings = estateData?.account?.buildings;
  const extensions = player?.extensions ?? 0;
  const hasBuilding = (type: number) =>
    !!buildings?.some((b: any) => b.buildingType === type && (b.status === 2 || b.status === 3) && b.level >= 1);

  const pageLocked: Record<string, boolean> = hasPlayer ? {
    "/combat": !hasEstate,
    "/map": !hasEstate || !hasBuilding(17),
    "/team": !(extensions & (1 << 2)),
    "/shop": !(extensions & (1 << 0)),
  } : {};

  const isActive = (href: string) =>
    pathname === href || pathname?.startsWith(href + "/");

  const disabled = isSuccess && !hasPlayer;

  return (
    <header className="z-40 hidden md:flex h-10 items-center bg-[var(--nm-bg-bar)] border-b border-zinc-800/50 px-4 lg:px-6">
      {/* Logo */}
      <Link href="/dashboard" className="flex flex-shrink-0 items-center gap-2">
        <img
          src="/img/logo/logo-gold.svg"
          alt="Novus Mundus"
          className="h-6 w-6"
          width={24}
          height={24}
        />
        <span className="tier-title font-display text-sm font-semibold tracking-wide">
          NovusMundus
        </span>
      </Link>

      {/* Primary nav (centered) */}
      <nav className="flex flex-1 items-center justify-center gap-3">
        {PRIMARY.map((item) => (
          <NavLink key={item.href} href={item.href} label={item.label} size="primary" active={isActive(item.href)} locked={!!pageLocked[item.href]} disabled={disabled} />
        ))}
      </nav>

      {/* Secondary nav (compact, before wallet) */}
      <nav className="hidden lg:flex items-center gap-2 mr-3">
        {SECONDARY.map((item) =>
          item.panel ? (
            <button
              key={item.panel}
              type="button"
              onClick={() => showPanel(item.label, item.panel!)}
              disabled={disabled}
              className={cn(
                "text-[11px] font-medium whitespace-nowrap transition-colors",
                disabled
                  ? "pointer-events-none text-zinc-700"
                  : "text-text-muted hover:text-text-secondary",
              )}
            >
              {item.label}
            </button>
          ) : (
            <NavLink key={item.href} href={item.href!} label={item.label} size="secondary" active={isActive(item.href!)} locked={!!pageLocked[item.href!]} disabled={disabled} />
          ),
        )}
      </nav>

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
