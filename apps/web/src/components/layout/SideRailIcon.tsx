"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import { animate } from "animejs";
import { GameIcon, type GameIconId } from "@/components/shared/GameIcon";
import { useRailFlyout } from "@/lib/hooks/useRailFlyout";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";
import { SETTLE } from "@/lib/motion/tokens";
import { cn } from "@/lib/utils";
import { ICON_BY_LABEL } from "./nav-config";
import type { ResolvedNavItem } from "@/lib/hooks/useNavItems";

// One icon button on the persistent rail. Either a GameIcon glyph (the flat
// `nav-*` masks that tint with currentColor) or a lucide fallback for the four
// labels that lack a glyph yet (Wardrobe/Messages/Players/Cities). Active items
// get a filled rounded-square highlight in the tier accent plus a 2px accent
// left tick; an unread item carries a small accent dot.
//
// Hover or focus reveals a flyout beside the icon: a label tooltip for a plain
// destination, or (when the drawer is collapsed and the icon owns a section) the
// section's children as a small list, so deep links stay reachable without
// re-opening the drawer. The flyout is keyboard-reachable and Escape-dismissable.
interface SideRailIconProps {
  label: string;
  // Exactly one of `iconId` (GameIcon glyph) or `lucide` (fallback) is set.
  iconId?: GameIconId;
  lucide?: LucideIcon;
  href?: string;
  onClick?: () => void;
  active: boolean;
  // Page-level lock (Team/Shop extensions). Stays clickable so the destination
  // renders its own LockedCard; we only ring it to telegraph the gate.
  locked?: boolean;
  // Connected-but-no-player gate for player-scoped items: dimmed + inert.
  disabled?: boolean;
  // Source-backed unread indicator (Messages today).
  unread?: boolean;
  // The resolved children of this icon's section (Estate/Team/Shop). Surfaced as
  // a flyout list only when the drawer is collapsed; empty otherwise.
  sectionChildren?: ResolvedNavItem[];
  // Whether the drawer is collapsed: gates the children flyout (open drawer
  // already shows the section list, so the rail only needs a label tooltip).
  collapsed?: boolean;
  // Active test for a child row, supplied by the rail so the flyout highlights
  // the current deep-link consistently with the drawer.
  isActiveHref?: (href: string) => boolean;
}

function IconGlyph({
  iconId,
  lucide: Lucide,
  label,
}: {
  iconId?: GameIconId;
  lucide?: LucideIcon;
  label: string;
}) {
  if (iconId) return <GameIcon id={iconId} title={label} size={20} />;
  if (Lucide) return <Lucide className="h-5 w-5" aria-hidden />;
  return null;
}

