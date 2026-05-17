export interface NavItem {
  label: string;
  /** Route to navigate to. */
  href?: string;
  /** When set, the entry opens this RightPanel content key instead of navigating. */
  panel?: string;
}

export const PRIMARY = [
  { href: "/dashboard", label: "Home" },
  { href: "/estate", label: "Estate" },
  { href: "/combat", label: "Combat" },
  { href: "/team", label: "Team" },
  { href: "/shop", label: "Shop" },
];

export const SECONDARY: NavItem[] = [
  { panel: "inventory", label: "Inventory" },
  { href: "/map", label: "Map" },
  { href: "/events", label: "Events" },
  { href: "/world/leaderboard", label: "Leaderboard" },
  { href: "/settings", label: "Settings" },
];
