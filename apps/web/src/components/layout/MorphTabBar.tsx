"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { animate, spring, stagger } from "animejs";
import { Plus } from "lucide-react";
import { GameIcon, type GameIconId } from "@/components/shared/GameIcon";

import { usePlayer } from "@/lib/hooks/usePlayer";
import { useEstate } from "@/lib/hooks/useEstate";
import { useFeatureGate, FEATURES } from "@/lib/hooks/useFeatureGate";
import {
  useRightPanelStore,
  type PanelAction,
} from "@/lib/store/right-panel";
import { cn } from "@/lib/utils";
import { TxButton } from "@/components/shared/TxButton";
import { PRIMARY, SECONDARY } from "./nav-config";

const ICON_BY_LABEL: Record<string, GameIconId> = {
  Home: "nav-home",
  Estate: "nav-estate",
  Combat: "nav-combat",
  Team: "nav-team",
  Shop: "nav-shop",
  Inventory: "nav-inventory",
  Map: "nav-map",
  Events: "nav-events",
  Leaderboard: "nav-leaderboard",
  Settings: "nav-settings",
  // Sub-page deep links
  Heroes: "nav-heroes",
  Dungeon: "nav-dungeon",
  Arena: "nav-arena",
  Rally: "nav-rally",
  Subscription: "nav-subscription",
};

const SPRING_OPEN = spring({ stiffness: 220, damping: 22 });
const EXIT_MS = 140;
const ENTER_MS = 260;

type Mode = "nav" | "actions";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The mobile bottom bar — one pill that morphs between two states:
 *
 *   nav      → 5 primary tabs + a `…` overflow that floats the secondary
 *              nav items above the pill
 *   actions  → whatever the open panel registered via `useMorphActions`
 *
 * The pill width animates between the two states, the children cross-fade with
 * a stagger, and the bar's physical position never moves. The desktop layout
 * doesn't render this — it stays on the right-side sidebar in `RightPanel`.
 */
