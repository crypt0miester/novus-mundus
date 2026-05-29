"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { animate, spring, stagger } from "animejs";
import { Plus, X, ChevronLeft } from "lucide-react";
import { GameIcon, type GameIconId } from "@/components/shared/GameIcon";

import { usePlayer } from "@/lib/hooks/usePlayer";
import { useEstate } from "@/lib/hooks/useEstate";
import { useFeatureGate, FEATURES } from "@/lib/hooks/useFeatureGate";
import { useRightPanelStore, type PanelAction } from "@/lib/store/right-panel";
import { useSheetStore } from "@/lib/store/sheet";
import { useMorphComposeStore } from "@/lib/store/morph-compose";
import { useKeyboardInset } from "@/lib/hooks/useKeyboardInset";
import { useIsPhone } from "@/lib/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import { TxButton } from "@/components/shared/TxButton";
import { PRIMARY, SECONDARY, computePageLocks } from "./nav-config";
import { useUnread } from "@/lib/hooks/useUnread";

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

// The wide shape pins the bar to the nav group's footprint so its edges — and
// the dismiss circle — line up exactly with nav mode: a 5-tab pill (278) + gap
// (8) + circle (56) = 342. Pinning is what keeps the bar from jumping as it
// morphs in from nav.
const NAV_GROUP_WIDTH = 342;
const CIRCLE_SIZE = 56;
const GROUP_GAP = 8;

// Rollback flag (design §15). false = no compose shape: the bar keeps its three
// shapes and ThreadRenderer renders the composer inline (today's behaviour).
const COMPOSE_IN_BAR = true;
// Compose pill geometry. Margin matches the wrapper's bottom inset; the pill
// spans the viewport minus both margins (and the circle, when one shows), capped.
const COMPOSE_MARGIN = 12;
const COMPOSE_MAX = 560;

type Mode = "nav" | "actions";
// The bar's three resting shapes; the morph keys off this single value.
// `actions` is the narrow centred pill (1-2 plain actions); `wide` is the
// nav-group-width bar (3+ actions, or a dismiss ✕).
type Shape = "nav" | "actions" | "wide" | "compose";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The mobile bottom bar — one pill that morphs between three shapes:
 *
 *   nav to 5 primary tabs in the pill, beside a separate `+` circle
 *              that floats the secondary nav items above the bar
 *   actions to 1-2 panel actions in the same pill, centred
 *   wide to 3+ actions (or a dismiss ✕) in a bar pinned to the nav
 *              group's width, the ✕ taking the circle slot
 *
 * The pill is a *single persistent element* across all three — it is never
 * unmounted and re-rendered as a different tree, so its contents can't jump
 * between shapes. Its width animates between the shapes' resting widths, the
 * two layers stacked inside cross-fade with a stagger, and the bar's physical
 * position never moves. The desktop layout doesn't render this — it stays on
 * the right-side sidebar in `RightPanel`.
 */
