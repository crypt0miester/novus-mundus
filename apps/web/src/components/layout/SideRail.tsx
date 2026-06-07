"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Shirt,
  MessageSquare,
  Users,
  Building2,
  Wallet,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { GameIcon } from "@/components/shared/GameIcon";
import { useRightPanelStore } from "@/lib/store/right-panel";
import { useSidebar } from "@/lib/store/sidebar";
import { useDrawerOpen, useDrawerClassMode, type DrawerClassMode } from "@/lib/hooks/useDrawerOpen";
import { useRailGlider } from "@/lib/hooks/useRailGlider";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useNavItems, type ResolvedNavItem } from "@/lib/hooks/useNavItems";
import { ICON_BY_LABEL, spectatorClass } from "./nav-config";
import { isActiveRoute } from "@/lib/nav/sections";
import { SideRailIcon } from "./SideRailIcon";
import { cn, formatNumber } from "@/lib/utils";
import { deciToNovi } from "novus-mundus-sdk";
import type { GameIconId } from "@/components/shared/GameIcon";

// Four labels lack a flat `nav-*` glyph; until they are authored, the rail
// (and the drawer) fall back to a lucide icon so the destination still reads.
const LUCIDE_FALLBACK: Record<string, LucideIcon> = {
  Wardrobe: Shirt,
  Messages: MessageSquare,
  Players: Users,
  Cities: Building2,
};

