"use client";

import { useMediaQuery } from "@/lib/hooks/useMediaQuery";
import { useSidebar } from "@/lib/store/sidebar";

// The drawer's open-ness has two drivers: the user's explicit preference (which
// wins at every breakpoint) and, when there is no preference yet, the responsive
// default (collapsed in the md..lg band to protect content width, open at lg+).
//
// Two consumers need slightly different shapes of this:
//   - The drawer aside and the rail chips want flash-free, no-JS CSS, so they
//     read `drawerClassMode` and switch between fixed and responsive Tailwind.
//   - The Cairn and any imperative logic want the effective boolean, so they read
//     `useDrawerOpen`, which resolves the viewport via a media query.

// The effective open boolean. When the user has pinned a choice it wins; with no
// choice we follow the viewport (open at lg+, collapsed below). The media query
// starts false on SSR/first paint, so an unpinned desktop reads collapsed for a
// tick before syncing open; consumers that must avoid that flash use the CSS
// mode below instead.
export function useDrawerOpen(): boolean {
  const pref = useSidebar((s) => s.drawerPref);
  const isLgUp = useMediaQuery("(min-width: 1024px)");
  if (pref === null) return isLgUp;
  return pref === "open";
}

// How a CSS-driven consumer should render the open/collapsed split:
//   - "open" / "collapsed": a pinned choice, fixed at all breakpoints.
//   - "responsive": no choice yet, follow the lg breakpoint in CSS (flash-free).
export type DrawerClassMode = "open" | "collapsed" | "responsive";

export function useDrawerClassMode(): DrawerClassMode {
  const pref = useSidebar((s) => s.drawerPref);
  if (pref === "open") return "open";
  if (pref === "collapsed") return "collapsed";
  return "responsive";
}