export function MorphTabBar() {
  const pathname = usePathname();
  const router = useRouter();
  const unread = useUnread();
  const { data: playerData, isSuccess } = usePlayer();
  const { data: estateData } = useEstate();
  const showPanel = useRightPanelStore((s) => s.show);
  const open = useRightPanelStore((s) => s.open);
  const morphActions = useRightPanelStore((s) => s.morphActions);
  // The most recently registered panel owns the bar; any earlier panels wait
  // their turn beneath it. With no entries the bar shows its nav tabs.
  const panelActions = morphActions[morphActions.length - 1]?.actions ?? [];

  // Compose shape: a surface (team dock / full-page DM) hosting its composer in
  // the bar. Store-driven and phone-gated; the bar is `md:hidden`, and isPhone
  // also keeps a non-phone-gated future consumer from registering above `md`
  // (where it would portal into a `display:none` slot and trap the draft).
  const composeEntries = useMorphComposeStore((s) => s.entries);
  const setComposeSlot = useMorphComposeStore((s) => s.setSlotEl);
  const composeTop = composeEntries[composeEntries.length - 1];
  const isPhone = useIsPhone();
  const composeActive = COMPOSE_IN_BAR && isPhone && composeTop !== undefined;
  const composeDismiss = composeTop?.dismiss ?? null;
  const kbInset = useKeyboardInset();

  // While a bottom sheet is open the bar always carries a ✕ that closes it,
  // appended as a `kind: "dismiss"` action so it renders as the standalone
  // circle — the same slot the `+` toggle occupies. We only append the
  // sheet-close when the panel hasn't registered its own dismiss already;
  // otherwise both dismisses end up in `actions`, only the first is
  // pulled out to the standalone circle, and the second renders as a
  // stray inline ✕ pill inside the action row.
  const topSheet = useSheetStore((s) => s.openSheets[s.openSheets.length - 1]);
  const panelHasDismiss = panelActions.some((a) => a.kind === "dismiss");
  const actions: PanelAction[] =
    topSheet && !panelHasDismiss
      ? [
          ...panelActions,
          {
            id: "sheet-close",
            kind: "dismiss",
            label: "✕",
            onClick: async () => {
              topSheet.close();
              return "";
            },
          },
        ]
      : panelActions;

  const player = playerData?.account;
  const hasPlayer = !!player;
  const hasEstate = !!estateData?.account;
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

  const pageLocked = computePageLocks(hasPlayer, hasEstate, extensions);

  // The mode is derived from store state — a panel with actions is the only
  // thing that flips us out of nav mode. Actions alone trigger the morph;
  // `useMorphActions` clears on unmount so stale callers don't leak.
  const mode: Mode = actions.length > 0 ? "actions" : "nav";

  // A `dismiss` ✕ is lifted out of the action row into its own circle — the
  // slot nav mode's `+` toggle occupies — so it never shares the pill. The
  // pill itself only ever carries the plain `rowActions`.
  const dismiss = actions.find((a) => a.kind === "dismiss");
  const rowActions = dismiss ? actions.filter((a) => a !== dismiss) : actions;

  // A panel with 3+ actions can't fit the centred pill; a dismiss ✕ likewise
  // needs the standalone circle. Either drops the bar to its wide shape — a
  // bar pinned to the nav group's width. 1-2 plain actions keep the pill.
  const wide =
    mode === "actions" && (actions.length >= 3 || actions.some((a) => a.kind === "dismiss"));

  // One value drives the morph. The pill is the same DOM element in every
  // shape; only its width, which layer is in flow, and the circle slot's
  // tenant change between them. Compose is top-priority: an open composer owns
  // the whole bar over wide/actions/nav. Store-driven, NOT gated on topSheet,
  // so the full-page DM (which has no sheet) still enters compose.
  const shape: Shape = composeActive ? "compose" : wide ? "wide" : mode;

  // A content-only sheet (a dismiss ✕ but no panel actions) has nothing for
  // the pill to carry. It stays mounted as an invisible spacer — so the morph
  // machinery and the circle's placement are unaffected — but drops its chrome
  // rather than showing an empty bar.
  const pillEmpty = shape === "wide" && rowActions.length === 0;

  // Wide pins the pill's width so its left/right edges land on the nav pill's
  // — minus the circle's slot when a dismiss ✕ takes it.
  const wideBarWidth = dismiss ? NAV_GROUP_WIDTH - GROUP_GAP - CIRCLE_SIZE : NAV_GROUP_WIDTH;

  // Compose spans most of the viewport. The circle allowance is subtracted only
  // when a circle actually renders (a sheet to close, or a surface dismiss); with
  // neither, the pill spans the full inner width. `vw` starts at 0 (not measured)
  // and is filled from window on the first compose-active frame, then tracked on
  // resize/rotate. The 0 is a not-yet-measured sentinel, not a fallback shim.
  const composeHasCircle = !!topSheet || !!composeDismiss;
  const [vw, setVw] = useState(0);
  const composeWidth = Math.min(
    (vw || (typeof window === "undefined" ? COMPOSE_MAX : window.innerWidth)) -
      2 * COMPOSE_MARGIN -
      (composeHasCircle ? CIRCLE_SIZE + GROUP_GAP : 0),
    COMPOSE_MAX,
  );
  useEffect(() => {
    if (!composeActive) return;
    const onResize = () => setVw(window.innerWidth);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [composeActive]);

  // Refs the morph animations write to.
  const pillRef = useRef<HTMLDivElement | null>(null);
  const navLayerRef = useRef<HTMLDivElement | null>(null);
  const actionLayerRef = useRef<HTMLDivElement | null>(null);
  const composeLayerRef = useRef<HTMLDivElement | null>(null);
  const slotRef = useRef<HTMLDivElement | null>(null);
  const prevShape = useRef<Shape>("nav");

  // Maps a shape to the layer in flow / visible for it. nav has its own layer;
  // actions and wide share the action layer; compose has the slot layer.
  const layerFor = (s: Shape): HTMLDivElement | null => {
    if (s === "nav") return navLayerRef.current;
    if (s === "compose") return composeLayerRef.current;
    return actionLayerRef.current; // actions | wide
  };

  // Width-morph bookkeeping. The pill animates its width between shapes —
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

  // Close the overflow menu when the route changes, a panel opens, or the bar
  // morphs to actions (the toggle that owns the menu unmounts in that mode).
  useEffect(() => {
    setOverflowOpen(false);
  }, [pathname, open, mode]);

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

  // Track the pill's settled width so a width-morph can animate *from* it.
  // The ResizeObserver catches every frame of a CSS width change (e.g. a
  // TxButton phase swap resizing the action layer), but not while our own
  // anime.js width animation is the thing doing the resizing.
  useEffect(() => {
    const pill = pillRef.current;
    if (!pill) return;
    const sync = () => {
      if (widthAnimating.current) return;
      const w = pill.offsetWidth;
      if (w !== restWidth.current) restWidth.current = w;
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(pill);
    return () => ro.disconnect();
  }, []);

  // Publish the slot DOM node so the owning surface can portal its <Composer/>
  // into it. The slot lives in the always-mounted compose layer, so it is never
  // removed; the cleanup nulls the store before this effect re-runs or the bar
  // unmounts, so a consumer reading `slotEl` can't portal into a stale node.
  useEffect(() => {
    if (shape === "compose") {
      setComposeSlot(slotRef.current);
      return () => setComposeSlot(null);
    }
    setComposeSlot(null);
  }, [shape, setComposeSlot]);

  // Morph whenever the shape flips. The pill is one persistent element in
  // every shape, so its buttons stay put — only what's *inside* transforms.
  // Three things move:
  //   - the pill's width — animated between the shapes' resting widths, since
  //     CSS can't transition a content-driven `auto` width;
  //   - the nav/action layers stacked inside — cross-fade + translateY + scale;
  //   - the incoming layer's children — a staggered "speed dial".
  // Non-wide shapes are handed back to `width: auto` once the morph settles
  // (so a later TxButton phase swap can resize the pill); the wide shape keeps
  // its pinned width, since its buttons are fixed flex segments.
  useLayoutEffect(() => {
    const from = prevShape.current;
    const to = shape;
    prevShape.current = to;

    const reduce = prefersReducedMotion();

    // Width morph. Evaluated even when the shape is unchanged, so a wide to wide
    // width change — a dismiss ✕ appearing or leaving — still animates; only
    // the cross-fade further down is gated on a real shape change.
    const pill = pillRef.current;
    if (pill) {
      const fromW = widthAnimating.current ? pill.offsetWidth : restWidth.current;
      // Where the pill rests after the morph: a pinned width for wide, or
      // back to content-driven `auto` for nav / 1-2 actions.
      const settle = () => {
        pill.style.width =
          to === "wide"
            ? `${wideBarWidth}px`
            : to === "compose"
              ? `${composeWidth}px`
              : "auto";
      };
      let toW: number;
      if (to === "wide") {
        toW = wideBarWidth;
      } else if (to === "compose") {
        toW = composeWidth;
      } else {
        pill.style.width = "auto";
        toW = pill.offsetWidth;
      }
      if (reduce || fromW <= 0 || fromW === toW) {
        settle();
      } else {
        widthAnim.current?.pause();
        widthAnimating.current = true;
        pill.style.width = `${fromW}px`;
        widthAnim.current = animate(pill, {
          width: [fromW, toW],
          ease: SPRING_OPEN,
          onComplete: () => {
            widthAnimating.current = false;
            settle();
          },
        });
      }
    }

    if (from === to) return;

    const outgoing = layerFor(from);
    const incoming = layerFor(to);
    if (!outgoing || !incoming) return;

    if (reduce) {
      // Set every layer's opacity explicitly so none is left visible.
      for (const s of ["nav", "actions", "wide", "compose"] as const) {
        const el = layerFor(s);
        if (el) el.style.opacity = el === incoming ? "1" : "0";
      }
      return;
    }

    const incomingChildren = Array.from(
      incoming.querySelectorAll<HTMLElement>("[data-morph-item]"),
    );

    // actions ↔ wide stay on the *same* action layer — there's no second
    // layer to cross-fade, so the buttons just re-deal as the pill resizes.
    // compose enters via the exit/enter path below; it has no [data-morph-item]
    // children, so the per-child stagger is a no-op and the plain layer
    // fade + rise carries it.
    if (incoming === outgoing) {
      animate(incomingChildren, {
        translateY: [10, 0],
        opacity: [0.4, 1],
        scale: [0.94, 1],
        duration: ENTER_MS,
        delay: stagger(28),
        ease: SPRING_OPEN,
      });
      return;
    }

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
  }, [shape, wideBarWidth, composeWidth]);

  const isActive = (href: string) => pathname === href || pathname?.startsWith(`${href}/`);

  // Render — one structure for every shape. Both layers are always in the DOM;
  // the inactive one is an `absolute` overlay so it costs no layout space.
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center md:hidden"
      style={{
        bottom: "max(12px, env(safe-area-inset-bottom))",
        // Lift the whole bar by the keyboard inset while composing, so the
        // textarea rides above the keyboard. translateY is compositor-cheap and
        // stacks on the resolved `bottom` (no safe-area double-count); the
        // anime.js width-morph never touches this wrapper.
        transform: composeActive ? `translateY(${-kbInset}px)` : undefined,
        transition: "transform 180ms cubic-bezier(0.32, 0.72, 0, 1)",
        willChange: composeActive ? "transform" : undefined,
      }}
    >
      {/* Row — the pill and (when the shape has one) its circle, centred as a
          group. One structure for every shape: the pill is a single persistent
          element that morphs, so its contents never jump between renders. The
          popover floats absolutely above this row (so it costs no layout space
          when hidden); because the row is viewport-centred, the popover's
          `left-1/2` lands on the viewport centre too. */}
      <div className="pointer-events-auto relative flex items-center gap-2">
        {/* Overflow popover — 4-col tile grid (iOS Quick Actions style). Each
            item is a chip with its own subtle background, icon stacked above its
            label. Always mounted so anime.js can spring it in/out without remount
            flicker. Items stay tappable when locked so the destination page can
            render its own Cairn-framed guidance for missing requirements. */}
        <div
          ref={overflowRef}
          className="absolute bottom-full left-1/2 mb-3 w-[calc(100vw-3.5rem)] max-w-sm -translate-x-1/2 rounded-2xl border border-border-default bg-[var(--nm-bg-bar)]/95 p-2.5 shadow-xl shadow-black/40 backdrop-blur"
          style={{
            opacity: 0,
            pointerEvents: overflowOpen ? "auto" : "none",
            willChange: "opacity, transform",
          }}
        >
          <div className="grid grid-cols-4 gap-1.5">
            {SECONDARY.map((item) => {
              const iconId = ICON_BY_LABEL[item.label] ?? "nav-settings";
              const locked = item.feature ? !!featureLocks[item.feature] : false;

              const tileClass = cn(
                "flex flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 transition-colors",
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
                    <GameIcon id={iconId} title={item.label} size={16} className="shrink-0" />
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
                  className={cn(tileClass, "relative")}
                >
                  {item.href === "/messages" && unread.total > 0 && (
                    <span
                      className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent"
                      aria-hidden
                    />
                  )}
                  <GameIcon id={iconId} title={item.label} size={16} className="shrink-0" />
                  <span className="w-full truncate text-center text-[10px] font-medium">
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* The pill — one element, two layers stacked inside. Its resting width
            is content-driven `auto` for nav and 1-2 actions (it shrink-wraps
            whichever layer is in flow); the wide shape pins it to a fixed width
            instead. The morph animates that width via anime.js. `justify-center`
            keeps the in-flow layer centred while the width is mid-animation. */}
        <div
          ref={pillRef}
          className={cn(
            "relative flex justify-center",
            // Compose holds a 56px floor (min-h-14) so a single-line pill matches
            // the dismiss circle's height beside it, grows upward to fit a
            // multi-line draft (capped), keeps its corners soft, and must not clip
            // the textarea/reply-chip; the other shapes are the fixed-height
            // clipped pill. anime.js animates width only, so height/radius ride a
            // short CSS transition.
            shape === "compose"
              ? "h-auto min-h-14 max-h-40 items-center rounded-3xl transition-[height,border-radius] duration-200"
              : "h-14 items-center overflow-hidden rounded-full",
            pillEmpty
              ? "pointer-events-none"
              : "pointer-events-auto border border-border-default bg-[var(--nm-bg-bar)]/95 shadow-xl shadow-black/40 backdrop-blur",
          )}
          style={{ width: "auto" }}
        >
          {/* NAV layer — `relative` only in the nav shape, where it drives the
              pill's auto-width; an `absolute` overlay otherwise so it doesn't
              fight the ACTION layer for layout space. */}
          <div
            ref={navLayerRef}
            className={cn(
              "flex items-center gap-2 px-1",
              shape === "nav" ? "relative" : "absolute inset-0 justify-center",
            )}
            style={{
              opacity: shape === "nav" ? 1 : 0,
              pointerEvents: shape === "nav" ? "auto" : "none",
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
          </div>

          {/* ACTION layer — `relative` only for the narrow `actions` shape,
              where it drives the pill's auto-width. In `wide` the pill's width
              is pinned, so the layer is an `absolute` overlay and its buttons
              flex to fill it; in `nav` it's an inactive overlay. A TxButton
              phase swap (spinner / "Failed" / "Success!") resizes it in the
              narrow shape; the pill's `auto` width snaps to follow. */}
          <div
            ref={actionLayerRef}
            className={cn(
              "flex items-center justify-center gap-2 px-1",
              shape === "actions" ? "relative" : "absolute inset-0",
            )}
            style={{
              opacity: shape === "actions" || shape === "wide" ? 1 : 0,
              pointerEvents: shape === "actions" || shape === "wide" ? "auto" : "none",
              willChange: "opacity, transform",
            }}
          >
            {rowActions.map((a) => (
              <ActionButton key={a.id} action={a} wide={wide} />
            ))}
          </div>

          {/* COMPOSE layer — `relative` only in compose (the slot drives the
              pinned width and full height); an inactive `absolute` overlay
              otherwise. Its single child is the empty slot the owning surface
              portals its <Composer/> into. No `data-morph-item` children, so the
              cross-fade treats it as a plain fade + rise. */}
          <div
            ref={composeLayerRef}
            className={cn("w-full", shape === "compose" ? "relative" : "absolute inset-0")}
            style={{
              opacity: shape === "compose" ? 1 : 0,
              pointerEvents: shape === "compose" ? "auto" : "none",
              willChange: "opacity, transform",
            }}
          >
            <div ref={slotRef} className="w-full px-1 py-1" />
          </div>
        </div>

        {/* Circle — the standalone slot beside the pill. The nav shape fills it
            with the `+` overflow toggle; the wide shape fills it with the
            dismiss ✕ when a sheet registered one. Same slot, same chrome either
            way, so it holds its place as the bar morphs. Detached from the
            morph itself — only its tenant swaps. */}
        {shape === "nav" && (
          <button
            ref={toggleBtnRef}
            type="button"
            aria-label={overflowOpen ? "Close menu" : "More"}
            disabled={disabled}
            onClick={() => setOverflowOpen((v) => !v)}
            className={cn(
              "pointer-events-auto relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full border shadow-xl shadow-black/40 backdrop-blur transition-colors",
              overflowOpen
                ? "tier-accent-border tier-accent-text bg-surface-overlay/80"
                : "border-border-default bg-[var(--nm-bg-bar)]/95 text-text-secondary active:bg-surface-overlay/60",
              disabled && "opacity-40",
            )}
          >
            {/* Unread dot so mobile sees new messages before opening the overflow. */}
            {!overflowOpen && unread.total > 0 && (
              <span
                className="absolute right-3 top-3 h-2.5 w-2.5 rounded-full border-2 border-[var(--nm-bg-bar)] bg-accent"
                aria-hidden
              />
            )}
            <Plus ref={plusIconRef} className="h-6 w-6" style={{ willChange: "transform" }} />
          </button>
        )}
        {shape === "wide" && dismiss && (
          <button
            type="button"
            aria-label="Close"
            onClick={() => {
              dismiss.onClick(() => {});
            }}
            className="pointer-events-auto flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-border-default bg-[var(--nm-bg-bar)]/95 text-text-secondary shadow-xl shadow-black/40 backdrop-blur transition-colors active:bg-surface-overlay/60"
          >
            <X className="h-6 w-6" />
          </button>
        )}
        {/* Compose circle — `self-end` keeps it bottom-anchored as the pill grows
            upward. A surface-supplied control (full-page DM back chevron) wins;
            otherwise the synthesized sheet-close (team dock). With neither, no
            circle and the pill spans the full width. */}
        {shape === "compose" &&
          (() => {
            const onTap = composeDismiss
              ? composeDismiss.onClick
              : topSheet
                ? () => topSheet.close()
                : undefined;
            if (!onTap) return null;
            const isBack = composeDismiss?.icon === "back";
            const DismissIcon = isBack ? ChevronLeft : X;
            return (
              <button
                type="button"
                aria-label={isBack ? "Back" : "Close"}
                onClick={onTap}
                className="pointer-events-auto flex h-14 w-14 shrink-0 items-center justify-center self-end rounded-full border border-border-default bg-[var(--nm-bg-bar)]/95 text-text-secondary shadow-xl shadow-black/40 backdrop-blur transition-colors active:bg-surface-overlay/60"
              >
                <DismissIcon className="h-6 w-6" />
              </button>
            );
          })()}
      </div>
      {/* /row */}
    </div>
  );
}

function ActionButton({ action, wide }: { action: PanelAction; wide?: boolean }) {
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
    variant === "danger" && "border border-red-700 bg-red-600 text-white hover:bg-red-700",
  );
  return (
    <span data-morph-item className={cn("inline-flex", wide && "min-w-0 flex-1")}>
      {/* `onHold`/`holdMax` forwarded as-is — TxButton renders the hold badge + fill. */}
      <TxButton
        onClick={action.onClick}
        onHold={action.onHold}
        holdMax={action.holdMax}
        variant={variant}
        disabled={action.disabled}
        className={override}
      >
        {action.label}
      </TxButton>
    </span>
  );
}
