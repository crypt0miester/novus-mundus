"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MoveResponse } from "@/lib/hooks/useDailyActivity";

/** Client-safe Reflex presentation (server `reflex` archetype). */
export interface ReflexPresentation {
  mode: "react" | "precision";
  rounds: number;
  instruction: string;
}

interface ReflexGameProps {
  presentation: ReflexPresentation;
  submitting: boolean;
  sendMove: (move: unknown) => Promise<MoveResponse>;
  onComplete: () => void;
}

type Phase = "intro" | "waiting" | "go" | "sweeping" | "result" | "done";

interface RoundResult {
  kind: "reaction" | "release";
  reactionMs?: number;
  markerPos?: number;
  fraction: number;
}

interface Sweep {
  startedAt: number;
  sweepMs: number;
  bandFrom: number;
  bandTo: number;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function reactionTag(ms: number): { label: string; tone: string } {
  if (ms <= 220) return { label: "⚡ Razor sharp", tone: "text-emerald-300" };
  if (ms <= 320) return { label: "Sharp", tone: "text-amber-300" };
  if (ms <= 470) return { label: "Steady", tone: "text-amber-400" };
  return { label: "Slow off the mark", tone: "text-zinc-400" };
}

function precisionTag(fraction: number): { label: string; tone: string } {
  if (fraction >= 0.95) return { label: "⚒ Optimal heat", tone: "text-emerald-300" };
  if (fraction >= 0.6) return { label: "Close", tone: "text-amber-300" };
  if (fraction >= 0.25) return { label: "Off the mark", tone: "text-amber-400" };
  return { label: "Furnace cold", tone: "text-zinc-400" };
}

/**
 * Reflex game UI — the twitch archetype. `react` is a hold-then-strike panel;
 * `precision` is a sweeping furnace gauge. The server holds the GO signal and
 * stamps every instant on its own clock; this component only renders state and
 * fires `round-start` / `arm` / `tap` | `release`.
 */
export function ReflexGame({
  presentation,
  submitting,
  sendMove,
  onComplete,
}: ReflexGameProps) {
  const { mode, rounds, instruction } = presentation;

  const [phase, setPhase] = useState<Phase>("intro");
  const [round, setRound] = useState(1); // 1-based, for display
  const [result, setResult] = useState<RoundResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reactionMs, setReactionMs] = useState(0); // live counter while GO shows
  const [markerPos, setMarkerPos] = useState(0); // 0-1 during the sweep
  const [sweep, setSweep] = useState<Sweep | null>(null);

  const startedRef = useRef(false);
  const actingRef = useRef(false);
  const goAtRef = useRef(0);
  const phaseRef = useRef<Phase>("intro");
  phaseRef.current = phase;

