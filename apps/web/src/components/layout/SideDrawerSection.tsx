"use client";

import { useLayoutEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lock } from "lucide-react";
import { animate } from "animejs";
import { GameIcon } from "@/components/shared/GameIcon";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";
import { cn } from "@/lib/utils";
import { useNavItems, type ResolvedNavItem } from "@/lib/hooks/useNavItems";
import { ICON_BY_LABEL } from "./nav-config";
import { sectionForPath, isActiveRoute } from "@/lib/nav/sections";

// The contextual sub-nav in the drawer: the active section's children, resolved
// from the active route. We read the section owner from `sectionForPath` and
// the children themselves from `useNavItems` (so spectator/lock/disable states
// match the rail and MorphTabBar exactly). A section with no children (Home,
// Map, the browse pages) renders nothing here; the drawer still shows its
// header + resource footer.
export function SideDrawerSection() {
  const pathname = usePathname();
  const { secondary } = useNavItems();
  const reduce = useReducedMotion();
  const section = sectionForPath(pathname);
  const navRef = useRef<HTMLElement | null>(null);

  // Cross-fade the sub-nav when the section changes (doc 9 content swap, ~140ms),
  // so switching sections reads as the panel re-rendering, not a hard cut. Keyed
  // on the section label: a deep-link within the same section (e.g. /estate to
  // /estate?building=...) keeps the same list, so it does not re-fade. Reduced
  // motion snaps. The effect runs only when a list is present (navRef is set).
  const sectionKey = section?.label ?? null;
  useLayoutEffect(() => {
    const el = navRef.current;
    if (!el || sectionKey === null) return;
    if (reduce) {
      el.style.opacity = "1";
      return;
    }
    el.style.opacity = "0";
    animate(el, { opacity: [0, 1], duration: 140, ease: "outQuad" });
  }, [sectionKey, reduce]);

  if (!section) return null;

  // Pick the resolved SECONDARY rows whose source item names this section,
  // preserving nav-config order. Null slots (capability-hidden items) drop out.
  const rows = secondary.filter(
    (r): r is ResolvedNavItem => r !== null && r.item.section === section.label,
  );

  if (rows.length === 0) return null;

  return (
    <nav ref={navRef} aria-label={`${section.label} sections`} className="flex flex-col gap-0.5 px-2 py-1">
      {rows.map((resolved) => {
        const { item } = resolved;
        const iconId = ICON_BY_LABEL[item.label] ?? "nav-settings";
        const active = isActiveRoute(pathname, item.href!);
        const { locked, disabled } = resolved;

        // The row's rest/active/lock styling. Active fills a soft neutral pill
        // with an accent label (no left bar / border-l flourish). Locked dims but
        // stays clickable so the destination renders its own LockedCard.
        const rowClass = cn(
          "flex h-9 items-center gap-2.5 rounded-lg px-3 text-sm transition-colors my-1",
          active
            ? "bg-surface-overlay tier-accent-text font-medium"
            : disabled
              ? "pointer-events-none text-text-muted/40"
              : locked
                ? "text-text-muted hover:bg-surface-raised hover:text-text-secondary"
                : "text-text-secondary hover:bg-surface-raised hover:text-text-primary",
        );

        const body = (
          <>
            <GameIcon id={iconId} title={item.label} size={18} className="shrink-0" />
            <span className="truncate">{item.label}</span>
            {locked && <Lock aria-hidden className="ml-auto h-3.5 w-3.5 shrink-0 text-text-muted" />}
          </>
        );

        // A disabled player-scoped row renders inert; its visible text label
        // (inside `body`) carries the accessible name, so no extra ARIA needed.
        if (disabled) {
          return (
            <span key={item.href} className={rowClass}>
              {body}
            </span>
          );
        }

        return (
          <Link
            key={item.href}
            href={resolved.href!}
            aria-current={active ? "page" : undefined}
            className={rowClass}
          >
            {body}
          </Link>
        );
      })}
    </nav>
  );
}
