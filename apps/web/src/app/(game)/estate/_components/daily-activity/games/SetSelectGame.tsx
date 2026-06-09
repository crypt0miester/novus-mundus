"use client";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { playSfx } from "@/lib/audio/sfx";
import { useWebGL2Ready } from "@/lib/webgl/useWebGL2Ready";
import { useFx } from "../GameStage";
import { GameFooter, GameHeader, GameTimer, useFireOnce, useIndexedSelection } from "./_shell";

/** Client-safe SetSelect presentation (server `set-select` archetype). */
export interface SetSelectPresentation {
  instruction: string;
  aLabel: string;
  bLabel: string;
  items: { label: string; a: number; b: number }[];
}

interface SetSelectGameProps {
  presentation: SetSelectPresentation;
  submitting: boolean;
  onSubmit: (answer: boolean[]) => void;
}

// 3s per item — binary tap, fastest of the single-shot archetypes.
const MS_PER_ITEM = 3_000;
// Flags within this window of each other build a cosmetic streak.
const COMBO_WINDOW_MS = 1_200;

/**
 * SetSelect game UI. Tap the items that satisfy the rule — they lift into the
 * "kept" state with a burst, and rapid consecutive flags build a cosmetic
 * streak (flair only; it does not affect the score). Submits once, or the
 * round-wide timer snap-submits. The answer (a boolean per item) is unchanged,
 * so server grading is untouched.
 */
// 3D WebGL board (lazy); DOM board below is the no-WebGL fallback.
const SetSelectGame3D = lazy(() => import("./SetSelectGame3D"));

export function SetSelectGame(props: SetSelectGameProps) {
  if (useWebGL2Ready()) {
    return (
      <Suspense fallback={<SetSelectGame2D {...props} />}>
        <SetSelectGame3D {...props} />
      </Suspense>
    );
  }
  return <SetSelectGame2D {...props} />;
}

function SetSelectGame2D({ presentation, submitting, onSubmit }: SetSelectGameProps) {
  const { instruction, aLabel, bLabel, items } = presentation;
  const fx = useFx();
  const [selected, setSelectedAt] = useIndexedSelection<boolean>(() => items.map(() => false));
  const [combo, setCombo] = useState(0);
  const comboTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (comboTimerRef.current !== null) clearTimeout(comboTimerRef.current);
    },
    [],
  );

  const flagged = selected.filter(Boolean).length;

  const fireSubmit = useFireOnce(() => {
    playSfx("select");
    onSubmit(items.map((_, i) => selected[i] ?? false));
  });

  const toggle = (i: number, on: boolean, el: Element) => {
    const next = !on;
    setSelectedAt(i, next);
    if (!next) {
      playSfx("flip");
      return;
    }
    playSfx("select");
    fx.burstEl(el, { count: 8 });
    // Cosmetic streak: each flag climbs the combo; an idle gap of COMBO_WINDOW_MS
    // (the timer below) resets it.
    setCombo((c) => {
      const nc = c + 1;
      if (nc >= 2) playSfx("combo", nc);
      return nc;
    });
    if (comboTimerRef.current !== null) clearTimeout(comboTimerRef.current);
    comboTimerRef.current = window.setTimeout(() => {
      setCombo(0);
      comboTimerRef.current = null;
    }, COMBO_WINDOW_MS);
  };

  return (
    <div className="space-y-3">
      <GameHeader
        current={flagged}
        total={items.length}
        noun="Item"
        pips={false}
        trailing={
          <span className="flex items-center gap-2">
            {combo >= 2 && (
              <span className="rounded bg-accent/40 px-1.5 py-0.5 text-[10px] font-bold text-text-gold">
                Streak x{combo}
              </span>
            )}
            <span className="font-mono text-[10px] tabular-nums text-text-muted">
              {flagged} flagged
            </span>
          </span>
        }
      />
      <GameTimer totalMs={MS_PER_ITEM * items.length} paused={submitting} onExpire={fireSubmit} />

      <p className="text-sm text-text-secondary">{instruction}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((it, i) => {
          const on = selected[i] ?? false;
          return (
            <button
              key={i}
              type="button"
              disabled={submitting}
              onClick={(e) => toggle(i, on, e.currentTarget)}
              className={`card flex items-center justify-between gap-2 text-left transition-all ${
                on
                  ? "-translate-y-1 scale-[1.02] border-border-gold bg-accent/20 shadow-[0_0_10px_-3px_rgba(220,180,90,0.5)]"
                  : "hover:border-border-gold/50"
              }`}
            >
              <div>
                <div className="text-sm font-semibold text-text-primary">{it.label}</div>
                <div className="text-[11px] tabular-nums text-text-muted">
                  {aLabel} {it.a} · {bLabel} {it.b}
                </div>
              </div>
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs ${
                  on
                    ? "border-border-gold-bright bg-gold-500/30 text-text-gold"
                    : "border-border-default"
                }`}
              >
                {on ? "✓" : ""}
              </span>
            </button>
          );
        })}
      </div>
      <GameFooter submitLabel="Submit" submitting={submitting} onSubmit={fireSubmit} />
    </div>
  );
}
