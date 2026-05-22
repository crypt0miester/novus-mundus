"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";

/**
 * Jump-ahead progress stepper — the UI for the paid "skip the early game"
 * action. A flat panel that sits in the Arrival like any other beat: no
 * floating-card chrome. Step state reads as a disc filling in (hollow ring →
 * spinner → filled disc) — no checkmarks, which the game's iconography
 * doesn't use; the tier accent replaces any generic green.
 *
 * Pure presentational component. The executor (`lib/jumpstart`) drives it.
 */

export type JumpStepStatus = "pending" | "active" | "done" | "failed";

export interface JumpStep {
  id: string;
  label: string;
  status: JumpStepStatus;
  /** Right-aligned meta — tx count, elapsed, or a short note. */
  detail?: string;
}

export type JumpPhase = "running" | "done" | "failed";

interface JumpAheadProps {
  /** Tier name shown as the header tag — e.g. "Veteran". */
  tierLabel: string;
  steps: JumpStep[];
  phase: JumpPhase;
  /** Total elapsed time, ms. */
  elapsedMs: number;
  /** Live log lines — tx signatures, confirmations. Optional. */
  log?: string[];
  /** Shown when `phase === "done"`. */
  onEnter?: () => void;
  /** Shown when `phase === "failed"`. */
  onRetry?: () => void;
}

const STATUS_WORD: Record<JumpPhase, string> = {
  running: "advancing…",
  done: "arrived",
  failed: "halted",
};

/** Step state marker — empty ring, spinner, filled disc, or fault ring. */
function StepMark({ status }: { status: JumpStepStatus }) {
  if (status === "done") {
    return (
      <span
        className="h-[18px] w-[18px] shrink-0 rounded-full bg-[var(--tier-accent)]"
        aria-label="done"
      />
    );
  }
  if (status === "active") {
    return (
      <span
        className="h-[18px] w-[18px] shrink-0 animate-spin rounded-full border-2 border-[color-mix(in_srgb,var(--tier-accent)_28%,transparent)] border-t-[var(--tier-accent-bright)]"
        aria-label="in progress"
      />
    );
  }
  if (status === "failed") {
    return (
      <span
        className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 border-red-500 text-[10px] font-bold text-red-500"
        aria-label="failed"
      >
        !
      </span>
    );
  }
  return (
    <span
      className="h-[18px] w-[18px] shrink-0 rounded-full border-2 border-border-default"
      aria-label="pending"
    />
  );
}

export function JumpAhead({
  tierLabel,
  steps,
  phase,
  elapsedMs,
  log,
  onEnter,
  onRetry,
}: JumpAheadProps) {
  const doneCount = useMemo(
    () => steps.filter((s) => s.status === "done").length,
    [steps],
  );
  const progressPct = steps.length ? (doneCount / steps.length) * 100 : 0;

  return (
    <div className="w-full max-w-md">
      {/* Header */}
      <div className="flex items-center justify-between pb-3">
        <div className="flex items-center gap-2">
          <span className="font-display text-sm font-bold tracking-wide lowercase text-text-primary">
            jump ahead
          </span>
          <span className="rounded-full bg-surface-raised px-2 py-0.5 text-[10px] font-medium lowercase tracking-wider text-text-muted">
            {tierLabel}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-xs font-medium lowercase",
              phase === "failed" ? "text-red-400" : "text-text-gold",
            )}
          >
            {STATUS_WORD[phase]}
          </span>
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              phase === "running" && "animate-pulse bg-[var(--tier-accent-bright)]",
              phase === "done" && "bg-[var(--tier-accent)]",
              phase === "failed" && "bg-red-500",
            )}
          />
        </div>
      </div>

      {/* Progress rail */}
      <div className="h-[3px] w-full rounded-full bg-[color-mix(in_srgb,var(--tier-accent)_18%,transparent)]">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500 ease-out",
            phase === "failed"
              ? "bg-red-500/70"
              : "bg-[var(--tier-accent-bright)]",
          )}
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Steps */}
      <div className="py-2">
        {steps.map((step) => (
          <div
            key={step.id}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors",
              step.status === "active" &&
                "bg-[color-mix(in_srgb,var(--tier-accent)_12%,transparent)]",
            )}
          >
            <StepMark status={step.status} />
            <span
              className={cn(
                "flex-1 text-sm lowercase",
                step.status === "pending" && "text-text-muted",
                step.status === "active" && "font-medium text-text-primary",
                step.status === "done" && "text-text-secondary",
                step.status === "failed" && "text-red-400",
              )}
            >
              {step.label}
            </span>
            <span className="font-mono text-[11px] tabular-nums text-text-muted">
              {step.detail ?? (step.status === "active" ? "···" : "·")}
            </span>
          </div>
        ))}
      </div>

      {/* Live log — terminal-style, optional */}
      {log && log.length > 0 && (
        <div className="mb-3 max-h-28 overflow-y-auto rounded-lg border border-border-default bg-surface-raised/60 px-3 py-2">
          {log.map((line, i) => (
            <div
              key={i}
              className="font-mono text-[10px] leading-relaxed text-text-muted"
            >
              {line}
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-border-default pt-3">
        <span className="font-mono text-xs tabular-nums text-text-muted">
          {(elapsedMs / 1000).toFixed(2)}s
        </span>
        {phase === "running" && (
          <span className="text-xs lowercase text-text-muted">
            {doneCount}/{steps.length} steps
          </span>
        )}
        {phase === "done" && onEnter && (
          <button
            type="button"
            onClick={onEnter}
            className="rounded-full bg-[var(--tier-accent)] px-4 py-1.5 text-xs font-bold lowercase text-[#1c1408] transition-opacity hover:opacity-90"
          >
            enter the realm
          </button>
        )}
        {phase === "failed" && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-full border border-[var(--tier-accent)] px-4 py-1.5 text-xs font-bold lowercase text-text-gold transition-colors hover:bg-surface-raised"
          >
            resume
          </button>
        )}
      </div>
    </div>
  );
}