// The persistent icon rail: logo on top, a drawer toggle, the primary section
// icons, a divider, the browse cluster, the personal cluster at the foot, then
// the account area (world clock + wallet, lifted off the removed TopBar). The
// rail itself never collapses; the contextual drawer beside it does (its
// chevron, mirrored by the rail's re-open affordance). Shown from md+ now that
// the desktop TopBar is gone.
//
// When the drawer is collapsed, two extras surface on the rail: mini NOVI/Cash
// chips (the most-glanced numbers survive the collapse), and a children flyout
// on hover/focus of a section icon (so deep links stay reachable). Both gate on
// the collapsed state, expressed in CSS for the chips (flash-free) and as a
// boolean for the flyout.
export function SideRail() {
  const pathname = usePathname();
  const { primary, secondary } = useNavItems();
  const showPanel = useRightPanelStore((s) => s.show);
  const drawerOpen = useDrawerOpen();
  const drawerMode = useDrawerClassMode();
  const toggleDrawer = useSidebar((s) => s.toggleDrawer);
  const openAccount = useSidebar((s) => s.openAccount);
  const accountOpen = useSidebar((s) => s.accountOpen);
  const { connected } = useWallet();

  // The active-square glider: one element behind the icons that slides to the
  // active route's icon (doc 9). Re-measures on route change and when the rail
  // reflows (the collapse-gated mini chips shift the foot icons).
  const { navRef, gliderRef, visible: gliderVisible } = useRailGlider([pathname, drawerMode]);

  // The drawer owns a section while its route is active; the rail's primary icon
  // for that owner highlights even on a child deep-link (e.g. /estate?... keeps
  // Estate lit). isActiveRoute on the base href covers this since children share it.

  // The resolved children of a primary section (Estate/Team/Shop), in nav-config
  // order, for the collapsed-mode flyout. Pulled from the resolved list so their
  // lock/disable/spectator states match the open drawer's section list.
  const childrenOf = (sectionLabel: string): ResolvedNavItem[] =>
    secondary.filter((r): r is ResolvedNavItem => r !== null && r.item.section === sectionLabel);

  // The browse + personal clusters are the standalone SECONDARY screens (no
  // `section`, no `panel`), placed by their spectator class so the rail follows
  // nav-config: adding a browse/personal screen there surfaces it here with no
  // edit. The resolver already dropped capability-hidden items (personal items
  // hide for spectators), preserving nav-config order.
  const standalone = (cls: "browse" | "personal"): ResolvedNavItem[] =>
    secondary.filter(
      (r): r is ResolvedNavItem =>
        r !== null && !r.item.section && !r.item.panel && spectatorClass(r.item) === cls,
    );

  const browse = standalone("browse");
  const personal = standalone("personal");
  const inventory = secondary.find((r) => r !== null && r.item.panel === "inventory") ?? null;

  const railIconFor = (resolved: ResolvedNavItem) => {
    const { item } = resolved;
    const iconId: GameIconId | undefined = ICON_BY_LABEL[item.label];
    const lucide = LUCIDE_FALLBACK[item.label];
    return (
      <SideRailIcon
        key={item.href ?? item.panel ?? item.label}
        label={item.label}
        iconId={iconId}
        lucide={lucide}
        href={resolved.href}
        active={item.href ? isActiveRoute(pathname, item.href) : false}
        locked={resolved.locked}
        disabled={resolved.disabled}
        unread={resolved.badge}
        collapsed={!drawerOpen}
        sectionChildren={childrenOf(item.label)}
        isActiveHref={(href) => isActiveRoute(pathname, href)}
      />
    );
  };

  return (
    <nav
      ref={navRef}
      aria-label="Primary"
      // The rail is the clip's dark ink strip in both themes (--nm-rail), with a
      // light foreground (--nm-rail-fg, applied per-icon in SideRailIcon). The
      // active icon flips to the tier accent. Border drops the cream divider for
      // a faint light hairline that reads on the dark rail. `relative` anchors
      // the active-square glider.
      className="relative hidden md:flex w-16 flex-shrink-0 flex-col items-center gap-1 border-r border-[var(--nm-rail-fg)]/10 bg-[var(--nm-rail)] py-3 text-[var(--nm-rail-fg)]"
    >
      {/* Active-square glider: a single translucent accent square that slides
          behind the active icon (doc 9). Sits below the icons (the buttons are
          z-10); its translateY/height are driven imperatively by useRailGlider.
          Hidden (opacity 0) on routes the rail does not own, so it never lingers
          on a stale icon. */}
      <span
        ref={gliderRef}
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 -ml-5 h-10 w-10 rounded-xl bg-accent/15 transition-opacity duration-150"
        style={{ opacity: gliderVisible ? 1 : 0 }}
      />
      {/* Logo */}
      <Link href="/dashboard" aria-label="Novus Mundus home" className="flex h-10 w-10 items-center justify-center">
        <img src="/img/logo/logo-gold.svg" alt="Novus Mundus" className="h-7 w-7" width={28} height={28} />
      </Link>
      <span aria-hidden className="my-1 h-px w-8 bg-[var(--nm-rail-fg)]/15" />

      {/* Drawer toggle: the re-open affordance when collapsed (the drawer's own
          chevron collapses it). Mirrors the drawer's aria-controls so both ends
          of the toggle are wired to the same region. */}
      <button
        type="button"
        onClick={toggleDrawer}
        aria-label={drawerOpen ? "Collapse menu" : "Expand menu"}
        aria-expanded={drawerOpen}
        aria-controls="side-drawer"
        className="mb-1 flex h-8 w-10 items-center justify-center rounded-lg text-[var(--nm-rail-fg)]/70 transition-colors hover:bg-[var(--nm-rail-fg)]/10 hover:text-[var(--nm-rail-fg)]"
      >
        {drawerOpen ? (
          <PanelLeftClose className="h-4 w-4" aria-hidden />
        ) : (
          <PanelLeftOpen className="h-4 w-4" aria-hidden />
        )}
      </button>

      {/* Primary section icons */}
      {primary.map((resolved) => {
        if (!resolved) return null;
        return railIconFor(resolved);
      })}

      {/* Divider before the browse cluster (a faint light hairline on the dark rail) */}
      <span aria-hidden className="my-1 h-px w-8 bg-[var(--nm-rail-fg)]/15" />

      {/* Browse cluster */}
      {browse.map(railIconFor)}

      {/* Spacer pushes the personal cluster + account to the foot */}
      <div className="flex-1" />

      {/* Mini resource chips: NOVI + Cash, shown only when the drawer is
          collapsed so the most-glanced numbers survive the collapse. Visibility
          tracks the same collapsed state as the drawer, expressed in CSS so it
          is flash-free on first paint (responsive when the user has no pinned
          preference). */}
      <MiniResourceChips mode={drawerMode} />

      {/* Divider before the personal cluster (faint light hairline on the dark rail) */}
      <span aria-hidden className="my-1 h-px w-8 bg-[var(--nm-rail-fg)]/15" />

      {/* Personal cluster (foot): Wardrobe, Messages (unread dot), Settings.
          The Inventory panel entry sits with them and opens the RightPanel. */}
      {personal.map(railIconFor)}
      {inventory && (
        <SideRailIcon
          label={inventory.item.label}
          iconId={ICON_BY_LABEL[inventory.item.label]}
          onClick={() => showPanel(inventory.item.label, inventory.item.panel!)}
          active={false}
          disabled={inventory.disabled}
          collapsed={!drawerOpen}
        />
      )}

      {/* Account: a small wallet icon (no pubkey). Clicking opens the drawer onto
          the account panel (wallet dropdown + day/night clock + actions), which
          has room for their menus, instead of the rail foot where they opened
          off-screen. A dot marks a connected wallet. */}
      <button
        type="button"
        onClick={openAccount}
        aria-label="Account"
        title="Account"
        className={cn(
          "relative mt-1 flex h-10 w-10 items-center justify-center rounded-xl transition-colors",
          accountOpen
            ? "bg-accent/15 text-[var(--tier-accent)]"
            : "text-[var(--nm-rail-fg)]/70 hover:bg-[var(--nm-rail-fg)]/10 hover:text-[var(--nm-rail-fg)]",
        )}
      >
        <Wallet className="h-5 w-5" aria-hidden />
        {connected && (
          <span
            aria-hidden
            className="absolute right-2 top-2 h-2 w-2 rounded-full bg-accent ring-2 ring-[var(--nm-rail)]"
          />
        )}
      </button>
    </nav>
  );
}