  // One round: a ready beat, round-start, then arm (held for react).
  const runRound = useCallback(async () => {
    try {
      setResult(null);
      setReactionMs(0);
      setMarkerPos(0);
      setSweep(null);
      setPhase("intro");
      await wait(850);

      const rs = await sendMove({ kind: "round-start" });
      const token = (rs.result as { token?: string }).token;

      if (mode === "react") {
        setPhase("waiting");
        await sendMove({ kind: "arm", token }); // held open — resolves at GO
        goAtRef.current = performance.now();
        setPhase("go");
      } else {
        const armed = await sendMove({ kind: "arm", token });
        const s = armed.result as {
          sweepMs: number;
          bandFrom: number;
          bandTo: number;
        };
        setSweep({ startedAt: performance.now(), ...s });
        setPhase("sweeping");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "the drill was interrupted");
    }
  }, [mode, sendMove]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void runRound();
  }, [runRound]);

  // Tap (react) / release (precision).
  const act = useCallback(async () => {
    if (actingRef.current) return;
    const p = phaseRef.current;
    if (mode === "react" && p !== "go") return;
    if (mode === "precision" && p !== "sweeping") return;
    actingRef.current = true;
    try {
      const res = await sendMove({
        kind: mode === "react" ? "tap" : "release",
      });
      setResult(res.result as RoundResult);
      setPhase("result");
      await wait(1500);
      if (res.done) {
        setPhase("done");
        onComplete();
      } else {
        setRound((n) => n + 1);
        actingRef.current = false;
        void runRound();
        return;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "the drill was interrupted");
    }
    actingRef.current = false;
  }, [mode, sendMove, onComplete, runRound]);

  // Live reaction counter while GO is showing.
  useEffect(() => {
    if (phase !== "go") return;
    let raf = 0;
    const loop = () => {
      setReactionMs(performance.now() - goAtRef.current);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  // The sweep — auto-releases if the marker runs off the end.
  useEffect(() => {
    if (phase !== "sweeping" || !sweep) return;
    let raf = 0;
    const loop = () => {
      const pos = Math.min(1, (performance.now() - sweep.startedAt) / sweep.sweepMs);
      setMarkerPos(pos);
      if (pos >= 1) {
        void act();
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [phase, sweep, act]);

  // Spacebar / Enter to act — desktop twitch feel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        void act();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [act]);

  if (error) {
    return (
      <div className="card text-center text-sm text-red-400">
        {error} — close this and try again.
      </div>
    );
  }

  const completed = phase === "done" ? rounds : round - 1;

  return (
    <div className="space-y-3">
      {/* Round tracker */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-text-muted">
          Round {Math.min(round, rounds)} / {rounds}
        </span>
        <div className="flex gap-1.5">
          {Array.from({ length: rounds }, (_, i) => (
            <span
              key={i}
              className={`h-2 w-2 rounded-full ${
                i < completed
                  ? "bg-amber-400"
                  : i === completed
                    ? "bg-amber-400/40 ring-1 ring-amber-400"
                    : "bg-border-default"
              }`}
            />
          ))}
        </div>
      </div>
      <p className="text-xs text-text-muted">{instruction}</p>

      {mode === "react" ? (
        <ReactArena
          phase={phase}
          round={round}
          liveMs={reactionMs}
          result={result}
          disabled={submitting}
          onTap={() => void act()}
        />
      ) : (
        <PrecisionArena
          phase={phase}
          round={round}
          sweep={sweep}
          markerPos={markerPos}
          result={result}
          disabled={submitting}
          onRelease={() => void act()}
        />
      )}

      <p className="text-center text-[11px] text-text-muted">
        tap the panel or press Space
      </p>
    </div>
  );
}

function ReactArena({
  phase,
  round,
  liveMs,
  result,
  disabled,
  onTap,
}: {
  phase: Phase;
  round: number;
  liveMs: number;
  result: RoundResult | null;
  disabled: boolean;
  onTap: () => void;
}) {
  const tag = reactionTag(result?.reactionMs ?? 999);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onTap}
      className={`flex min-h-[220px] w-full select-none flex-col items-center justify-center rounded-2xl border-2 transition-transform duration-100 ${
        phase === "go"
          ? "scale-[1.015] border-emerald-300 bg-emerald-500 text-emerald-950"
          : "border-border-default bg-surface-raised"
      }`}
    >
      {phase === "intro" && (
        <span className="font-display text-xl font-bold text-text-muted">
          Round {round}
        </span>
      )}
      {phase === "waiting" && (
        <>
          <span className="animate-pulse font-display text-3xl font-bold tracking-[0.3em] text-amber-500/80">
            STEADY
          </span>
          <span className="mt-2 text-xs text-text-muted">
            hold — do not strike yet
          </span>
        </>
      )}
      {phase === "go" && (
        <>
          <span className="font-display text-7xl font-black tracking-wider">
            GO
          </span>
          <span className="mt-1 font-mono text-base tabular-nums opacity-80">
            {Math.round(liveMs)} ms
          </span>
        </>
      )}
      {phase === "result" && result?.kind === "reaction" && (
        <>
          <span className="font-display text-6xl font-black tabular-nums text-text-gold">
            {result.reactionMs}
            <span className="ml-1 text-2xl text-text-muted">ms</span>
          </span>
          <span className={`mt-2 text-sm font-semibold ${tag.tone}`}>
            {tag.label}
          </span>
        </>
      )}
      {phase === "done" && (
        <span className="font-display text-xl font-bold text-text-muted">
          Drill complete
        </span>
      )}
    </button>
  );
}

function PrecisionArena({
  phase,
  round,
  sweep,
  markerPos,
  result,
  disabled,
  onRelease,
}: {
  phase: Phase;
  round: number;
  sweep: Sweep | null;
  markerPos: number;
  result: RoundResult | null;
  disabled: boolean;
  onRelease: () => void;
}) {
  const displayPos =
    phase === "result" ? (result?.markerPos ?? markerPos) : markerPos;
  const inBand =
    !!sweep && markerPos >= sweep.bandFrom && markerPos <= sweep.bandTo;
  const tag = precisionTag(result?.fraction ?? 0);

  return (
    <div className="space-y-3">
      <div className="flex min-h-[220px] flex-col justify-center rounded-2xl border-2 border-border-default bg-surface-raised p-5">
        {phase === "intro" && (
          <p className="text-center font-display text-xl font-bold text-text-muted">
            Round {round} — stoking the furnace
          </p>
        )}
        {(phase === "sweeping" || phase === "result") && (
          <>
            <div className="relative h-20 w-full overflow-hidden rounded-xl bg-zinc-900">
              {/* heat fill up to the marker */}
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-orange-900 via-orange-600 to-amber-300"
                style={{ width: `${displayPos * 100}%` }}
              />
              {/* optimal-heat band */}
              {sweep && (
                <div
                  className="absolute inset-y-0 border-x-2 border-amber-200/80 bg-amber-200/15"
                  style={{
                    left: `${sweep.bandFrom * 100}%`,
                    width: `${(sweep.bandTo - sweep.bandFrom) * 100}%`,
                  }}
                />
              )}
              {/* marker at the heat edge */}
              <div
                className="absolute inset-y-0 w-1 -translate-x-1/2 bg-white shadow-[0_0_14px_3px_rgba(255,220,150,0.9)]"
                style={{ left: `${displayPos * 100}%` }}
              />
            </div>
            {phase === "result" && (
              <p className={`mt-3 text-center text-sm font-semibold ${tag.tone}`}>
                {tag.label}
              </p>
            )}
          </>
        )}
        {phase === "done" && (
          <p className="text-center font-display text-xl font-bold text-text-muted">
            Furnace fired
          </p>
        )}
      </div>

      <button
        type="button"
        disabled={disabled || phase !== "sweeping"}
        onClick={onRelease}
        className={`w-full select-none rounded-xl border-2 py-4 font-display text-lg font-bold tracking-wider transition-colors ${
          phase === "sweeping"
            ? inBand
              ? "border-emerald-300 bg-emerald-500/90 text-emerald-950"
              : "border-amber-500 bg-amber-900/30 text-text-gold"
            : "border-border-default text-text-muted"
        }`}
      >
        {phase === "sweeping" ? (inBand ? "RELEASE — NOW" : "RELEASE") : "FIRE"}
      </button>
    </div>
  );
}
