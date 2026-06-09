"use client";

import { BuildingType } from "novus-mundus-sdk";
import { lazy, Suspense, useRef } from "react";
import { playSfx } from "@/lib/audio/sfx";
import { useWebGL2Ready } from "@/lib/webgl/useWebGL2Ready";
import { DragGhost } from "../DragGhost";
import { useFx } from "../GameStage";
import { usePointerDrag } from "../usePointerDrag";
import { GameFooter, GameHeader, GameTimer, useFireOnce, useIndexedSelection } from "./_shell";

/** Client-safe Assignment presentation (server `assignment` archetype). */
export interface AssignmentPresentation {
  instruction: string;
  valueLabel: string;
  bins: { label: string; from: number; to: number }[];
  items: { label: string; value: number }[];
}

interface AssignmentGameProps {
  presentation: AssignmentPresentation;
  submitting: boolean;
  building: number;
  onSubmit: (answer: number[]) => void;
}

// 4s per item — enough to read the value, glance at the bins, and place.
const MS_PER_ITEM = 4_000;

/**
 * Assignment game UI. Drag each item onto the bin it belongs in (the bin lights
 * up under the pointer), or tap a bin chip on the row — both place the item.
 * Submits once every item is sorted, or the round-wide timer snap-submits with
 * unsorted items as -1. The answer (a bin index per item) is unchanged from the
 * old tap-only version, so server grading is untouched.
 */
// 3D WebGL boards (lazy); DOM board below is the no-WebGL fallback. Workshop
// gets a fully bespoke themed game (Scrap Sorting); other assignment buildings
// use the generic board until they get their own theme.
const AssignmentGame3D = lazy(() => import("./AssignmentGame3D"));
const ScrapSortingGame3D = lazy(() => import("./ScrapSortingGame3D"));

export function AssignmentGame({ building, ...rest }: AssignmentGameProps) {
  if (useWebGL2Ready()) {
    const fallback = <AssignmentGame2D building={building} {...rest} />;
    return (
      <Suspense fallback={fallback}>
        {building === BuildingType.Workshop ? (
          <ScrapSortingGame3D {...rest} />
        ) : (
          <AssignmentGame3D {...rest} />
        )}
      </Suspense>
    );
  }
  return <AssignmentGame2D building={building} {...rest} />;
}

function AssignmentGame2D({ presentation, submitting, onSubmit }: AssignmentGameProps) {
  const { instruction, valueLabel, bins, items } = presentation;
  const fx = useFx();
  const [assigned, setAssignedAt] = useIndexedSelection<number | null>(() => items.map(() => null));
  const binRefs = useRef<(HTMLDivElement | null)[]>([]);

  const sorted = assigned.filter((a) => a !== null).length;
  const allSorted = sorted === items.length;

  const fireSubmit = useFireOnce(() => {
    playSfx("select");
    onSubmit(assigned.map((a) => a ?? -1));
  });

  const place = (itemIdx: number, binIdx: number, burstFrom?: Element | null) => {
    setAssignedAt(itemIdx, binIdx);
    playSfx("select");
    fx.burstEl(burstFrom ?? binRefs.current[binIdx], { count: 10 });
  };

  const { dragging, startDrag } = usePointerDrag({
    onDrop: (index, x, y) => {
      const hit = binRefs.current.findIndex((el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      });
      if (hit >= 0) place(index, hit);
    },
  });

  return (
    <div className="space-y-3">
      <GameHeader current={Math.min(sorted + 1, items.length)} total={items.length} noun="Sort" />
      <GameTimer totalMs={MS_PER_ITEM * items.length} paused={submitting} onExpire={fireSubmit} />

      <p className="text-sm text-text-secondary">{instruction}</p>

      {/* Bin drop zones — highlight while a drag is in flight. */}
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${bins.length}, minmax(0, 1fr))` }}>
        {bins.map((b, bi) => (
          <div
            key={bi}
            ref={(el) => {
              binRefs.current[bi] = el;
            }}
            className={`rounded-lg border p-2 text-center transition-colors ${
              dragging ? "border-border-gold/70 bg-accent/15" : "border-border-default bg-surface-raised"
            }`}
          >
            <div className="text-xs font-semibold text-text-secondary">{b.label}</div>
            <div className="text-[10px] tabular-nums text-text-muted">
              {b.from}–{b.to}
            </div>
          </div>
        ))}
      </div>

      {/* Items: grab the label to drag, or tap a bin chip. */}
      <div className="space-y-2">
        {items.map((it, i) => {
          const a = assigned[i];
          const isDragging = dragging?.index === i;
          return (
            <div
              key={i}
              className={`card flex flex-wrap items-center justify-between gap-2 transition-opacity ${
                isDragging ? "opacity-40" : ""
              }`}
            >
              <div
                onPointerDown={(e) => startDrag(i, e)}
                style={{ touchAction: "none" }}
                className="flex flex-1 cursor-grab select-none items-center active:cursor-grabbing"
              >
                <span className="text-sm font-semibold text-text-primary">{it.label}</span>
                <span className="ml-2 text-[11px] tabular-nums text-text-muted">
                  {valueLabel} {it.value}
                </span>
                {a !== null && (
                  <span className="ml-2 rounded bg-accent/30 px-1.5 py-0.5 text-[10px] font-semibold text-text-gold">
                    {bins[a]?.label}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {bins.map((b, bi) => (
                  <button
                    key={bi}
                    type="button"
                    disabled={submitting}
                    onClick={(e) => place(i, bi, e.currentTarget)}
                    className={`rounded-lg border px-3 py-1 text-xs font-medium transition-all ${
                      a === bi
                        ? "scale-105 border-border-gold bg-accent/30 text-text-gold shadow-[0_0_10px_-3px_rgba(220,180,90,0.55)]"
                        : "border-border-default text-text-secondary hover:border-border-gold/50"
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <DragGhost dragging={dragging} label={dragging ? (items[dragging.index]?.label ?? "") : ""} />

      <GameFooter
        progress={{ done: sorted, total: items.length, noun: "sorted" }}
        submitLabel={allSorted ? "Submit roll" : "Submit"}
        submitting={submitting}
        disabled={false}
        onSubmit={fireSubmit}
      />
    </div>
  );
}