// The two compact resource chips on the rail (NOVI + Cash). A spectator has no
// player, so the chips render nothing then; otherwise they show the same locked
// NOVI + cash-on-hand the drawer foot does, formatted compact. Visibility is
// gated by the drawer collapse state in CSS: a pinned-open drawer hides them, a
// pinned-collapsed drawer shows them, and an unpinned drawer follows the lg
// breakpoint (visible below lg, hidden at lg+).
function MiniResourceChips({ mode }: { mode: DrawerClassMode }) {
  const { data: playerData } = usePlayer();
  const player = playerData?.account;
  if (!player) return null;

  const visibility =
    mode === "open"
      ? "hidden"
      : mode === "collapsed"
        ? "flex"
        : "flex lg:hidden";

  return (
    <div className={cn("flex-col items-center gap-1", visibility)}>
      <Chip iconId="resource-novi" label="NOVI" value={deciToNovi(player.lockedNovi)} />
      <Chip iconId="resource-cash" label="Cash" value={Number(player.cashOnHand)} />
    </div>
  );
}

function Chip({ iconId, label, value }: { iconId: GameIconId; label: string; value: number }) {
  return (
    <span
      title={`${label}: ${formatNumber(value)}`}
      // A glance-only mirror of the drawer foot; sits on the dark rail, so its
      // fill + text track the rail foreground rather than the cream surfaces.
      className="flex w-12 flex-col items-center rounded-md bg-[var(--nm-rail-fg)]/10 px-1 py-1 text-[var(--nm-rail-fg)]/80"
    >
      {/* The GameIcon title carries the resource name; the hover title spells the
          exact value out. The chip is a glance-only mirror of the drawer foot. */}
      <GameIcon id={iconId} size={14} title={label} />
      <span className="mt-0.5 font-mono text-[9px] leading-none tabular-nums">
        {formatNumber(value, "compact")}
      </span>
    </span>
  );
}
