"use client";

import { useMemo, useEffect, useState, useCallback, useLayoutEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { animate, stagger, utils } from "animejs";
import { useEstate } from "@/lib/hooks/useEstate";
import { useMediaQuery } from "@/lib/hooks/useMediaQuery";
import { BUILDING_FEATURES } from "@/lib/config/building-features";
import { findBuilding } from "novus-mundus-sdk";
import { buildingPhase } from "@/lib/narrative";
import { formatTime, prefersReducedMotion } from "@/lib/utils";
import { REORDER } from "@/lib/motion/tokens";
import {
  BuildingCard,
  type BuildingCardData,
  type BuildingStatus as CardStatus,
} from "./building-card";
import { hasCenterView } from "./feature-view";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";

/** Building slots a single plot holds. */
const SLOTS_PER_PLOT = 4;
/** The most plots a holding can claim. */
const MAX_PLOTS = 5;

interface BuildingGridProps {
  /** Currently selected building ID in the right panel */
  selectedBuildingId: number | null;
  onSelectBuilding: (id: number) => void;
  /** Navigation function for center-view features */
  onOpenFeature?: (buildingId: number) => void;
  /** Buy the next plot — wired to the next claimable "Land Beyond" card. */
  onBuyPlot: (reportPhase: (p: TxPhase) => void) => Promise<string>;
  /** NOVI cost of the next plot, for the claim card label. */
  nextPlotCost: number;
}

export function BuildingGrid({
  selectedBuildingId,
  onSelectBuilding,
  onOpenFeature,
  onBuyPlot,
  nextPlotCost,
}: BuildingGridProps) {
  const { data: estateData } = useEstate();
  const estate = estateData?.account;
  const router = useRouter();

  const [tick, setTick] = useState(() => Math.floor(Date.now() / 1000));

  // Build info for all buildings — buildingPhase() is the single source of truth.
  const buildingInfo = useMemo(() => {
    return BUILDING_FEATURES.map((config) => {
      const slot = estate ? findBuilding(estate, config.id) : null;
      const phase = buildingPhase(slot, tick);
      const constructing =
        phase === "rising" || phase === "raised" || phase === "improving" || phase === "improved";
      const endsAt = slot?.constructionEnds?.toNumber?.() ?? 0;
      const remainingSec = constructing ? Math.max(0, endsAt - tick) : 0;
      const ready = phase === "raised" || phase === "improved";
      const status: CardStatus =
        phase === "unbuilt"
          ? "unbuilt"
          : phase === "standing"
            ? "active"
            : phase === "rising" || phase === "raised"
              ? "building"
              : "upgrading";
      return {
        config,
        phase,
        status,
        level: slot?.level ?? 0,
        constructing,
        remainingSec,
        ready,
        slot,
      };
    });
  }, [estate, tick]);

  // Tick timer for construction progress
  const hasConstructing = buildingInfo.some((b) => b.constructing);
  useEffect(() => {
    if (!hasConstructing) return;
    const interval = setInterval(() => {
      setTick(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [hasConstructing]);

  const plotsOwned = Math.max(1, Math.min(MAX_PLOTS, estate?.plotsOwned ?? 1));

  // Reframe the holding as land: every building that has broken ground (built,
  // standing, or under construction) is settled onto a claimed plot, four to a
  // parcel; buildings not yet raised wait in a separate "ground to break" set.
  // The on-chain model doesn't pin a building to a plot index, so the layout
  // is a stable visual fill — buildings settle in building-id order — not a
  // slot-accurate map.
  const { plots, unbuilt } = useMemo(() => {
    const ordered = [...buildingInfo].sort((a, b) => a.config.id - b.config.id);
    const settled = ordered.filter((b) => b.phase !== "unbuilt");
    const unbuilt = ordered.filter((b) => b.phase === "unbuilt");
    const plots: BuildingCardData[][] = [];
    for (let i = 0; i < plotsOwned; i++) {
      plots.push(settled.slice(i * SLOTS_PER_PLOT, (i + 1) * SLOTS_PER_PLOT));
    }
    // A building beyond the claimed plots' capacity has no parcel to sit on —
    // fold it back into the ground-to-break set so nothing is dropped.
    const overflow = settled.slice(plotsOwned * SLOTS_PER_PLOT);
    return { plots, unbuilt: [...overflow, ...unbuilt] };
  }, [buildingInfo, plotsOwned]);

  // Construction alerts (compact banner)
  const constructingBuildings = buildingInfo.filter((b) => b.constructing);

  // FLIP reflow root. Spans every plot grid + the ground-to-break grid so a
  // building that moves between sections (e.g. a parcel completes and the grid
  // re-sorts) slides across the whole board, not just within one container.
  const gridRootRef = useRef<HTMLDivElement>(null);
  const prevRects = useRef(new Map<number, DOMRect>());

  // Live breakpoint for the grid stagger origin. The plot grids are
  // grid-cols-2 lg:grid-cols-4, so the center-out ripple direction depends on
  // whether we are at the lg (1024px) breakpoint. Reading the wrong column
  // count points the ripple the wrong way on resize.
  const isLg = useMediaQuery("(min-width: 1024px)");
  const gridCols = isLg ? 4 : 2;

  // The order of settled building ids (the thing that actually moves a card to a
  // new slot) plus plots owned. Gating the FLIP measure on this signature keeps
  // useLayoutEffect from reading getBoundingClientRect on every 1s construction
  // tick; it only measures when the layout could have genuinely reflowed.
  const layoutSig = useMemo(() => {
    const settledIds = [...buildingInfo]
      .filter((b) => b.phase !== "unbuilt")
      .sort((a, b) => a.config.id - b.config.id)
      .map((b) => b.config.id)
      .join(",");
    const unbuiltIds = [...buildingInfo]
      .filter((b) => b.phase === "unbuilt")
      .map((b) => b.config.id)
      .join(",");
    return `${settledIds}|${unbuiltIds}|${plotsOwned}`;
  }, [buildingInfo, plotsOwned]);

  // FLIP: First/Last/Invert/Play keyed by building id (NOT DOM index, since the
  // grid re-sorts cards across plots by id). Measure the new committed layout, invert
  // each card to its old position, then play the delta back to identity on the
  // REORDER spring. Stagger ripples out from the keep (grid center). We
  // cancel() rather than revert() so an overlapping reflow retargets cleanly and
  // the committed transform is never wiped (the FLIP teardown rule).
  // biome-ignore lint/correctness/useExhaustiveDependencies: measure is gated on the layout signature; gridCols re-keys the ripple on breakpoint change.
  useLayoutEffect(() => {
    const root = gridRootRef.current;
    if (!root) return;
    const cards = Array.from(root.querySelectorAll<HTMLElement>("[data-bcard]"));
    if (cards.length === 0) return;

    if (prefersReducedMotion()) {
      // Snap: record the new rects, never invert.
      for (const el of cards) {
        prevRects.current.set(Number(el.dataset.bcard), el.getBoundingClientRect());
      }
      return;
    }

    // Batch all reads before any writes to avoid layout thrash.
    const deltas: Array<{ el: HTMLElement; dx: number; dy: number }> = [];
    for (const el of cards) {
      const id = Number(el.dataset.bcard);
      const next = el.getBoundingClientRect();
      const prev = prevRects.current.get(id);
      if (prev) {
        const dx = prev.left - next.left;
        const dy = prev.top - next.top;
        if (dx || dy) deltas.push({ el, dx, dy });
      }
      prevRects.current.set(id, next);
    }

    if (deltas.length === 0) return;

    const animations = deltas.map(({ el, dx, dy }) =>
      // Invert to the old slot, play back to identity. composition:"replace" so a
      // second reflow mid-flight retargets instead of snapping back.
      animate(el, {
        translateX: [dx, 0],
        translateY: [dy, 0],
        ease: REORDER,
        composition: "replace",
        delay: stagger(28, { from: "center", grid: [gridCols, Math.ceil(cards.length / gridCols)] }),
      }),
    );

    // Do NOT revert a FLIP; it settles to identity on its own. cancel() only,
    // to stop in-flight tweens without wiping the committed transform.
    return () => {
      for (const a of animations) a.cancel();
    };
  }, [layoutSig, gridCols]);

  // Construction-alert muster: the "{N} rising" count rolls up on a spring via a
  // plain-object tween (utils.round for an integer ticker) instead of snapping
  // to the new value. Fires on the EDGE where the count changes.
  const musterRef = useRef<HTMLSpanElement>(null);
  const risingCount = constructingBuildings.length;
  const prevRising = useRef(risingCount);
  useEffect(() => {
    const el = musterRef.current;
    const from = prevRising.current;
    prevRising.current = risingCount;
    if (!el) return;
    if (from === risingCount) return;
    if (prefersReducedMotion()) {
      el.textContent = `${risingCount} rising`;
      return;
    }
    const counter = { v: from };
    const a = animate(counter, {
      v: risingCount,
      ease: REORDER,
      modifier: utils.round(0),
      onUpdate: () => {
        el.textContent = `${Math.round(counter.v)} rising`;
      },
    });
    return () => {
      a.cancel();
    };
  }, [risingCount]);

  // Newest chip leads. When the set of rising buildings GAINS an id, deal the
  // chips in with a from:"last" stagger so the most recent groundbreaking
  // animates first. Edge-detected on a Set-diff so it fires on the change, not
  // on every 1s tick (which only mutates the remaining-time text).
  const risingIds = useMemo(
    () => constructingBuildings.map((b) => b.config.id).join(","),
    [constructingBuildings],
  );
  const prevRisingIds = useRef<Set<number>>(new Set());
  // biome-ignore lint/correctness/useExhaustiveDependencies: fires on the rising-id Set edge (risingIds); constructingBuildings is re-derived each 1s tick but the Set-diff gates the actual animation, so re-running per tick would defeat the edge detection.
  useEffect(() => {
    const root = gridRootRef.current;
    const next = new Set(constructingBuildings.map((b) => b.config.id));
    const prev = prevRisingIds.current;
    prevRisingIds.current = next;
    if (!root) return;
    // Only a newly added id triggers the deal-in (a chip leaving never musters).
    let gained = false;
    for (const id of next) {
      if (!prev.has(id)) {
        gained = true;
        break;
      }
    }
    if (!gained || prefersReducedMotion()) return;
    const chips = root.querySelectorAll<HTMLElement>("[data-muster-chip]");
    if (chips.length === 0) return;
    const a = animate(chips, {
      opacity: [0, 1],
      translateY: [6, 0],
      ease: REORDER,
      delay: stagger(45, { from: "last" }),
    });
    return () => {
      a.cancel();
    };
  }, [risingIds]);

  const handleCardClick = useCallback(
    (data: BuildingCardData) => {
      const id = data.config.id;
      const { phase } = data;
      const usable = phase === "standing" || phase === "improving" || phase === "improved";
      // A usable building whose feature lives on another page navigates there
      // (e.g. Catacombs to the dungeon), instead of opening an estate panel.
      if (usable && data.config.route) {
        router.push(data.config.route);
        return;
      }
      // A built building with a feature view to open it. The feature stays
      // usable through an upgrade, so improving and improved route here too.
      if (usable && onOpenFeature && hasCenterView(id)) {
        onOpenFeature(id);
        return;
      }
      // Everything else — under construction, unbuilt, or standing without a
      // feature — opens the detail panel. The panel reads the building's live
      // phase and shows speed-up / complete or build / upgrade accordingly.
      onSelectBuilding(id);
    },
    [onSelectBuilding, onOpenFeature, router],
  );

  return (
    <div ref={gridRootRef} className="space-y-6">
      {/* Construction alerts banner as a live muster. The count rolls up on a
          spring (musterRef), and the rising chips deal in newest-first via a
          from:"last" stagger so the most recent groundbreaking leads the wave. */}
      {constructingBuildings.length > 0 && (
        <div className="rounded-lg border border-border-gold/60 bg-accent/10 px-4 py-2">
          <div className="flex items-center gap-2 text-xs">
            <span ref={musterRef} className="font-semibold text-text-gold">
              {risingCount} rising
            </span>
            <span className="flex flex-wrap gap-x-1.5 text-text-muted">
              {constructingBuildings.map((b, i) => (
                <span key={b.config.id} data-muster-chip>
                  {b.ready
                    ? `${b.config.name} (ready)`
                    : `${b.config.name} (${formatTime(b.remainingSec, "compact")})`}
                  {i < constructingBuildings.length - 1 ? "," : ""}
                </span>
              ))}
            </span>
          </div>
        </div>
      )}

      {/* Claimed plots — the land, parcel by parcel */}
      {plots.map((buildings, idx) => (
        <div key={`plot-${idx}`}>
          <div className="mb-2 flex items-baseline gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
              Plot {idx + 1}
            </h2>
            <span className="text-[10px] tabular-nums text-text-muted">
              {buildings.length}/{SLOTS_PER_PLOT}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {buildings.map((data) => (
              <BuildingCard
                key={data.config.id}
                data={data}
                selected={selectedBuildingId === data.config.id}
                onClick={() => handleCardClick(data)}
              />
            ))}
            {Array.from({ length: SLOTS_PER_PLOT - buildings.length }).map((_, slotIdx) => (
              <div
                key={`empty-${slotIdx}`}
                className="flex min-h-[5.5rem] items-center justify-center rounded-lg border border-dashed border-border-default/60 p-3 text-[11px] text-text-muted"
              >
                Open ground
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Ground still to break — buildings the holding has not yet raised */}
      {unbuilt.length > 0 && (
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Ground to Break
          </h2>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {unbuilt.map((data) => (
              <BuildingCard
                key={data.config.id}
                data={data}
                selected={selectedBuildingId === data.config.id}
                onClick={() => handleCardClick(data)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Land beyond the claim — plots the holding has not yet bought */}
      {plotsOwned < MAX_PLOTS && (
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Land Beyond Your Claim
          </h2>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {Array.from({ length: MAX_PLOTS - plotsOwned }).map((_, idx) => {
              const plotNumber = plotsOwned + idx + 1;
              // Plots claim in sequence — only the next one can be bought now.
              if (idx === 0) {
                return (
                  <TxButton
                    key={`unclaimed-${idx}`}
                    onClick={onBuyPlot}
                    variant="secondary"
                    className="flex min-h-[5.5rem] w-full flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-border-gold/50 bg-accent/10 p-3 text-center transition-colors hover:border-border-gold hover:bg-accent/20"
                  >
                    <span className="text-sm font-semibold text-text-gold">Buy Plot</span>
                    <span className="text-[11px] text-text-muted">
                      Plot {plotNumber} · {(nextPlotCost / 1000).toFixed(0)}k NOVI
                    </span>
                  </TxButton>
                );
              }
              return (
                <div
                  key={`unclaimed-${idx}`}
                  className="flex min-h-[5.5rem] flex-col items-center justify-center rounded-lg border border-dashed border-border-default/40 p-3 text-center opacity-50"
                >
                  <span className="text-sm font-semibold text-text-muted">Plot {plotNumber}</span>
                  <span className="mt-0.5 text-[11px] text-text-muted">Unclaimed ground</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
