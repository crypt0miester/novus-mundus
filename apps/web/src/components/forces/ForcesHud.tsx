"use client";

// ForcesHud: a persistent, collapsible overlay anchored top-left INSIDE the
// realm map's `.shell` (mounted by RealmMap via its `renderHud` slot). It lists
// every in-flight "force" the player owns (rallies, reinforcements, travel,
// garrisons, the active expedition) sourced from `useActivity`, with a live
// header count of the things literally moving through the world right now.
//
// The card sits BELOW the floating detail panel (z-15 vs the panel's z-20) and
// is anchored top-LEFT so it never collides with the right-edge sub-tab nav.
// On phones it becomes a compact strip docked flush to the shell's bottom edge,
// mirroring war-table's MobileTeamDock chrome.
//
// Each row carries its own ETA, status chip, and an optional one-tap action.
// Clicking a row hands the ActivityItem back to the host (map-tab) via
// `onSelectItem`, which focuses the map on the row's city and opens its detail
// in the floating panel (spatial rows) or deep-links to the row's home surface
// (non-spatial rows, e.g. an expedition).

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Flag,
  Shield,
  Footprints,
  Pickaxe,
  Castle,
  Swords,
} from "lucide-react";
import { animate, stagger, createDraggable, type Draggable } from "animejs";
import { useActivity, type ActivityItem, type ActivityKind } from "@/lib/hooks/useActivity";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";
import { useAnimeScope } from "@/lib/hooks/useAnimeScope";
import { DUR, EASE, STAGGER } from "@/lib/motion/tokens";
import { TxButton } from "@/components/shared/TxButton";
import { cn } from "@/lib/utils";

const COLLAPSED_KEY = "nm.forcesHud.collapsed";
// Persisted dragged offset for the desktop card (see the Draggable effect).
const POS_KEY = "nm.forcesHud.pos";

// One lucide glyph per activity kind. Defensive units ride rallies /
// reinforcements / garrisons (Shield); the expedition workforce mines (Pickaxe).
const KIND_ICON: Record<ActivityKind, typeof Flag> = {
  rally: Flag,
  reinforcement: Shield,
  travel: Footprints,
  expedition: Pickaxe,
  garrison: Castle,
};

// Compact remaining-time formatter, matching useActivity's own fmtRemaining so
// the live countdown reads identically to the static statusText the hook bakes.
function fmtRemaining(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

export interface ForcesHudProps {
  // Hands the clicked row back to the host. Spatial rows focus the map +
  // open the floating detail panel; non-spatial rows deep-link their surface.
  onSelectItem: (item: ActivityItem) => void;
}

export function ForcesHud({ onSelectItem }: ForcesHudProps) {
  const { items, inMotionCount } = useActivity();
  const reduce = useReducedMotion();

  // Restore the persisted collapse state once on mount. SSR-safe: starts
  // expanded, then syncs to localStorage so the first paint matches the server.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {
      // localStorage unavailable (private mode); keep the default.
    }
  }, []);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // nothing to persist.
      }
      return next;
    });
  };

  // In-motion rows first (the things genuinely moving), then the rest in the
  // hook's existing order. Stable sort keeps same-bucket order intact.
  const ordered = [...items].sort((a, b) => {
    const am = a.etaSeconds != null && a.etaSeconds > 0 ? 0 : 1;
    const bm = b.etaSeconds != null && b.etaSeconds > 0 ? 0 : 1;
    return am - bm;
  });

  const listRef = useRef<HTMLDivElement>(null);
  const hasItems = ordered.length > 0;

  // Draggable card (desktop only). The header is the grab handle; the offset is
  // bounded to the parent `.shell` (the map area) and persists to localStorage,
  // mirroring RealmMap's floating-panel drag. The mobile bottom-dock layout is
  // never made draggable. React never sees a drag frame; anime.js owns it.
  const rootRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<Draggable | null>(null);
  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(min-width: 768px)");
    const sync = () => setIsDesktop(mql.matches);
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    const handle = handleRef.current;
    if (!isDesktop || !hasItems || !root || !handle) return;
    const container = root.parentElement ?? undefined;
    const d = createDraggable(root, {
      trigger: handle,
      container,
      x: true,
      y: true,
      dragThreshold: 3, // a small wobble on the header stays a click (collapse toggle)
      onSettle: (self) => {
        try {
          localStorage.setItem(POS_KEY, JSON.stringify({ x: self.x, y: self.y }));
        } catch {
          // position just won't persist
        }
      },
    });
    dragRef.current = d;
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (raw) {
        const p = JSON.parse(raw) as { x: number; y: number };
        if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
          d.setX(p.x);
          d.setY(p.y);
        }
      }
    } catch {
      // fall back to the CSS anchor (top-left)
    }
    const onResize = () => dragRef.current?.refresh();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      d.revert();
      dragRef.current = null;
    };
  }, [isDesktop, hasItems]);

  // Expand + row entrance: when the list opens (or its membership changes) the
  // container fades in and the rows rise in a tight stagger. Gated on `reduce`
  // (live OS toggle) AND the scope's own reduced-motion match, so reduced-motion
  // users land at the resting state. Keyed on the row ids so adding/removing a
  // force replays only when the set actually changes.
  useAnimeScope(
    {
      root: listRef,
      deps: [collapsed, reduce, ordered.map((i) => i.id).join("|")],
    },
    ({ reduce: scopeReduce }) => {
      if (reduce || scopeReduce || collapsed || !listRef.current) return;
      animate(listRef.current, {
        opacity: [0, 1],
        duration: DUR.fast,
        ease: EASE.out,
      });
      const rows = listRef.current.querySelectorAll("[data-force-row]");
      if (rows.length === 0) return;
      animate(rows, {
        opacity: [0, 1],
        translateY: [6, 0],
        duration: DUR.fast,
        delay: stagger(STAGGER.tight),
        ease: EASE.out,
      });
    },
  );

  // Nothing in flight: render nothing at all (no empty card).
  if (ordered.length === 0) return null;

  return (
    <div
      ref={rootRef}
      className={cn(
        // Desktop: top-left corner card, below the floating panel (z-20) and
        // mobile pill (z-25), above the sheet.
        "absolute z-[15] flex flex-col overflow-hidden rounded-lg border border-border-default bg-surface-raised/95 shadow-lg backdrop-blur",
        "left-4 top-4 w-[min(280px,calc(100vw-2rem))] max-h-[calc(100%-2rem)]",
        // Mobile: a compact strip docked flush to the shell's bottom edge,
        // full-width, square bottom corners (mirrors MobileTeamDock chrome).
        "max-md:inset-x-0 max-md:left-0 max-md:top-auto max-md:bottom-0 max-md:w-full max-md:max-h-[45%] max-md:rounded-none max-md:border-x-0 max-md:border-b-0",
      )}
    >
      <button
        ref={handleRef}
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Expand forces" : "Collapse forces"}
        className="flex shrink-0 items-center gap-2 px-3 py-2 text-left md:cursor-move"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent">
          <Swords className="h-3.5 w-3.5" aria-hidden />
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            Forces
          </span>
          <span className="font-mono text-sm font-semibold tabular-nums text-text-primary">
            {inMotionCount}
          </span>
        </span>
        {collapsed ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
        )}
      </button>

      {!collapsed && (
        <div
          ref={listRef}
          className="flex min-h-0 flex-col gap-1 overflow-y-auto px-1.5 pb-1.5"
        >
          {ordered.map((item) => (
            <ForceRow key={item.id} item={item} onSelect={() => onSelectItem(item)} />
          ))}
        </div>
      )}
    </div>
  );
}

