"use client";

import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { playSfx } from "@/lib/audio/sfx";
import { useWebGL2Ready } from "@/lib/webgl/useWebGL2Ready";
import { DragGhost } from "../DragGhost";
import { useFx } from "../GameStage";
import { usePointerDrag } from "../usePointerDrag";
import { GameFooter, GameHeader, GameTimer, useFireOnce } from "./_shell";

/** Client-safe Ordering presentation (server `ordering` archetype). */
export interface OrderingPresentation {
  instruction: string;
  metricLabel: string;
  items: { label: string; metric: number }[];
}

interface OrderingGameProps {
  presentation: OrderingPresentation;
  submitting: boolean;
  onSubmit: (answer: number[]) => void;
}

// 6s per item — comparing adjacent items takes a beat longer than a bin tap.
const MS_PER_ITEM = 6_000;

/**
 * Ordering game UI. Drag a row by its grip to slot it into place (the list
 * reflows live under the pointer), or use the up/down chevrons. Submits the
 * final sequence, or the round-wide timer snap-submits the current arrangement.
 * The answer (a permutation of item indices) is unchanged, so server grading is
 * untouched.
 */
// 3D WebGL board (lazy); DOM board below is the no-WebGL fallback.
const OrderingGame3D = lazy(() => import("./OrderingGame3D"));

export function OrderingGame(props: OrderingGameProps) {
  if (useWebGL2Ready()) {
    return (
      <Suspense fallback={<OrderingGame2D {...props} />}>
        <OrderingGame3D {...props} />
      </Suspense>
    );
  }
  return <OrderingGame2D {...props} />;
}

function OrderingGame2D({ presentation, submitting, onSubmit }: OrderingGameProps) {
  const { instruction, metricLabel, items } = presentation;
  const fx = useFx();
  const [order, setOrder] = useState<number[]>(() => items.map((_, i) => i));
  const [moved, setMoved] = useState<number | null>(null);
  const moveTimeoutRef = useRef<number | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(
    () => () => {
      if (moveTimeoutRef.current !== null) clearTimeout(moveTimeoutRef.current);
    },
    [],
  );

  const flash = (pos: number) => {
    setMoved(pos);
    if (moveTimeoutRef.current !== null) clearTimeout(moveTimeoutRef.current);
    moveTimeoutRef.current = window.setTimeout(() => {
      setMoved(null);
      moveTimeoutRef.current = null;
    }, 250);
  };

  const move = (pos: number, dir: -1 | 1) => {
    const target = pos + dir;
    if (target < 0 || target >= order.length) return;
    setOrder((prev) => {
      const next = [...prev];
      const held = next[pos]!;
      next[pos] = next[target]!;
      next[target] = held;
      return next;
    });
    flash(target);
    playSfx("flip");
  };

  // Live drag-reorder: move the grabbed item to the slot under the pointer,
  // computed from each row's vertical midpoint.
  const reorderTo = (itemIdx: number, y: number) => {
    setOrder((prev) => {
      const from = prev.indexOf(itemIdx);
      if (from < 0) return prev;
      let target = prev.length - 1;
      for (let pos = 0; pos < prev.length; pos++) {
        const el = rowRefs.current[pos];
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (y < r.top + r.height / 2) {
          target = pos;
          break;
        }
      }
      if (target === from) return prev;
      const next = [...prev];
      next.splice(from, 1);
      next.splice(target, 0, itemIdx);
      return next;
    });
  };

  const { dragging, startDrag } = usePointerDrag({
    onMove: (itemIdx, _x, y) => reorderTo(itemIdx, y),
    onDrop: (itemIdx) => {
      playSfx("flip");
      const pos = order.indexOf(itemIdx);
      if (pos >= 0) fx.burstEl(rowRefs.current[pos], { count: 8 });
    },
  });

  const fireSubmit = useFireOnce(() => {
    playSfx("select");
    onSubmit(order);
  });

  const dragItem = dragging ? items[dragging.index] : null;

  return (
    <div className="space-y-3">
      <GameHeader current={items.length} total={items.length} noun="Slot" pips={false} />
      <GameTimer totalMs={MS_PER_ITEM * items.length} paused={submitting} onExpire={fireSubmit} />

      <p className="text-sm text-text-secondary">{instruction}</p>
      <div className="space-y-1.5">
        {order.map((itemIdx, pos) => {
          const it = items[itemIdx];
          if (!it) return null;
          const isMoved = moved === pos;
          const isDragging = dragging?.index === itemIdx;
          return (
            <div
              key={itemIdx}
              ref={(el) => {
                rowRefs.current[pos] = el;
              }}
              className={`card flex items-center justify-between gap-2 py-2 transition-all ${
                isMoved ? "border-border-gold/70 bg-accent/15" : ""
              } ${isDragging ? "opacity-40" : ""}`}
            >
              <div
                onPointerDown={(e) => startDrag(itemIdx, e)}
                style={{ touchAction: "none" }}
                className="flex flex-1 cursor-grab select-none items-center gap-2 active:cursor-grabbing"
              >
                <GripVertical size={14} className="shrink-0 text-text-muted/60" />
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-surface-overlay text-[11px] font-bold tabular-nums text-text-muted">
                  {pos + 1}
                </span>
                <span className="text-sm font-semibold text-text-primary">{it.label}</span>
                <span className="text-[11px] tabular-nums text-text-muted">
                  {metricLabel} {it.metric}
                </span>
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  disabled={submitting || pos === 0}
                  onClick={(e) => {
                    move(pos, -1);
                    fx.burstEl(e.currentTarget, { count: 6 });
                  }}
                  aria-label="Move up"
                  className="rounded border border-border-default px-2 py-1 text-text-secondary transition-colors hover:border-border-gold/50 disabled:opacity-30"
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  type="button"
                  disabled={submitting || pos === order.length - 1}
                  onClick={(e) => {
                    move(pos, 1);
                    fx.burstEl(e.currentTarget, { count: 6 });
                  }}
                  aria-label="Move down"
                  className="rounded border border-border-default px-2 py-1 text-text-secondary transition-colors hover:border-border-gold/50 disabled:opacity-30"
                >
                  <ChevronDown size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <DragGhost dragging={dragging} label={dragItem?.label ?? ""} />

      <GameFooter submitLabel="Submit order" submitting={submitting} onSubmit={fireSubmit} />
    </div>
  );
}
