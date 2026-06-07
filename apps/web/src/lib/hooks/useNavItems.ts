"use client";

import { useMemo } from "react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useEstate } from "@/lib/hooks/useEstate";
import { useUnread } from "@/lib/hooks/useUnread";
import { useIsSpectator } from "@/lib/hooks/useCanAct";
import {
  PRIMARY,
  SECONDARY,
  computePageLocks,
  spectatorClass,
  visibleForSpectator,
  type NavItem,
} from "@/components/layout/nav-config";

// Where a spectator is sent when they tap a player-scoped nav item: the estate
// onboarding home, which hosts the claim flow (init_user + init_player + estate).
const CLAIM_HREF = "/estate";

/**
 * A nav item resolved for the current capability. Carries the source `item`
 * (so consumers keep access to its label/section/panel/feature) plus the
 * computed render decisions every consumer needs:
 *
 *   - `href`: the effective destination (a spectator's player-scoped tap lands
 *     on the claim CTA); undefined for panel-entry items, which open a
 *     RightPanel instead of navigating.
 *   - `disabled`: the connected-but-no-player (non-spectator) gate.
 *   - `locked`: page-level lock from `computePageLocks` (Team/Shop extensions).
 *   - `badge`: a true source-backed indicator (today: Messages unread).
 */
export interface ResolvedNavItem {
  item: NavItem;
  href?: string;
  disabled: boolean;
  locked: boolean;
  badge: boolean;
}

export interface NavItemsResult {
  // Resolved entries in nav-config order, section grouping preserved. A `null`
  // slot is an item filtered out for the current capability (a personal item
  // hidden from a spectator, or the panel entry hidden from a spectator), kept
  // positional so consumers iterate and skip identically.
  primary: (ResolvedNavItem | null)[];
  secondary: (ResolvedNavItem | null)[];
}

/**
 * The single shared nav resolver. Folds together `usePlayer`/`useEstate`
 * (player + extensions), `useIsSpectator`, `computePageLocks`, and `useUnread`,
 * applying `spectatorClass` / `visibleForSpectator` and the `CLAIM_HREF`
 * reroute, returning render-ready items. The desktop nav and the mobile
 * MorphTabBar both render from this, so the navs can never drift.
 */
export function useNavItems(): NavItemsResult {
  const unread = useUnread();
  const { data: playerData, isSuccess } = usePlayer();
  const { data: estateData } = useEstate();
  const isSpectator = useIsSpectator();
  const player = playerData?.account;
  const estate = estateData?.account;
  const unreadTotal = unread.total;

  // Memoized so the resolved arrays keep a stable identity across renders (three
  // consumers call this hook, so the resolve pass would otherwise run 3x per
  // render and hand each fresh arrays). Deps are every reactive input the
  // resolver reads; the nav tables and gate helpers are module constants.
  return useMemo(() => {
    const hasPlayer = !!player;
    const hasEstate = !!estate;
    const extensions = player?.extensions ?? 0;
    const pageLocked = computePageLocks(hasPlayer, hasEstate, extensions);

    // Spectator = no claimed seat (anonymous, unclaimed, or viewAs). Browse
    // items stay live for spectators; player-scoped items reroute to the claim
    // CTA; personal items are dropped from the nav. The old blanket disable now
    // only bites player-scoped items for a connected, no-player wallet.
    const playerItemDisabled = isSuccess && !hasPlayer && !isSpectator;

    // Resolve a nav item for the current capability: its effective href (a
    // spectator's player-scoped tap lands on the claim CTA) and whether it
    // should render at all. Browse items never reroute; personal items hide for
    // spectators. Panel-entry items have no href and are dropped for spectators
    // (their personal RightPanel is empty without a player).
    const resolve = (item: NavItem): ResolvedNavItem | null => {
      const badge = item.href === "/messages" && unreadTotal > 0;
      const locked = item.href ? !!pageLocked[item.href] : false;

      if (item.panel) {
        if (isSpectator) return null;
        return { item, disabled: playerItemDisabled, locked, badge };
      }

      const cls = spectatorClass(item);
      if (isSpectator) {
        if (!visibleForSpectator(item)) return null;
        const href = cls === "player" ? CLAIM_HREF : item.href!;
        return { item, href, disabled: false, locked, badge };
      }
      return {
        item,
        href: item.href!,
        disabled: cls === "player" && playerItemDisabled,
        locked,
        badge,
      };
    };

    return {
      primary: PRIMARY.map(resolve),
      secondary: SECONDARY.map(resolve),
    };
  }, [unreadTotal, player, estate, isSuccess, isSpectator]);
}