interface ForceRowProps {
  item: ActivityItem;
  onSelect: () => void;
}

function ForceRow({ item, onSelect }: ForceRowProps) {
  const Icon = KIND_ICON[item.kind];
  // `useActivity` already recomputes etaSeconds against useChainNow(1000) inside
  // its own memo, so this value ticks down once per second without a second
  // clock here. Floor it defensively in case the hook hands a negative drift.
  const remaining = item.etaSeconds == null ? null : Math.max(0, item.etaSeconds);
  const moving = remaining != null && remaining > 0;

  return (
    <div
      data-force-row
      className="flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 transition-colors hover:border-border-default hover:bg-surface-overlay/60"
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
            moving ? "bg-accent/20 text-accent" : "bg-surface-overlay text-text-muted",
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-xs font-medium text-text-primary">{item.title}</span>
          <span className="truncate text-[11px] text-text-secondary">
            {remaining != null && remaining > 0
              ? `${statusVerb(item)} ${fmtRemaining(remaining)}`
              : item.statusText}
          </span>
        </span>
        <StatusChip item={item} moving={moving} />
      </button>
      {item.primaryAction && (
        // `w-auto` overrides TxButton's baked-in `w-full` so the action sizes to
        // its label and the row keeps its title/status, rather than the button
        // swallowing the whole row. Hold-to-max passes through when the action
        // exposes it (e.g. a travel "Rush" speedup).
        <TxButton
          variant="secondary"
          className="w-auto shrink-0 px-2 py-1 text-[11px]"
          onClick={(reportPhase) => item.primaryAction!.run(reportPhase).then((sig) => sig ?? "")}
          {...(item.primaryAction.onHold && item.primaryAction.maxCount && item.primaryAction.maxCount > 1
            ? {
                onHold: (reportPhase, count) =>
                  item.primaryAction!.onHold!(reportPhase, count).then((sig) => sig ?? ""),
                holdMax: item.primaryAction.maxCount,
              }
            : {})}
        >
          {item.primaryAction.label}
        </TxButton>
      )}
    </div>
  );
}

// A short status chip. Moving rows get an accent "live" pill; parked / standing
// / ready rows get a muted one keyed off the row kind.
function StatusChip({ item, moving }: { item: ActivityItem; moving: boolean }) {
  if (moving) {
    return (
      <span className="shrink-0 rounded-full bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent">
        Live
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-surface-overlay px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-text-muted">
      {item.kind === "garrison"
        ? "Standing"
        : item.kind === "expedition"
          ? "Estate"
          : "Idle"}
    </span>
  );
}

// Verb that precedes the live countdown, picked off the kind so the chip reads
// "Arrives 4m" / "Gathers 30s" / "Completes 2h" instead of the baked snapshot.
function statusVerb(item: ActivityItem): string {
  if (item.kind === "expedition") return "Completes in";
  if (item.kind === "rally" && item.statusText.startsWith("Gathers")) return "Gathers in";
  return "Arrives in";
}
