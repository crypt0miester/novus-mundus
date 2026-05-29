"use client";

import { useEffect, useState } from "react";

// Reactive CSS media-query match. SSR-safe: returns false until mounted, then
// syncs to the live matchMedia result and updates on change. Generalizes the
// local matchMedia hooks already inlined in BottomSheet / MobileTeamDock.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(query);
    const sync = () => setMatches(mql.matches);
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, [query]);
  return matches;
}

// Phone gate for compose-in-bar: the MorphTabBar exists only below md (768px),
// so this is the exact breakpoint where the bar can host a composer.
export function useIsPhone(): boolean {
  return useMediaQuery("(max-width: 767px)");
}

// Below the lg (1024px) breakpoint. Used to keep breakpoint-specific subtrees
// from MOUNTING on the wrong side rather than merely hiding them with CSS (a
// `hidden lg:*` subtree still mounts and runs its effects). Starts false
// (desktop-assumed) so SSR and the first client render agree.
export function useIsMobile(): boolean {
  return !useMediaQuery("(min-width: 1024px)");
}
