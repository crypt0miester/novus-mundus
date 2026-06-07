import { create } from "zustand";
import { persist } from "zustand/middleware";

// The left contextual drawer's collapse preference. Collapsed hands the drawer's
// width to the page (the icon rail stays). Persisted to localStorage so the
// choice survives navigation and reload.
//
// `drawerPref` is a deliberate tri-state, not a shimmed boolean:
//   - "open" / "collapsed": the user made an explicit choice; it wins at every
//     breakpoint.
//   - null: no explicit choice yet, so the drawer follows the responsive default
//     (collapsed in the md..lg band to protect content width, open at lg+). The
//     consumers express that default in CSS (flash-free on SSR) and in
//     `useDrawerOpen` (for chips / Cairn that need the effective boolean).
export type DrawerPref = "open" | "collapsed" | null;

// Resizable column widths (px). The drawer (left) and RightPanel (right) each get
// a drag handle on their inner edge that writes the live width to a CSS var, then
// commits the final value here on pointer-up (so the drag itself never re-renders
// React, see useResizable). Collapse is orthogonal to width: a collapsed drawer
// renders at width 0 regardless of `drawerWidth`; expanding restores it.
export const DRAWER_WIDTH_DEFAULT = 240; // the old `w-60`
export const RIGHT_PANEL_WIDTH_DEFAULT = 288; // the old `w-72`

// Absolute pixel clamp shared by both columns. The viewport fraction below
// (CLAMP_VW_FRACTION) clamps further so two wide panels can never starve the
// content; that one is applied at mount/resize where the viewport is known.
export const WIDTH_MIN = 232;
export const WIDTH_MAX = 300;

// Each column may take at most this fraction of the viewport width, so two
// panels at max plus the icon rail still leave a usable content column.
export const CLAMP_VW_FRACTION = 0.4;

// Clamp a candidate width to the absolute [MIN, MAX] range, and (when a viewport
// width is supplied) additionally to CLAMP_VW_FRACTION of it. `viewportWidth`
// is omitted during SSR / before mount, where the absolute clamp is enough.
export function clampWidth(px: number, viewportWidth?: number): number {
  let max = WIDTH_MAX;
  if (typeof viewportWidth === "number" && viewportWidth > 0) {
    max = Math.min(max, Math.floor(viewportWidth * CLAMP_VW_FRACTION));
  }
  // Guard the degenerate case where the vw fraction undercuts the floor (a very
  // narrow viewport): the absolute floor wins so the column never inverts.
  const lo = Math.min(WIDTH_MIN, max);
  return Math.max(lo, Math.min(max, Math.round(px)));
}

interface SidebarStore {
  drawerPref: DrawerPref;
  drawerWidth: number;
  rightPanelWidth: number;
  // Whether the drawer is showing the account panel (wallet + clock + actions)
  // instead of the active route's section nav. Ephemeral (not persisted): opened
  // by the rail's wallet icon, dropped on navigation. The wallet dropdown and
  // the day/night clock live here so they have room (they were clipped at the
  // rail foot).
  accountOpen: boolean;
  openAccount: () => void;
  closeAccount: () => void;
  toggleDrawer: () => void;
  setDrawerOpen: (open: boolean) => void;
  setDrawerWidth: (px: number, viewportWidth?: number) => void;
  setRightPanelWidth: (px: number, viewportWidth?: number) => void;
  resetDrawerWidth: () => void;
  resetRightPanelWidth: () => void;
  // Re-clamp both stored widths against the current viewport. A width saved on a
  // wide monitor must shrink when the app opens narrower (and on window resize),
  // or a panel could exceed the viewport; consumers call this on mount and on
  // resize.
  reclampWidths: (viewportWidth: number) => void;
}