export function SideRailIcon({
  label,
  iconId,
  lucide,
  href,
  onClick,
  active,
  locked = false,
  disabled = false,
  unread = false,
  sectionChildren = [],
  collapsed = false,
  isActiveHref,
}: SideRailIconProps) {
  const [hovered, setHovered] = useState(false);
  const reduce = useReducedMotion();
  const flyoutId = useId();
  // A flyout (children list) shows only for a collapsed section icon with rows;
  // otherwise the same hover/focus shows a plain label tooltip. A disabled icon
  // still gets its label tooltip (its accessible name) but no children flyout.
  const showChildren = collapsed && sectionChildren.length > 0 && !disabled;

  // The anchor and the flyout sit a small gap apart, so moving the cursor from
  // the icon to a children flyout briefly leaves both. Defer the close by a tick
  // so that transit does not drop the flyout; entering either end cancels it.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);
  const open = useCallback(() => {
    cancelClose();
    setHovered(true);
  }, [cancelClose]);
  const close = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setHovered(false), 80);
  }, [cancelClose]);
  // Escape (and an outside-focus blur) close immediately (no gap to bridge).
  const closeNow = useCallback(() => {
    cancelClose();
    setHovered(false);
  }, [cancelClose]);
  useEffect(() => () => cancelClose(), [cancelClose]);

  const { anchorRef, panelRef, pos } = useRailFlyout(hovered, closeNow);

  // Keyboard reachability: Tabbing from the section icon into the children
  // flyout must keep it open. Close only when focus lands outside BOTH the
  // trigger and the panel; focus moving from the icon into the panel (or within
  // the panel) keeps it alive.
  const handleBlur = useCallback(
    (e: React.FocusEvent) => {
      const next = e.relatedTarget as Node | null;
      if (next && (anchorRef.current?.contains(next) || panelRef.current?.contains(next))) return;
      closeNow();
    },
    [anchorRef, panelRef, closeNow],
  );

  // Hover-bridge + focus-out on the (portaled, static) flyout panel, wired
  // imperatively rather than as JSX handlers: a presentational container should
  // not carry interactive props, so listeners attach to the DOM node instead.
  // Entering the panel cancels the pending close (so a transit across the gap
  // keeps it open); leaving the panel re-arms the close; focus leaving both ends
  // closes it.
  useEffect(() => {
    if (!hovered) return;
    const el = panelRef.current;
    if (!el) return;
    const onFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null;
      if (next && (anchorRef.current?.contains(next) || el.contains(next))) return;
      closeNow();
    };
    el.addEventListener("mouseenter", open);
    el.addEventListener("mouseleave", close);
    el.addEventListener("focusout", onFocusOut);
    return () => {
      el.removeEventListener("mouseenter", open);
      el.removeEventListener("mouseleave", close);
      el.removeEventListener("focusout", onFocusOut);
    };
  }, [hovered, open, close, closeNow, anchorRef, panelRef]);

  // Pop the flyout in on first measured position (mirrors InfoButton's SETTLE
  // fade + rise + scale, reduced-motion aware), so the tooltip/list does not
  // hard-cut into place.
  const animated = useRef(false);
  useLayoutEffect(() => {
    if (!hovered) {
      animated.current = false;
      return;
    }
    const el = panelRef.current;
    if (!el || !pos || animated.current) return;
    animated.current = true;
    if (reduce) {
      el.style.opacity = "1";
      el.style.transform = "none";
      return;
    }
    el.style.opacity = "0";
    animate(el, {
      opacity: [0, 1],
      translateX: [-6, 0],
      scale: [0.96, 1],
      duration: 200,
      ease: SETTLE,
    });
  }, [hovered, pos, reduce, panelRef]);

  // Resting icons sit muted on the dark rail (the light --nm-rail-fg at 70%);
  // hover bumps to full foreground. Active flips to the tier accent. Locked dims
  // a notch but stays reachable. The button is square (h-10 w-10); the
  // transition-colors carries the hover/active contrast step (doc 9: hover is a
  // quiet contrast change, no transform).
  //
  // The active translucent accent SQUARE is no longer drawn per-icon: a single
  // glider in SideRail slides it between icons (doc 9 active-square glide), so
  // the active icon here only owns the accent glyph + the left tick. The button
  // sits above the glider (z-10) so its glyph reads over the moving square.
  //
  // The active glyph uses the raw brand accent (text-accent / --tier-accent),
  // NOT tier-accent-text: --color-text-gold carries WCAG overrides tuned for the
  // CREAM surfaces (e.g. darkened bronze on paper), which would dim on the dark
  // ink rail. The brand accent reads on the dark rail across all four tiers,
  // matching the rail's two-tone spec (doc 5: active icon = the tier accent).
  const inner = cn(
    "relative z-10 flex h-10 w-10 items-center justify-center rounded-xl transition-colors",
    active
      ? "text-accent"
      : disabled
        ? "text-[var(--nm-rail-fg)]/30"
        : locked
          ? "text-[var(--nm-rail-fg)]/55 hover:text-[var(--nm-rail-fg)]/80"
          : "text-[var(--nm-rail-fg)]/70 hover:text-[var(--nm-rail-fg)]",
  );

  const body = (
    <>
      {/* Active left tick: a 2px accent bar pinned to the rail edge. */}
      {/* {active && (
        <span
          aria-hidden
          className="absolute -left-2 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent"
        />
      )} */}
      <IconGlyph iconId={iconId} lucide={lucide} label={label} />
      {/* Unread dot: a 6px accent dot riding the icon's upper-right. */}
      {unread && (
        <span
          aria-hidden
          className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent"
        />
      )}
      {/* Lock ring tell: a small open-circle marker so a gated section reads as
          reachable-but-locked rather than missing. */}
      {locked && (
        <span aria-hidden className="absolute bottom-0.5 right-0.5 text-[8px] leading-none">
          &#9676;
        </span>
      )}
    </>
  );

  // Hover/focus open the flyout; leave/blur close it. For the label-only case the
  // trigger already carries the label as its accessible name, so describedby
  // points at the tooltip purely to surface the same text; for the children case
  // the popover is its own navigation and is reached by Tab, not described here.
  const triggerHandlers = {
    onMouseEnter: open,
    onMouseLeave: close,
    onFocus: open,
    onBlur: handleBlur,
    "aria-describedby": hovered && !showChildren ? flyoutId : undefined,
  };

  // Set the shared anchor ref via a callback so it works on Link, button, and
  // span alike (all forward to a DOM element).
  const setAnchor = (el: HTMLElement | null) => {
    anchorRef.current = el;
  };

  let trigger: React.ReactNode;
  if (disabled) {
    // A disabled player-scoped item renders inert (no link/handler) but keeps
    // its accessible name and still tooltips on hover, mirroring the on-chain
    // gate. It is not focusable (a disabled control is skipped by the keyboard),
    // so only the mouse handlers carry; the label is its accessible name.
    trigger = (
      <span
        ref={setAnchor}
        role="img"
        className={inner}
        aria-label={label}
        aria-disabled
        data-rail-active={active ? "true" : undefined}
        {...triggerHandlers}
      >
        {body}
      </span>
    );
  } else if (href) {
    trigger = (
      <Link
        ref={setAnchor}
        href={href}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        className={inner}
        data-rail-active={active ? "true" : undefined}
        {...triggerHandlers}
      >
        {body}
      </Link>
    );
  } else {
    trigger = (
      <button
        ref={setAnchor}
        type="button"
        onClick={onClick}
        aria-label={label}
        className={inner}
        data-rail-active={active ? "true" : undefined}
        {...triggerHandlers}
      >
        {body}
      </button>
    );
  }

  return (
    <>
      {trigger}
      {hovered &&
        createPortal(
          <div
            ref={panelRef}
            id={flyoutId}
            // The children flyout holds its own labelled <nav> of links; the
            // label-only flyout is a plain tooltip. The hover-bridge + focus-out
            // listeners are attached imperatively (see the effect above), so this
            // container stays a presentational static element.
            role={showChildren ? undefined : "tooltip"}
            style={{
              position: "fixed",
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              zIndex: 80,
              transformOrigin: "left center",
            }}
            className={cn(
              "rounded-lg border border-border-default bg-[var(--nm-bg-bar)]/97 shadow-xl shadow-black/40 backdrop-blur",
              showChildren ? "min-w-44 py-1.5" : "px-2.5 py-1",
            )}
          >
            {showChildren ? (
              <RailFlyoutChildren label={label} rows={sectionChildren} isActiveHref={isActiveHref} />
            ) : (
              <span className="whitespace-nowrap text-xs font-medium text-text-secondary">
                {label}
              </span>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

// The collapsed-mode section flyout: a header naming the section + its child
// rows, rendered with the same active/lock/disable treatment as the drawer list
// so the two never diverge.
function RailFlyoutChildren({
  label,
  rows,
  isActiveHref,
}: {
  label: string;
  rows: ResolvedNavItem[];
  isActiveHref?: (href: string) => boolean;
}) {
  return (
    <nav aria-label={`${label} sections`} className="flex flex-col">
      <span className="px-3 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
        {label}
      </span>
      {rows.map((resolved) => {
        const { item } = resolved;
        const iconId = ICON_BY_LABEL[item.label] ?? "nav-settings";
        const active = isActiveHref ? isActiveHref(item.href!) : false;
        const { locked, disabled } = resolved;

        const rowClass = cn(
          "relative mx-1 flex h-9 items-center gap-2.5 rounded-lg px-2 text-sm transition-colors my-1",
          active
            ? "tier-accent-text bg-surface-overlay"
            : disabled
              ? "pointer-events-none text-text-muted/40"
              : locked
                ? "text-text-muted hover:bg-surface-raised hover:text-text-secondary"
                : "text-text-secondary hover:bg-surface-raised hover:text-text-primary",
        );

        const rowBody = (
          <>
            <GameIcon id={iconId} title={item.label} size={18} className="shrink-0" />
            <span className="truncate">{item.label}</span>
            {locked && (
              <span aria-hidden className="ml-auto text-[10px] text-text-muted">
                &#9676;
              </span>
            )}
          </>
        );

        if (disabled) {
          return (
            <span key={item.href} className={rowClass}>
              {rowBody}
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
            {rowBody}
          </Link>
        );
      })}
    </nav>
  );
}