export function MorphTabBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: playerData, isSuccess } = usePlayer();
  const { data: estateData } = useEstate();
  const showPanel = useRightPanelStore((s) => s.show);
  const open = useRightPanelStore((s) => s.open);
  const morphActions = useRightPanelStore((s) => s.morphActions);
  // The most recently registered panel owns the bar; any earlier panels wait
  // their turn beneath it. With no entries the bar shows its nav tabs.
  const actions = morphActions[morphActions.length - 1]?.actions ?? [];

  const player = playerData?.account;
  const hasPlayer = !!player;
  const hasEstate = !!estateData?.account;
  const buildings = estateData?.account?.buildings;
  const extensions = player?.extensions ?? 0;
  const disabled = isSuccess && !hasPlayer;

  // Resolve lock state for the secondary deep-link items. Hooks are called
  // unconditionally in a fixed order — safe because the feature set is static.
  // Items remain tappable when locked so the destination page can render its
  // own LockedCard with Cairn-framed guidance for the missing requirements.
  const heroesGate = useFeatureGate(FEATURES.HERO_MINT);
  const dungeonGate = useFeatureGate(FEATURES.DUNGEON_ENTER);
  const arenaGate = useFeatureGate(FEATURES.ARENA_JOIN);
  const rallyGate = useFeatureGate(FEATURES.RALLY_JOIN);
  const subscriptionGate = useFeatureGate(FEATURES.SUBSCRIPTION);

  const featureLocks: Record<string, boolean> = {
    [FEATURES.HERO_MINT]: !heroesGate.allowed,
    [FEATURES.DUNGEON_ENTER]: !dungeonGate.allowed,
    [FEATURES.ARENA_JOIN]: !arenaGate.allowed,
    [FEATURES.RALLY_JOIN]: !rallyGate.allowed,
    [FEATURES.SUBSCRIPTION]: !subscriptionGate.allowed,
  };

  const hasBuilding = useCallback(
    (type: number) =>
      !!buildings?.some(
        (b: any) =>
          b.buildingType === type &&
          (b.status === 2 || b.status === 3) &&
          b.level >= 1,
      ),
    [buildings],
  );

  const pageLocked: Record<string, boolean> = hasPlayer
    ? {
        "/combat": !hasEstate,
        "/map": !hasEstate || !hasBuilding(17),
        "/team": !(extensions & (1 << 2)),
        "/shop": !(extensions & (1 << 0)),
      }
    : {};

  // The mode is derived from store state — a panel with actions is the only
  // thing that flips us out of nav mode.
  // Actions alone trigger the morph — `open` (RightPanel) was previously
  // required, but the Shop's DetailPanel + other sheet-y surfaces live outside
  // the right-panel store and also want to surface actions. `useMorphActions`
  // clears on unmount so stale callers don't leak.
  const mode: Mode = actions.length > 0 ? "actions" : "nav";
  // A panel with 3+ actions can't fit the centered pill — the bar drops to a
  // full-width row of even segments so every action stays visible and tappable.
  // The pill is kept for nav and for 1-2 actions.
  const wide = mode === "actions" && actions.length >= 3;

  // Refs the morph animations write to.
  const pillRef = useRef<HTMLDivElement | null>(null);
  const navLayerRef = useRef<HTMLDivElement | null>(null);
  const actionLayerRef = useRef<HTMLDivElement | null>(null);
  const prevMode = useRef<Mode>("nav");

  // Width-morph bookkeeping. The pill animates its width between modes —
  // CSS can't transition a content-driven `auto` width — so anime.js drives
  // it. `restWidth` is the pill's settled width (tracked by the ResizeObserver
  // below); `widthAnimating` gates that tracking off while our animation owns
  // the width.
  const widthAnim = useRef<ReturnType<typeof animate> | null>(null);
  const widthAnimating = useRef(false);
  const restWidth = useRef(0);

  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement | null>(null);
  const toggleBtnRef = useRef<HTMLButtonElement | null>(null);
  const plusIconRef = useRef<SVGSVGElement | null>(null);

  // Close the overflow menu when route changes or panel opens.
  useEffect(() => {
    setOverflowOpen(false);
  }, [pathname, open]);

  // Dismiss overflow on outside tap — but **not** when the tap is on the
  // toggle button itself. The toggle's onClick already flips the state; if we
  // also fire `setOverflowOpen(false)` from this handler on the same tap, the
  // state flips twice and the popover never closes (i.e. the `×` keeps showing).
  useEffect(() => {
    if (!overflowOpen) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (overflowRef.current?.contains(target)) return;
      if (toggleBtnRef.current?.contains(target)) return;
      setOverflowOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [overflowOpen]);

  // Animate the `+` ↔ `×` rotation and the popover entrance/exit. Keeping the
  // popover always mounted lets the spring back-out feel like one continuous
  // motion instead of a re-mount flash.
  useEffect(() => {
    const icon = plusIconRef.current;
    if (icon) {
      animate(icon, {
        rotate: overflowOpen ? 45 : 0,
        duration: 280,
        ease: SPRING_OPEN,
      });
    }
    const pop = overflowRef.current;
    if (pop) {
      if (overflowOpen) {
        animate(pop, {
          opacity: [0, 1],
          translateY: [10, 0],
          scale: [0.92, 1],
          duration: 240,
          ease: SPRING_OPEN,
        });
      } else {
        animate(pop, {
          opacity: [1, 0],
          translateY: [0, 10],
          scale: [1, 0.92],
          duration: 160,
          ease: "out(2)",
        });
      }
    }
  }, [overflowOpen]);

  // Mirror the pill's current width onto the overflow popover so the two share
  // a visual footprint. ResizeObserver tracks every frame of the pill's CSS
  // width transition (mode swaps, TxButton phase changes) so the popover
  // stays in lockstep without coupling to how the pill computes its width.
  useEffect(() => {
    const pill = pillRef.current;
    const pop = overflowRef.current;
    if (!pill || !pop) return;
    const sync = () => {
      pop.style.width = `${pill.offsetWidth}px`;
      // Remember the pill's settled width so a morph can animate *from* it,
      // but not while our own width animation is the one resizing it.
      if (!widthAnimating.current) restWidth.current = pill.offsetWidth;
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(pill);
    return () => ro.disconnect();
  }, []);

  // Morph whenever `mode` flips. The active layer is `relative` (in flow, so
  // its natural width is the pill's resting width); the inactive layer is
  // `absolute` (overlays, doesn't fight for space). Three things move:
  //   - the pill's width — animated between the two layers' resting widths,
  //     since CSS can't transition a content-driven `auto` width;
  //   - the layers — cross-fade + translateY + scale;
  //   - the incoming children — a staggered "speed dial".
  // The pill is handed back to `width: auto` once the morph settles, so a
  // later TxButton phase swap (spinner / Failed / Success!) still resizes it.
  useLayoutEffect(() => {
    const from = prevMode.current;
    const to = mode;
    prevMode.current = to;
    if (from === to) return;

    const reduce = prefersReducedMotion();

    // Width morph — from the pill's old resting width to the new one. While a
    // previous morph is still animating, `offsetWidth` is the live value to
    // continue from; at rest it has already snapped to the new content, so
    // the old width comes from `restWidth` instead.
    const pill = pillRef.current;
    if (pill) {
      const fromW = widthAnimating.current
        ? pill.offsetWidth
        : restWidth.current;
      pill.style.width = "auto";
      const toW = pill.offsetWidth;
      if (reduce || fromW <= 0 || fromW === toW) {
        pill.style.width = "auto";
      } else {
        widthAnim.current?.pause();
        widthAnimating.current = true;
        pill.style.width = `${fromW}px`;
        widthAnim.current = animate(pill, {
          width: [fromW, toW],
          ease: SPRING_OPEN,
          onComplete: () => {
            widthAnimating.current = false;
            pill.style.width = "auto";
          },
        });
      }
    }

    const navLayer = navLayerRef.current;
    const actionLayer = actionLayerRef.current;
    if (!navLayer || !actionLayer) return;

    if (reduce) {
      navLayer.style.opacity = to === "nav" ? "1" : "0";
      actionLayer.style.opacity = to === "actions" ? "1" : "0";
      return;
    }

    const outgoing = from === "nav" ? navLayer : actionLayer;
    const incoming = to === "nav" ? navLayer : actionLayer;
    const incomingChildren = Array.from(
      incoming.querySelectorAll<HTMLElement>("[data-morph-item]"),
    );

    // Exit — fade + drop + slight shrink
    animate(outgoing, {
      opacity: [1, 0],
      translateY: [0, 8],
      scale: [1, 0.94],
      duration: EXIT_MS,
      ease: "out(3)",
    });

    // Enter — fade + rise + a tiny scale-up overshoot from the spring
    incoming.style.opacity = "0";
    animate(incoming, {
      opacity: [0, 1],
      translateY: [8, 0],
      scale: [0.94, 1],
      duration: ENTER_MS,
      delay: EXIT_MS - 40,
      ease: SPRING_OPEN,
    });
    animate(incomingChildren, {
      translateY: [14, 0],
      opacity: [0, 1],
      scale: [0.85, 1],
      duration: ENTER_MS,
      delay: stagger(36, { start: EXIT_MS - 40 }),
      ease: SPRING_OPEN,
    });
  }, [mode]);

  const isActive = (href: string) =>
    pathname === href || pathname?.startsWith(href + "/");

  // Render — note both layers are always in the DOM. The hidden measurement
  // copies live off-screen so we can size the pill before showing the morph.
  // Wide mode: a full-width bar of equal flex segments. Self-contained — it
  // doesn't touch the pill's width-morph machinery, so the pill path stays
  // unchanged for nav / single-action panels.
  if (wide) {
    return (
      <div
        className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center md:hidden"
        style={{ bottom: "max(12px, env(safe-area-inset-bottom))" }}
      >
        <div className="pointer-events-auto flex h-14 w-[calc(100vw-1rem)] items-center gap-2 rounded-full border border-border-default bg-[var(--nm-bg-bar)]/95 px-3 shadow-xl shadow-black/40 backdrop-blur">
          {actions.map((a) => (
            <ActionButton key={a.id} action={a} wide />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center md:hidden"
      style={{ bottom: "max(12px, env(safe-area-inset-bottom))" }}
    >
      {/* Anchor so the popover can float absolutely above the pill without
          taking layout space when it's hidden (otherwise the pill drifts up
          from the bottom edge because the popover's `mb-3` still applies). */}
      <div className="pointer-events-auto relative flex justify-center">

      {/* Overflow popover — 4-col tile grid (iOS Quick Actions style). Each
          item is a chip with its own subtle background, icon stacked above its
          label. Always mounted so anime.js can spring it in/out without remount
          flicker. Items stay tappable when locked so the destination page can
          render its own Cairn-framed guidance for missing requirements. */}
      <div
        ref={overflowRef}
        className="absolute bottom-full left-1/2 mb-3 max-w-[calc(100vw-1rem)] -translate-x-1/2 rounded-2xl border border-border-default bg-[var(--nm-bg-bar)]/95 p-2 shadow-xl shadow-black/40 backdrop-blur"
        style={{
          opacity: 0,
          pointerEvents: overflowOpen ? "auto" : "none",
          willChange: "opacity, transform",
        }}
      >
        <div className="grid grid-cols-4 gap-1">
          {SECONDARY.map((item) => {
            const iconId = ICON_BY_LABEL[item.label] ?? "nav-settings";
            const locked = item.feature ? !!featureLocks[item.feature] : false;

            const tileClass = cn(
              "flex flex-col items-center justify-center gap-1 rounded-lg px-1 py-2.5 transition-colors",
              locked
                ? "bg-surface-overlay/20 text-zinc-600"
                : "bg-surface-overlay/40 text-text-secondary hover:bg-surface-overlay/70 hover:text-text-primary",
            );

            if (item.panel) {
              return (
                <button
                  key={item.panel}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setOverflowOpen(false);
                    showPanel(item.label, item.panel!);
                  }}
                  className={cn(tileClass, "disabled:opacity-40")}
                >
                  <GameIcon
                    id={iconId}
                    title={item.label}
                    size={16}
                    className="shrink-0"
                  />
                  <span className="w-full truncate text-center text-[10px] font-medium">
                    {item.label}
                  </span>
                </button>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href!}
                onClick={() => setOverflowOpen(false)}
                className={tileClass}
              >
                <GameIcon
                  id={iconId}
                  title={item.label}
                  size={16}
                  className="shrink-0"
                />
                <span className="w-full truncate text-center text-[10px] font-medium">
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* The pill — one element, two layers stacked inside. Its resting width
          is `auto` (it shrink-wraps whichever layer is in flow); the morph
          animates that width via anime.js, then hands it back. `justify-center`
          keeps the in-flow layer centred while the width is mid-animation. */}
      <div
        ref={pillRef}
        className="pointer-events-auto relative flex h-14 items-center justify-center overflow-hidden rounded-full border border-border-default bg-[var(--nm-bg-bar)]/95 shadow-xl shadow-black/40 backdrop-blur"
        style={{ width: "auto" }}
      >
        {/* NAV layer — `relative` when active so it drives the pill's
            auto-width, `absolute` when inactive so it doesn't fight the
            ACTION layer for layout space. */}
        <div
          ref={navLayerRef}
          className={cn(
            "flex items-center gap-2 px-3",
            mode === "nav" ? "relative" : "absolute inset-0 justify-center",
          )}
          style={{
            opacity: mode === "nav" ? 1 : 0,
            pointerEvents: mode === "nav" ? "auto" : "none",
            willChange: "opacity, transform",
          }}
        >
          {PRIMARY.map((item) => {
            const iconId = ICON_BY_LABEL[item.label] ?? "nav-home";
            const active = isActive(item.href);
            const locked = !!pageLocked[item.href];
            const cls = cn(
              "flex h-11 w-11 items-center justify-center rounded-full transition-colors",
              active
                ? "tier-accent-text bg-surface-overlay/60"
                : locked
                  ? "text-zinc-600"
                  : "text-text-secondary active:bg-surface-overlay/40",
            );
            if (disabled) {
              return (
                <span
                  key={item.href}
                  data-morph-item
                  aria-label={item.label}
                  className={cn(cls, "opacity-40")}
                >
                  <GameIcon id={iconId} title={item.label} size={16} />
                </span>
              );
            }
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
                data-morph-item
                className={cls}
              >
                <GameIcon id={iconId} title={item.label} size={16} />
              </Link>
            );
          })}
          <button
            ref={toggleBtnRef}
            type="button"
            aria-label={overflowOpen ? "Close menu" : "More"}
            data-morph-item
            disabled={disabled}
            onClick={() => setOverflowOpen((v) => !v)}
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-full transition-colors",
              overflowOpen
                ? "tier-accent-text bg-surface-overlay/60"
                : "text-text-secondary active:bg-surface-overlay/40",
              disabled && "opacity-40",
            )}
          >
            <Plus ref={plusIconRef} className="h-5 w-5" style={{ willChange: "transform" }} />
          </button>
        </div>

        {/* ACTION layer — same positioning rule inverted: `relative` (drives
            the pill's resting width) when active, `absolute` overlay when
            inactive. A TxButton phase swap (spinner / "Failed" / "Success!")
            resizes it; the pill's `auto` width snaps to follow. */}
        <div
          ref={actionLayerRef}
          className={cn(
            "flex items-center justify-center gap-2 px-3",
            mode === "actions" ? "relative" : "absolute inset-0",
          )}
          style={{
            opacity: mode === "actions" ? 1 : 0,
            pointerEvents: mode === "actions" ? "auto" : "none",
            willChange: "opacity, transform",
          }}
        >
          {actions.map((a) => (
            <ActionButton key={a.id} action={a} />
          ))}
        </div>
      </div>

      </div>
      {/* /anchor */}
    </div>
  );
}

function ActionButton({
  action,
  wide,
}: {
  action: PanelAction;
  wide?: boolean;
}) {
  const variant = action.variant ?? "secondary";
  // Override TxButton's default `rounded-lg w-full px-4 py-2 text-sm` with
  // pill geometry, and lay tweaks for the secondary/danger fills on top of
  // its own variant base. `cn`+tailwind-merge picks the later class, so the
  // overrides win. In `wide` mode the wrapper is the flex segment, so keep
  // TxButton's `w-full` (drop the `w-auto` override) and tighten the padding.
  const override = cn(
    wide ? "h-10 min-w-0 rounded-full px-3 text-xs" : "h-10 w-auto rounded-full px-5",
    variant === "secondary" &&
      "border border-border-default bg-surface-raised/80 text-text-secondary hover:bg-surface-overlay/60",
    variant === "danger" &&
      "border border-red-700 bg-red-600 text-white hover:bg-red-700",
  );
  return (
    <span
      data-morph-item
      className={cn("inline-flex", wide && "min-w-0 flex-1")}
    >
      <TxButton
        onClick={action.onClick}
        variant={variant}
        disabled={action.disabled}
        className={override}
      >
        {action.label}
      </TxButton>
    </span>
  );
}
