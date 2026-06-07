"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { SideDrawerSection } from "./SideDrawerSection";
import { ResourceFooter } from "./ResourceFooter";
import { AccountPanel } from "./AccountPanel";
import { sectionForPath } from "@/lib/nav/sections";
import { useSidebar } from "@/lib/store/sidebar";
import { useDrawerOpen, useDrawerClassMode } from "@/lib/hooks/useDrawerOpen";
import { cn } from "@/lib/utils";

// The contextual drawer beside the icon rail. Its content stacks from the top in
// one scroll column: a header naming the active view, the contextual sub-nav (or
// the account panel), then the player resource HUD. Because the column is
// top-aligned (not a header/body/footer split), the resources rise to sit just
// under the shortcuts, and right under the header when a section has none (doc
// follow-up: top part is auto-height). The single collapse control is the rail's
// toggle (the drawer no longer carries its own chevron). The OPEN width is the
// resizable --drawer-w; collapsed is always 0. The Cairn (CairnPresence)
// re-anchors to the drawer foot when open and the rail foot when collapsed, so
// the column keeps bottom padding (pb-44) to stay clear of it.
export function SideDrawer() {
  const pathname = usePathname();
  const drawerOpen = useDrawerOpen();
  const classMode = useDrawerClassMode();
  const accountOpen = useSidebar((s) => s.accountOpen);
  const closeAccount = useSidebar((s) => s.closeAccount);
  const section = sectionForPath(pathname);

  // Drop the account panel on navigation so it never lingers over a new route.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the route-change trigger, intentionally not read in the body.
  useEffect(() => {
    closeAccount();
  }, [pathname, closeAccount]);

  // Childless sections (Home, Map) and unowned routes (browse/personal screens)
  // fall back to the page title from the route's leading segment so the header
  // never reads blank. Section-owned routes show the section label.
  const heading = accountOpen ? "Account" : (section?.label ?? titleForPath(pathname));

  return (
    <aside
      id="side-drawer"
      aria-label="Section navigation"
      aria-hidden={!drawerOpen}
      // Width tweens to 0 on collapse (the rail beside it stays put); the inner
      // content fades so its text never squishes mid-collapse. overflow-hidden
      // clips the content while the width animates closed. `relative` anchors the
      // right-edge resize handle. See useDrawerClassMode for the three width
      // modes (pinned open/collapsed at every breakpoint; "responsive" follows
      // the lg breakpoint in CSS, flash-free on SSR).
      className={cn(
        "relative hidden flex-shrink-0 flex-col overflow-hidden border-r bg-[var(--nm-bg-bar)] transition-[width,opacity] duration-[220ms] ease-out md:flex",
        classMode === "open" && "w-[var(--drawer-w)] border-border-default opacity-100",
        classMode === "collapsed" && "w-0 border-transparent opacity-0",
        classMode === "responsive" &&
          "w-0 border-transparent opacity-0 lg:w-[var(--drawer-w)] lg:border-border-default lg:opacity-100",
      )}
    >
      {/* One top-aligned scroll column: header, then the section nav (or account
          panel), then the resources. Top-aligned so resources rise under the
          shortcuts (and under the header when a section has none). pb-44 keeps
          the foot content clear of the Cairn anchored there. */}
      <div id="drawer-content" className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-44">
        <div className="flex-shrink-0 px-3 pb-1 pt-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            {heading}
          </span>
        </div>

        {accountOpen ? <AccountPanel /> : <SideDrawerSection />}

        <div className="mt-2 border-t border-border-default">
          <ResourceFooter />
        </div>
      </div>
    </aside>
  );
}

// Title-case the route's leading path segment for childless/unowned sections,
// so the drawer header reads (e.g.) "Leaderboard" on /leaderboard. The home
// route maps to "Home" to match its primary label.
function titleForPath(pathname: string | null | undefined): string {
  if (!pathname || pathname === "/dashboard") return "Home";
  const seg = pathname.split("/").filter(Boolean)[0];
  if (!seg) return "Home";
  return seg.charAt(0).toUpperCase() + seg.slice(1);
}