export const useSidebar = create<SidebarStore>()(
  persist(
    (set, get) => ({
      drawerPref: null,
      drawerWidth: DRAWER_WIDTH_DEFAULT,
      rightPanelWidth: RIGHT_PANEL_WIDTH_DEFAULT,
      accountOpen: false,
      // Open the drawer onto the account panel (forces the drawer open so a
      // collapsed rail still reveals it).
      openAccount: () => set({ accountOpen: true, drawerPref: "open" }),
      closeAccount: () => set({ accountOpen: false }),
      // Toggle reads the current effective state at lg (the desktop default is
      // open) so the very first toggle flips the visible state, then pins it.
      // Collapsing also drops the account panel so it never lingers off-screen.
      toggleDrawer: () => {
        const pref = get().drawerPref;
        const effective = pref === null ? true : pref === "open";
        set({ drawerPref: effective ? "collapsed" : "open", accountOpen: false });
      },
      setDrawerOpen: (open) => set({ drawerPref: open ? "open" : "collapsed" }),
      setDrawerWidth: (px, viewportWidth) => set({ drawerWidth: clampWidth(px, viewportWidth) }),
      setRightPanelWidth: (px, viewportWidth) =>
        set({ rightPanelWidth: clampWidth(px, viewportWidth) }),
      resetDrawerWidth: () => set({ drawerWidth: DRAWER_WIDTH_DEFAULT }),
      resetRightPanelWidth: () => set({ rightPanelWidth: RIGHT_PANEL_WIDTH_DEFAULT }),
      reclampWidths: (viewportWidth) => {
        const s = get();
        const drawerWidth = clampWidth(s.drawerWidth, viewportWidth);
        const rightPanelWidth = clampWidth(s.rightPanelWidth, viewportWidth);
        if (drawerWidth !== s.drawerWidth || rightPanelWidth !== s.rightPanelWidth) {
          set({ drawerWidth, rightPanelWidth });
        }
      },
    }),
    {
      name: "novus-sidebar",
      version: 3,
      // Hard-validate at rehydrate. A tampered or stale localStorage blob can
      // smuggle a non-pref drawerPref or a junk width through, which would leave
      // the drawer mis-stated or a column off-screen; reject each bad field back
      // to its default rather than shim it with `??`/`||` (the "no fallback"
      // policy for persisted state). Widths re-clamp to the viewport on mount.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SidebarStore>;
        const validPref =
          p.drawerPref === "open" || p.drawerPref === "collapsed" || p.drawerPref === null;
        const validDrawerW =
          typeof p.drawerWidth === "number" && Number.isFinite(p.drawerWidth);
        const validRightW =
          typeof p.rightPanelWidth === "number" && Number.isFinite(p.rightPanelWidth);
        return {
          ...current,
          ...p,
          drawerPref: validPref ? (p.drawerPref as DrawerPref) : current.drawerPref,
          drawerWidth: validDrawerW ? clampWidth(p.drawerWidth as number) : current.drawerWidth,
          rightPanelWidth: validRightW
            ? clampWidth(p.rightPanelWidth as number)
            : current.rightPanelWidth,
        };
      },
      // v1 persisted a `drawerOpen` boolean; v2 mapped it to the tri-state pref;
      // v3 adds the two widths (defaulted here, then `merge` re-validates and
      // `reclampWidths` fits them to the live viewport on mount). Each step keeps
      // the user's pinned pref instead of resetting to the viewport default.
      migrate: (
        persisted,
        version,
      ): { drawerPref: DrawerPref; drawerWidth: number; rightPanelWidth: number } => {
        let drawerWidth = DRAWER_WIDTH_DEFAULT;
        let rightPanelWidth = RIGHT_PANEL_WIDTH_DEFAULT;
        if (version < 2 && persisted && typeof persisted === "object") {
          const legacy = persisted as { drawerOpen?: unknown };
          if (typeof legacy.drawerOpen === "boolean") {
            return {
              drawerPref: legacy.drawerOpen ? "open" : "collapsed",
              drawerWidth,
              rightPanelWidth,
            };
          }
        }
        const p = (persisted ?? {}) as {
          drawerPref?: unknown;
          drawerWidth?: unknown;
          rightPanelWidth?: unknown;
        };
        const validPref =
          p.drawerPref === "open" || p.drawerPref === "collapsed" || p.drawerPref === null;
        if (typeof p.drawerWidth === "number" && Number.isFinite(p.drawerWidth)) {
          drawerWidth = clampWidth(p.drawerWidth);
        }
        if (typeof p.rightPanelWidth === "number" && Number.isFinite(p.rightPanelWidth)) {
          rightPanelWidth = clampWidth(p.rightPanelWidth);
        }
        return {
          drawerPref: validPref ? (p.drawerPref as DrawerPref) : null,
          drawerWidth,
          rightPanelWidth,
        };
      },
      // Only the user choices persist; the actions are recreated each load.
      partialize: (s) => ({
        drawerPref: s.drawerPref,
        drawerWidth: s.drawerWidth,
        rightPanelWidth: s.rightPanelWidth,
      }),
    },
  ),
);
