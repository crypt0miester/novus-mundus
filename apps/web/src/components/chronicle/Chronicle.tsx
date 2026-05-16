"use client";

import { useState } from "react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useEstate } from "@/lib/hooks/useEstate";
import { useAct } from "@/lib/hooks/useAct";
import {
  ACTS,
  JOURNEY_BEATS,
  buildChronicleFacts,
  beatsDone,
  nextBeat,
} from "@/lib/narrative";
import { cn } from "@/lib/utils";

/**
 * The Chronicle — the journey, tracked. The Cairn's account of the climb: the
 * current act, the next beat framed in the Cairn's voice, and the journey so
 * far. Replaces the old quest checklist. PLAYER_JOURNEY_GAMEPLAN.md §7.4.
 */
export function Chronicle() {
  const { data: playerData } = usePlayer();
  const { data: estateData } = useEstate();
  const { act, ownsCastle } = useAct();
  const [open, setOpen] = useState(false);

  const facts = buildChronicleFacts(
    playerData?.account,
    estateData?.account,
    ownsCastle,
  );
  const done = beatsDone(facts);
  const next = nextBeat(facts);

  const total = JOURNEY_BEATS.length;
  const doneCount = done.size;

  return (
    <div className="card">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
              The Chronicle
            </span>
            <span className="font-mono text-[10px] tabular-nums text-text-muted">
              {doneCount}/{total}
            </span>
          </div>
          {next ? (
            <>
              <p className="mt-1 text-sm font-semibold text-text-primary">
                {next.label}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">
                {next.framing}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-text-secondary">
              The climb is yours. The road goes on.
            </p>
          )}
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 rounded-md border border-border-default px-2.5 py-1 text-xs text-text-muted transition-colors hover:border-border-gold hover:text-text-gold"
        >
          {open ? "Less" : "The climb"}
        </button>
      </div>

      <div className="mt-2.5 h-0.5 w-full overflow-hidden rounded-full bg-surface-overlay">
        <div
          className="h-full rounded-full"
          style={{
            width: `${(doneCount / total) * 100}%`,
            background:
              "linear-gradient(90deg, var(--nm-accent), var(--nm-accent-bright))",
            transition: "width 0.6s ease",
          }}
        />
      </div>

      {open && (
        <div className="mt-3 space-y-3 border-t border-border-default pt-3">
          {ACTS.map((a) => {
            const beats = JOURNEY_BEATS.filter((b) => b.act === a.id);
            if (beats.length === 0) return null;
            const isCurrent = a.id === act;
            return (
              <div key={a.id}>
                <div className="flex items-baseline gap-2">
                  <span
                    className={cn(
                      "font-display text-sm font-bold tracking-wide",
                      isCurrent ? "tier-title" : "text-text-muted",
                    )}
                  >
                    {a.name}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-text-muted">
                    Age of {a.age}
                  </span>
                </div>
                <ul className="mt-1 space-y-1">
                  {beats.map((b) => {
                    const isDone = done.has(b.key);
                    const isNext = next?.key === b.key;
                    return (
                      <li
                        key={b.key}
                        className="flex items-center gap-2 text-xs"
                      >
                        <span
                          className={cn(
                            "w-3 text-center",
                            isDone
                              ? "text-text-gold"
                              : isNext
                                ? "text-text-secondary"
                                : "text-text-muted",
                          )}
                        >
                          {isDone ? "✦" : isNext ? "→" : "·"}
                        </span>
                        <span
                          className={cn(
                            isDone
                              ? "text-text-muted line-through"
                              : isNext
                                ? "text-text-primary"
                                : "text-text-muted",
                          )}
                        >
                          {b.label}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
