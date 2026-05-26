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
}

export const PRIMARY = [
  { href: "/dashboard", label: "Home" },
  { href: "/estate", label: "Estate" },
  { href: "/team", label: "Team" },
  { href: "/shop", label: "Shop" },
  { href: "/map", label: "Map" },
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
  },
  {
    section: "Estate",
    href: "/estate?building=catacombs",
    label: "Dungeon",
    feature: "dungeon_enter",
  },
  { section: "Estate", href: "/estate?building=arena", label: "Arena", feature: "arena_join" },
  { section: "Team", href: "/team?tab=rally", label: "Rally", feature: "rally_join" },
  { section: "Shop", href: "/shop?tab=subscribe", label: "Subscription", feature: "subscription" },

  { href: "/cosmetics", label: "Wardrobe" },
  { href: "/settings", label: "Settings" },
  { href: "/world/leaderboard", label: "Leaderboard" },
  { href: "/events", label: "Events" },
  { panel: "inventory", label: "Inventory" },
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
