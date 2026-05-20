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
import {
  Home,
  Castle,
  Swords,
  Sword,
  Users,
  ShoppingBag,
  Map as MapIcon,
  Calendar,
  Trophy,
  Settings,
  Backpack,
  Plus,
  Sparkles,
  Skull,
  Flag,
  Crown,
  type LucideIcon,
} from "lucide-react";

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

const ICON_BY_LABEL: Record<string, LucideIcon> = {
  Home,
  Estate: Castle,
  Combat: Swords,
  Team: Users,
  Shop: ShoppingBag,
  Inventory: Backpack,
  Map: MapIcon,
  Events: Calendar,
  Leaderboard: Trophy,
  Settings,
  // Sub-page deep links
  Heroes: Sparkles,
  Dungeon: Skull,
  Arena: Sword,
  Rally: Flag,
  Subscription: Crown,
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
  const actions = useRightPanelStore((s) => s.actions);

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

  // Refs the morph animations write to.
  const pillRef = useRef<HTMLDivElement | null>(null);
  const navLayerRef = useRef<HTMLDivElement | null>(null);
  const actionLayerRef = useRef<HTMLDivElement | null>(null);
  const prevMode = useRef<Mode>("nav");

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
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(pill);
    return () => ro.disconnect();
  }, []);

  // Run the cross-fade whenever `mode` flips. The active layer is `relative`
  // (in flow, drives the pill's auto-width), the inactive layer is `absolute`
  // (overlays, doesn't fight for space). Width is driven by CSS — the pill
  // has a `transition: width` on it, so:
  //   - swapping modes → in-flow layer's natural width changes → pill follows
  //   - TxButton phase swap (spinner / Failed / Success!) → in-flow layer's
  //     natural width changes → pill follows
  // anime.js does the visible motion: cross-fade + translateY + scale on the
  // layers, and a staggered "speed dial" on the incoming children.
  useLayoutEffect(() => {
    const from = prevMode.current;
    const to = mode;
    prevMode.current = to;
    if (from === to) return;

    const navLayer = navLayerRef.current;
    const actionLayer = actionLayerRef.current;
    if (!navLayer || !actionLayer) return;

    if (prefersReducedMotion()) {
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
            const Icon = ICON_BY_LABEL[item.label] ?? Settings;
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
                  <Icon className="h-5 w-5 shrink-0" />
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
                <Icon className="h-5 w-5 shrink-0" />
                <span className="w-full truncate text-center text-[10px] font-medium">
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* The pill — one element, two layers stacked inside.
          Width is owned by CSS: the active layer is `relative` (in flow) and
          the pill's `transition: width` smooths every change — including
          TxButton phase swaps that resize a button's content. */}
      <div
        ref={pillRef}
        className="pointer-events-auto relative flex h-14 items-center overflow-hidden rounded-full border border-border-default bg-[var(--nm-bg-bar)]/95 shadow-xl shadow-black/40 backdrop-blur"
        style={{
          width: "auto",
          transition: "width 380ms cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
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
            const Icon = ICON_BY_LABEL[item.label] ?? Home;
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
                  <Icon className="h-5 w-5" />
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
                <Icon className="h-5 w-5" />
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

        {/* ACTION layer — same positioning rule inverted: drives width when
            active, overlays when inactive. The pill auto-fits whichever layer
            is in flow, and the CSS `transition: width` on the pill smooths
            both the mode swap *and* any per-frame width change from a
            TxButton's phase swap (spinner / "Failed" / "Success!"). */}
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

function ActionButton({ action }: { action: PanelAction }) {
  const variant = action.variant ?? "secondary";
  // Override TxButton's default `rounded-lg w-full px-4 py-2 text-sm` with
  // pill geometry, and lay tweaks for the secondary/danger fills on top of
  // its own variant base. `cn`+tailwind-merge picks the later class, so the
  // overrides win.
  const override = cn(
    "h-10 w-auto rounded-full px-5",
    variant === "secondary" &&
      "border border-border-default bg-surface-raised/80 text-text-secondary hover:bg-surface-overlay/60",
    variant === "danger" &&
      "border border-red-700 bg-red-600 text-white hover:bg-red-700",
  );
  return (
    <span data-morph-item className="inline-flex">
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
