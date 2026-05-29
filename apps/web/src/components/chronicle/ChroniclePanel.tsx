"use client";

import { ChevronRight } from "lucide-react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useEstate } from "@/lib/hooks/useEstate";
import { useAct } from "@/lib/hooks/useAct";
import {
  ACTS,
  JOURNEY_BEATS,
  buildChronicleFacts,
  beatsDone,
  nextBeat,
  type Act,
} from "@/lib/narrative";
import { cn } from "@/lib/utils";

/**
 * The three chapters the climb passes through, in the Cairn's reckoning — the
 * six acts read coarsely against the land. Carried over from the old
 * ChapterBand, which this panel replaces.
 */
const CHAPTERS: Record<Act, { name: string; standing: string }> = {
  0: { name: "Foundation", standing: "The ground is yours. The holding has not begun." },
  1: { name: "Foundation", standing: "The first walls rise. This is where a holding is made." },
  2: { name: "Expansion", standing: "The road has noticed. The land reaches past one claim." },
  3: { name: "Expansion", standing: "A House at your back. The holding is a name now." },
  4: { name: "Mastery", standing: "The realm has learned to say it. The climb is steep here." },
  5: { name: "Mastery", standing: "A crown, and a court of your own. The land answered." },
};

/**
 * The Chronicle — the journey, tracked. Opened from the Cairn (the climb's
 * narrator) into the RightPanel. Current-act focus: the act underway shows its
 * beats in full; the acts behind and ahead fold to a single line each, so the
 * panel reads as "where I am" rather than a wall of every beat.
 */
export function ChroniclePanel() {
  const { data: playerData } = usePlayer();
  const { data: estateData } = useEstate();
  const { act, ownsCastle } = useAct();

  const facts = buildChronicleFacts(playerData?.account, estateData?.account, ownsCastle);
  const done = beatsDone(facts);
  const next = nextBeat(facts);
  const total = JOURNEY_BEATS.length;
  const doneCount = done.size;
  const chapter = CHAPTERS[Math.max(0, Math.min(5, act)) as Act];

  return (
    <div className="space-y-4">
      {/* Chapter — where the land stands on the climb */}
      <div>
        <div className="flex items-baseline gap-2">
          <span className="tier-title font-display text-base font-bold tracking-wide">
            {chapter.name}
          </span>
          <span className="font-mono text-[10px] tabular-nums text-text-muted">
            {doneCount}/{total}
          </span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-text-secondary">{chapter.standing}</p>
        <div className="mt-2 h-0.5 w-full overflow-hidden rounded-full bg-surface-overlay">
          <div
            className="h-full rounded-full"
            style={{
              width: `${(doneCount / total) * 100}%`,
              background: "linear-gradient(90deg, var(--nm-accent), var(--nm-accent-bright))",
              transition: "width 0.6s ease",
            }}
          />
        </div>
      </div>

      {/* The climb — the act underway in full, the rest folded to a line */}
      <div className="space-y-2 border-t border-border-default pt-3">
        {ACTS.map((a) => {
          const beats = JOURNEY_BEATS.filter((b) => b.act === a.id);
          if (beats.length === 0) return null;
          const doneInAct = beats.filter((b) => done.has(b.key)).length;

          // Acts behind and ahead fold to one muted line.
          if (a.id !== act) {
            const past = a.id < act;
            const allDone = doneInAct === beats.length;
            return (
              <div
                key={a.id}
                className={cn(
                  "flex items-baseline justify-between gap-2 text-xs",
                  !past && "opacity-50",
                )}
              >
                <span className="flex items-center gap-1.5 text-text-muted">
                  <span className="w-3 text-center">{past && allDone ? "✦" : "·"}</span>
                  <span>{a.name}</span>
                </span>
                <span className="font-mono text-[10px] tabular-nums text-text-muted">
                  {doneInAct}/{beats.length}
                </span>
              </div>
            );
          }

          // The current act — its beats in full, the next one framed.
          return (
            <div key={a.id}>
              <div className="flex items-baseline gap-2">
                <span className="tier-title font-display text-sm font-bold tracking-wide">
                  {a.name}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-text-muted">
                  Age of {a.age}
                </span>
              </div>
              <ul className="mt-1.5 space-y-1.5">
                {beats.map((b) => {
                  const isDone = done.has(b.key);
                  const isNext = next?.key === b.key;
                  return (
                    <li key={b.key} className="flex gap-2 text-xs">
                      <span
                        className={cn(
                          "inline-flex w-3 shrink-0 items-center justify-center",
                          isDone
                            ? "text-text-gold"
                            : isNext
                              ? "text-text-secondary"
                              : "text-text-muted",
                        )}
                      >
                        {isDone ? "✦" : isNext ? <ChevronRight className="h-3 w-3" /> : "·"}
                      </span>
                      <div className="min-w-0">
                        <div
                          className={cn(
                            isDone
                              ? "text-text-muted line-through"
                              : isNext
                                ? "text-text-primary"
                                : "text-text-muted",
                          )}
                        >
                          {b.label}
                        </div>
                        {isNext && (
                          <div className="mt-0.5 leading-relaxed text-text-secondary">
                            {b.framing}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
