"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { WalletMultiButton } from "@/components/shared/wallet-adapter";
import { WorldClock } from "@/components/shared/WorldClock";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useEstate } from "@/lib/hooks/useEstate";
import { useRightPanelStore } from "@/lib/store/right-panel";
import { useSheetStore } from "@/lib/store/sheet";
import { cn } from "@/lib/utils";
import { PRIMARY, SECONDARY, computePageLocks } from "./nav-config";

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
  const sizeClass = size === "primary" ? "text-sm font-semibold" : "text-[11px] font-medium";

  if (disabled) {
    return <span className={cn(sizeClass, "pointer-events-none text-zinc-700")}>{label}</span>;
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
            : "text-text-secondary hover:text-text-primary",
      )}
    >
      {label}
      {locked && <span className="ml-0.5 text-[9px] text-zinc-700">&#9676;</span>}
    </Link>
  );
}

export function TopBar() {
  const pathname = usePathname();
  const { data: playerData, isSuccess } = usePlayer();
  const { data: estateData } = useEstate();
  const player = playerData?.account;
  const showPanel = useRightPanelStore((s) => s.show);
  // Lift above a bottom sheet's backdrop (tablet widths still show this bar) —
  // for as long as it is painted, including the close animation.
  const sheetOpen = useSheetStore((s) => s.mounted > 0);

  // The secondary nav is collapsed by default; the `+` toggle morphs the bar's
  // centre from the primary tabs to the full secondary list and back.
  const [expanded, setExpanded] = useState(false);

  // The morph only exists at lg+ — below that the secondary list has no room
  // to sit. Force it shut whenever the viewport drops under that width so the
  // `expanded` state can never be stranded behind a hidden toggle.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => {
      if (!mq.matches) setExpanded(false);
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Collapse back to the primary tabs on navigation and on Escape.
  useEffect(() => {
    setExpanded(false);
  }, [pathname]);
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  // Lock checks
  const hasPlayer = !!player;
  const hasEstate = !!estateData?.account;
  const extensions = player?.extensions ?? 0;

  const pageLocked = computePageLocks(hasPlayer, hasEstate, extensions);

  const isActive = (href: string) => pathname === href || pathname?.startsWith(href + "/");

  const disabled = isSuccess && !hasPlayer;

  return (
    <header
      className={cn(
        "hidden md:grid h-10 grid-cols-[1fr_auto_1fr] items-center bg-[var(--nm-bg-bar)] border-b border-zinc-800/50 px-4 lg:px-6",
        sheetOpen ? "z-[55]" : "z-40",
      )}
    >
      {/* Logo — left rail */}
      <Link href="/dashboard" className="flex items-center gap-2">
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

      {/* Centre — the primary tabs, morphing to the secondary list when
          expanded. Both navs share one grid cell so the centre keeps a fixed
          width (and stays viewport-centred) as it cross-fades between them;
          `inert` takes the hidden layer out of focus + the a11y tree. */}
      <div className="grid">
        <nav
          aria-label="Primary"
          inert={expanded}
          className={cn(
            "col-start-1 row-start-1 flex items-center justify-center gap-3 transition-opacity duration-200",
            expanded ? "opacity-0" : "opacity-100",
          )}
        >
          {PRIMARY.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              size="primary"
              active={isActive(item.href)}
              locked={!!pageLocked[item.href]}
              disabled={disabled}
            />
          ))}
        </nav>

        <nav
          aria-label="Secondary"
          inert={!expanded}
          onClick={() => setExpanded(false)}
          className={cn(
            "col-start-1 row-start-1 hidden items-center justify-center gap-2 transition-opacity duration-200 lg:flex",
            expanded ? "opacity-100" : "opacity-0",
          )}
        >
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
                    : "text-text-secondary hover:text-text-primary",
                )}
              >
                {item.label}
              </button>
            ) : (
              <NavLink
                key={item.href}
                href={item.href!}
                label={item.label}
                size="secondary"
                active={isActive(item.href!)}
                locked={!!pageLocked[item.href!]}
                disabled={disabled}
              />
            ),
          )}
        </nav>
      </div>

      {/* Right rail — world clock + morph toggle + wallet */}
      <div className="flex items-center justify-end gap-2">
        <WorldClock />
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "Hide menu" : "More"}
          aria-expanded={expanded}
          className="hidden h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-raised hover:text-text-secondary lg:inline-flex"
        >
          <Plus
            className={cn("h-4 w-4 transition-transform duration-200", expanded && "rotate-45")}
          />
        </button>
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
      </div>
    </header>
  );
}
