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
  { href: "/combat", label: "Combat" },
  { href: "/team", label: "Team" },
  { href: "/shop", label: "Shop" },
];

export const SECONDARY: NavItem[] = [
  { section: "Combat", href: "/combat?tab=heroes", label: "Heroes", feature: "hero_mint" },
  { section: "Combat", href: "/combat?tab=dungeon", label: "Dungeon", feature: "dungeon_enter" },
  { section: "Combat", href: "/combat?tab=arena", label: "Arena", feature: "arena_join" },

  { section: "Team", href: "/team?tab=rally", label: "Rally", feature: "rally_join" },

  { section: "Shop", href: "/shop?tab=subscribe", label: "Subscription", feature: "subscription" },

  { panel: "inventory", label: "Inventory" },
  { href: "/map", label: "Map" },
  { href: "/events", label: "Events" },
  { href: "/world/leaderboard", label: "Leaderboard" },
  { href: "/settings", label: "Settings" },
];
