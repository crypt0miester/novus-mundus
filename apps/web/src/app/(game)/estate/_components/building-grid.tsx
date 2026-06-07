"use client";

import { useMemo, useEffect, useState, useCallback, useLayoutEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { animate, stagger, utils } from "animejs";
import { useEstate } from "@/lib/hooks/useEstate";
import { useAnimeScope } from "@/lib/hooks/useAnimeScope";
import { formatTime, prefersReducedMotion } from "@/lib/utils";
import { REORDER, SETTLE, STAGGER, DUR } from "@/lib/motion/tokens";
import type { BuildingCardData } from "./building-card";
import { PlotParcel } from "./plot-parcel";
import { LockedParcel } from "./locked-parcel";
import { deriveBuildingInfo, splitPlots, MAX_PLOTS } from "./estate-layout";
import { hasCenterView } from "./feature-view";
import type { TxPhase } from "@/components/shared/TxButton";

interface BuildingGridProps {
  /** Currently selected building ID in the right panel */
  selectedBuildingId: number | null;
  onSelectBuilding: (id: number) => void;
  /** Navigation function for center-view features */
  onOpenFeature?: (buildingId: number) => void;
  /** Open the global building picker — wired to every break-ground site. */
  onBreakGround: () => void;
  /** Buy the next plot — wired to the claimable locked parcel. */
  onBuyPlot: (reportPhase: (p: TxPhase) => void) => Promise<string>;
  /** NOVI cost of the next plot, for the claim parcel label. */
  nextPlotCost: number;
}

export function BuildingGrid({
  selectedBuildingId,
  onSelectBuilding,
  onOpenFeature,
  onBreakGround,
  onBuyPlot,
  nextPlotCost,
}: BuildingGridProps) {
  const { data: estateData } = useEstate();
  const estate = estateData?.account;
  const router = useRouter();

  const [tick, setTick] = useState(() => Math.floor(Date.now() / 1000));

  // Build info for all buildings — buildingPhase() is the single source of
  // truth, shared with the right-panel picker via deriveBuildingInfo.
  const buildingInfo = useMemo(() => deriveBuildingInfo(estate, tick), [estate, tick]);

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

  // Reframe the holding as land: settled buildings settle onto claimed parcels,
  // four to a plot, in building-id order. `overflow` holds any settled building
  // beyond capacity (the chain should prevent it; surfaced, never dropped). The
  // unbuilt set is owned by the picker now, not rendered here.
  const { plots, overflow } = useMemo(
    () => splitPlots(buildingInfo, plotsOwned),
    [buildingInfo, plotsOwned],
  );

  // Construction alerts (compact banner)
  const constructingBuildings = buildingInfo.filter((b) => b.constructing);

  // FLIP reflow root. Spans every parcel so a building that moves between
  // parcels (e.g. a parcel completes and the grid re-sorts by id) slides across
  // the whole board, not just within one parcel.
  const gridRootRef = useRef<HTMLDivElement>(null);
  const prevRects = useRef(new Map<number, DOMRect>());

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
  // grid re-sorts cards across parcels by id). Measure the new committed layout,
  // invert each card to its old position, then play the delta back to identity on
  // the REORDER spring. The ripple staggers out from the grid center on a flat
  // index (cards now live in per-parcel 2x2s, so a single global grid origin no
  // longer maps to real positions). We cancel() rather than revert() so an
  // overlapping reflow retargets cleanly and the committed transform is never
  // wiped (the FLIP teardown rule).
  // biome-ignore lint/correctness/useExhaustiveDependencies: measure is gated on the layout signature.
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
        delay: stagger(24, { from: "center" }),
      }),
    );

    // Do NOT revert a FLIP; it settles to identity on its own. cancel() only,
    // to stop in-flight tweens without wiping the committed transform.
    return () => {
      for (const a of animations) a.cancel();
    };
  }, [layoutSig]);

  // Parcel-mount stagger: the survey lays itself out parcel by parcel on first
  // paint, each settling up into place. translateY only (not opacity) so the
  // dim on ghosted locked parcels is left alone. Runs once; reduced motion snaps
  // to rest. The FLIP above owns card motion and has no prevRects on mount, so
  // the two never fight.
  useAnimeScope({ root: gridRootRef }, ({ reduce }) => {
    const root = gridRootRef.current;
    if (!root) return;
    const parcels = Array.from(root.querySelectorAll<HTMLElement>("[data-parcel]"));
    if (parcels.length === 0) return;
    if (reduce) {
      utils.set(parcels, { translateY: 0 });
      return;
    }
    utils.set(parcels, { translateY: 10 });
    animate(parcels, {
      translateY: [10, 0],
      delay: stagger(STAGGER.tight, { from: "first" }),
      duration: DUR.base,
      ease: SETTLE,
    });
  });

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
      // Everything else — under construction or standing without a feature —
      // opens the detail panel. The panel reads the building's live phase and
      // shows speed-up / complete accordingly.
      onSelectBuilding(id);
    },
    [onSelectBuilding, onOpenFeature, router],
  );

  return (
    <div ref={gridRootRef} className="space-y-4">
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

      {/* The survey: every plot, parcel by parcel — claimed parcels with their
          built cards and break-ground sites, then the locked ground beyond. The
          parcels flow in a responsive outer grid; each is a fixed 2x2 inside so
          it reads as a square of land at every width. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plots.map((buildings, idx) => (
          <PlotParcel
            key={`plot-${idx}`}
            index={idx}
            buildings={buildings}
            selectedBuildingId={selectedBuildingId}
            onCardClick={handleCardClick}
            onBreakGround={onBreakGround}
          />
        ))}

        {/* Land beyond the claim — locked parcels; the next one carries the buy
            affordance in its frame, the rest are ghosted and inert. */}
        {plotsOwned < MAX_PLOTS &&
          Array.from({ length: MAX_PLOTS - plotsOwned }).map((_, idx) => (
            <LockedParcel
              key={`locked-${idx}`}
              index={plotsOwned + idx}
              claimable={idx === 0}
              cost={nextPlotCost}
              onClaim={idx === 0 ? onBuyPlot : undefined}
            />
          ))}
      </div>

      {/* Defensive: settled buildings beyond the claimed plots' capacity. The
          chain should prevent this, but surface them rather than drop cards. */}
      {overflow.length > 0 && (
        <div className="rounded-lg border border-dashed border-danger/50 p-3">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-danger">
            Unplaced
          </h2>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {overflow.map((data) => (
              <button
                key={data.config.id}
                type="button"
                onClick={() => handleCardClick(data)}
                className="rounded-lg border border-border-default p-3 text-left text-sm font-semibold text-text-primary hover:border-border-gold/40"
              >
                {data.config.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
