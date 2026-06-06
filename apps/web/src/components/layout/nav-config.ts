export interface NavItem {
  label: string;
  /** Route to navigate to. */
  href?: string;
  /** When set, the entry opens this RightPanel content key instead of navigating. */
  panel?: string;
  /** Section group label. Items with the same section render together under a header. */
  section?: string;
  /** FEATURES.* key. When set, locked state is reflected visually (dimmed). */
  feature?: string;
  /**
   * Spectator visibility. `browse` items are real-time read-only surfaces that
   * work without a player and stay enabled for spectators. `player` items need a
   * claimed seat: they stay visible but route a spectator to the claim CTA.
   * `personal` items are meaningless without a player and are hidden from a
   * spectator's nav entirely (Messages, Settings, Wardrobe). Defaults to
   * `player` when omitted.
   */
  spectator?: "browse" | "player" | "personal";
}

export const PRIMARY: NavItem[] = [
  { href: "/dashboard", label: "Home", spectator: "player" },
  { href: "/estate", label: "Estate", spectator: "player" },
  { href: "/team", label: "Team", spectator: "browse" },
  { href: "/shop", label: "Shop", spectator: "browse" },
  { href: "/map", label: "Map", spectator: "browse" },
];

// Order is left-to-right in the nav; the rightmost entries sit nearest the
// `+` toggle, so the most-reached items come last. Section sub-tabs — also
// reachable from each page's own tab bar — lead; standalone screens follow,
// climbing to Inventory. Heroes/Dungeon/Arena now live inside the estate
// (Sanctuary's Heroes sub-tab, Catacombs feature view, Arena feature view).
export const SECONDARY: NavItem[] = [
  {
    section: "Estate",
    href: "/estate?building=sanctuary&subtab=heroes",
    label: "Heroes",
    feature: "hero_mint",
    spectator: "player",
  },
  {
    section: "Estate",
    href: "/estate?building=catacombs",
    label: "Dungeon",
    feature: "dungeon_enter",
    spectator: "player",
  },
  {
    section: "Estate",
    href: "/estate?building=arena",
    label: "Arena",
    feature: "arena_join",
    spectator: "player",
  },
  {
    section: "Team",
    href: "/team?tab=rally",
    label: "Rally",
    feature: "rally_join",
    spectator: "player",
  },
  {
    section: "Shop",
    href: "/shop?tab=subscribe",
    label: "Subscription",
    feature: "subscription",
    spectator: "player",
  },

  { href: "/cosmetics", label: "Wardrobe", spectator: "personal" },
  { href: "/messages", label: "Messages", spectator: "personal" },
  { href: "/settings", label: "Settings", spectator: "personal" },
  { href: "/leaderboard", label: "Leaderboard", spectator: "browse" },
  { href: "/players", label: "Players", spectator: "browse" },
  { href: "/cities", label: "Cities", spectator: "browse" },
  { href: "/events", label: "Events", spectator: "browse" },
  { panel: "inventory", label: "Inventory", spectator: "player" },
];

/**
 * Primary-nav routes a player can't enter yet, keyed by `href`. `/map` is
 * intentionally absent — it opens for everyone and self-gates its travel CTAs.
 */
export function computePageLocks(
  hasPlayer: boolean,
  hasEstate: boolean,
  extensions: number,
): Record<string, boolean> {
  if (!hasPlayer) return {};
  return {
    "/team": !(extensions & (1 << 2)),
    "/shop": !(extensions & (1 << 0)),
  };
}

/** Spectator class of a nav item; `player` is the default for unmarked items. */
export function spectatorClass(item: NavItem): "browse" | "player" | "personal" {
  return item.spectator ?? "player";
}

/**
 * Whether a spectator should see this item in the nav at all. Browse and
 * player-scoped items stay visible (player-scoped ones route to the claim CTA);
 * personal items are hidden for spectators.
 */
export function visibleForSpectator(item: NavItem): boolean {
  return spectatorClass(item) !== "personal";
}
