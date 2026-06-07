"use client";

import { useResizable, WIDTH_MIN, WIDTH_MAX } from "@/lib/hooks/useResizable";
import {
  useSidebar,
  DRAWER_WIDTH_DEFAULT,
  RIGHT_PANEL_WIDTH_DEFAULT,
} from "@/lib/store/sidebar";
import { useDrawerOpen, useDrawerClassMode } from "@/lib/hooks/useDrawerOpen";
import { useRightPanelStore } from "@/lib/store/right-panel";
import { cn } from "@/lib/utils";

// The single resize grabber for both side columns, rendered OUTSIDE the column
// (in the layout body row) so it is never clipped and, for the drawer, stays
// present when collapsed to double as a reopen affordance. It straddles the seam
// between the column and the content; its position tracks the live width var.
// Dragging resizes; dragging past the min width reduces the column's opacity and
// collapses on release. The drawer variant also reopens from collapsed (a tap or
// drag). One component, two variants:
//   - "drawer": left column, edge "right", reopens when collapsed (md+).
//   - "right-panel": right column, edge "left", collapse = close the panel; it
//     only renders while the panel is open (lg+).
export function DrawerResizeHandle({
  variant = "drawer",
}: {
  variant?: "drawer" | "right-panel";
}) {
  const drawerOpen = useDrawerOpen();
  const mode = useDrawerClassMode();
  const drawerWidth = useSidebar((s) => s.drawerWidth);
  const setDrawerWidth = useSidebar((s) => s.setDrawerWidth);
  const resetDrawerWidth = useSidebar((s) => s.resetDrawerWidth);
  const setDrawerOpen = useSidebar((s) => s.setDrawerOpen);
  const rightPanelWidth = useSidebar((s) => s.rightPanelWidth);
  const setRightPanelWidth = useSidebar((s) => s.setRightPanelWidth);
  const resetRightPanelWidth = useSidebar((s) => s.resetRightPanelWidth);
  const rightOpen = useRightPanelStore((s) => s.open);
  const closeRight = useRightPanelStore((s) => s.close);

  const isDrawer = variant === "drawer";

  const { dragging, bind } = useResizable(
    isDrawer
      ? {
          edge: "right",
          cssVar: "--drawer-w",
          width: drawerWidth,
          defaultWidth: DRAWER_WIDTH_DEFAULT,
          commit: setDrawerWidth,
          reset: resetDrawerWidth,
          open: drawerOpen,
          onExpand: () => setDrawerOpen(true),
          onCollapse: () => setDrawerOpen(false),
          closeDimId: "drawer-content",
        }
      : {
          edge: "left",
          cssVar: "--right-panel-w",
          width: rightPanelWidth,
          defaultWidth: RIGHT_PANEL_WIDTH_DEFAULT,
          commit: setRightPanelWidth,
          reset: resetRightPanelWidth,
          onCollapse: closeRight,
          closeDimId: "right-panel-content",
        },
  );

  // The right-panel handle exists only while the panel is open (the panel is
  // content-driven; there is nothing to reopen to, so collapse closes it).
  if (!isDrawer && !rightOpen) return null;

  const width = isDrawer ? drawerWidth : rightPanelWidth;
  const label = isDrawer
    ? drawerOpen
      ? "Resize section navigation"
      : "Open section navigation"
    : "Resize detail panel";

  // Position straddling the seam, tracking the live width var. The drawer's left
  // slides with the collapse animation (suppressed mid-drag via
  // html[data-resizing], globals.css); the right panel just mounts at its edge.
  const position = isDrawer
    ? cn(
        "hidden md:flex -translate-x-1/2 transition-[left] duration-200 ease-out",
        mode === "open" && "left-[calc(4.5rem+var(--drawer-w))]",
        mode === "collapsed" && "left-18",
        mode === "responsive" && "left-18 lg:left-[calc(4.5rem+var(--drawer-w))]",
      )
    : "hidden lg:flex right-[var(--right-panel-w)] translate-x-1/2";

  return (
    // biome-ignore lint/a11y/useSemanticElements: a WAI-ARIA window splitter must be focusable and arrow-key resizable with aria-valuenow/min/max; an <hr> cannot carry that, so role="separator" on a button is the correct widget.
    <button
      type="button"
      id={isDrawer ? "drawer-resize-handle" : "right-panel-resize-handle"}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={WIDTH_MIN}
      aria-valuemax={WIDTH_MAX}
      tabIndex={0}
      onPointerDown={bind.onPointerDown}
      onKeyDown={bind.onKeyDown}
      onDoubleClick={bind.onDoubleClick}
      className={cn(
        "group absolute top-1/2 z-30 h-16 w-4 -translate-y-1/2 touch-none select-none focus:outline-none items-center justify-center",
        position,
      )}
    >
      {/* The grabber pill: short, vertical, on the seam (the bottom-sheet handle
          rotated). Quiet by default; brightens to the tier accent on hover,
          keyboard focus, and drag. */}
      <span
        aria-hidden="true"
        className={cn(
          "h-10 w-1 rounded-full transition-colors",
          dragging
            ? "bg-[var(--tier-accent)]"
            : "bg-[var(--nm-border)] group-hover:bg-[var(--tier-accent)] group-focus-visible:bg-[var(--tier-accent)]",
        )}
      />
    </button>
  );
}
