"use client";

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { cn } from "@/lib/utils";

/**
 * Jump-ahead progress stepper — the UI for the paid "skip the early game"
 * action. A flat panel that sits in the Arrival like any other beat: no
 * floating-card chrome. Step state reads as a disc filling in (hollow ring to
 * spinner to filled disc) — no checkmarks, which the game's iconography
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
  /** Consecutive steps sharing a group key fold into one collapsible row
   *  (e.g. the 8 "build the …" steps become one "build the estate" row). */
  group?: string;
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
  /** Live wallet SOL balance (lamports) — surfaced beside the retry control
   *  so the player sees an airdrop landing without having to retry first. */
  walletSol?: number | null;
  /** Manual balance refetch — paired with the live readout above. */
  onRefetchBalance?: () => void;
}

const STATUS_WORD: Record<JumpPhase, string> = {
  running: "advancing…",
  done: "arrived",
  failed: "halted",
};

/** Display label for a folded step group, keyed by JumpStep.group. */
const GROUP_LABELS: Record<string, string> = {
  build: "build the estate",
  research: "research battle doctrine",
};

/** Leading verb phrases stripped off a child's label in the expanded grid. */
const CHILD_LABEL_PREFIX = /^(build the |research )/i;

/** A rendered line: either a lone step or a fold of consecutive same-group steps. */
type Row =
  | { kind: "single"; step: JumpStep }
  | {
      kind: "group";
      key: string;
      label: string;
      status: JumpStepStatus;
      done: number;
      total: number;
      children: JumpStep[];
    };

/** failed > active > done(all) > pending: the group reads as its worst/busiest child. */
function groupStatus(children: JumpStep[]): JumpStepStatus {
  if (children.some((c) => c.status === "failed")) return "failed";
  if (children.some((c) => c.status === "active")) return "active";
  if (children.every((c) => c.status === "done")) return "done";
  return "pending";
}

/** Collapse runs of consecutive steps that share a `group` key into one Row. */
function foldSteps(steps: JumpStep[]): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (!s.group) {
      rows.push({ kind: "single", step: s });
      continue;
    }
    const children: JumpStep[] = [s];
    while (i + 1 < steps.length && steps[i + 1].group === s.group) {
      children.push(steps[++i]);
    }
    rows.push({
      kind: "group",
      key: s.group,
      label: GROUP_LABELS[s.group] ?? s.group,
      status: groupStatus(children),
      done: children.filter((c) => c.status === "done").length,
      total: children.length,
      children,
    });
  }
  return rows;
}

/** Step state marker — empty ring, spinner, filled disc, or fault ring. */
function StepMark({ status, size = 18 }: { status: JumpStepStatus; size?: number }) {
  const style = { height: size, width: size };
  if (status === "done") {
    return (
      <span
        style={style}
        className="shrink-0 rounded-full bg-[var(--tier-accent)]"
        aria-label="done"
      />
    );
  }
  if (status === "active") {
    return (
      <span
        style={style}
        className="shrink-0 animate-spin rounded-full border-2 border-[color-mix(in_srgb,var(--tier-accent)_28%,transparent)] border-t-[var(--tier-accent-bright)]"
        aria-label="in progress"
      />
    );
  }
  if (status === "failed") {
    return (
      <span
        style={style}
        className="flex shrink-0 items-center justify-center rounded-full border-2 border-red-500 text-[10px] font-bold text-red-500"
        aria-label="failed"
      >
        !
      </span>
    );
  }
  return (
    <span
      style={style}
      className="shrink-0 rounded-full border-2 border-border-default"
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
  walletSol,
  onRefetchBalance,
}: JumpAheadProps) {
  const rows = useMemo(() => foldSteps(steps), [steps]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const doneCount = rows.filter((r) =>
    r.kind === "single" ? r.step.status === "done" : r.status === "done",
  ).length;
  // Rail advances per finished child, so a multi-tx group doesn't freeze it.
  const progressPct = rows.length
    ? (rows.reduce(
        (a, r) =>
          a + (r.kind === "single" ? (r.step.status === "done" ? 1 : 0) : r.done / r.total),
        0,
      ) /
        rows.length) *
      100
    : 0;

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
            phase === "failed" ? "bg-red-500/70" : "bg-[var(--tier-accent-bright)]",
          )}
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Steps */}
      <div className="py-2">
        {rows.map((row) => {
          if (row.kind === "single") {
            const step = row.step;
            return (
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
            );
          }

          // Folded group: one collapsible row (e.g. the 8 buildings).
          const isOpen = expanded[row.key] ?? false;
          return (
            <div key={row.key}>
              <button
                type="button"
                onClick={() => setExpanded((e) => ({ ...e, [row.key]: !isOpen }))}
                aria-expanded={isOpen}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-surface-raised/50",
                  row.status === "active" &&
                    "bg-[color-mix(in_srgb,var(--tier-accent)_12%,transparent)]",
                )}
              >
                <StepMark status={row.status} />
                <span
                  className={cn(
                    "flex flex-1 items-center gap-1.5 text-sm lowercase",
                    row.status === "pending" && "text-text-muted",
                    row.status === "active" && "font-medium text-text-primary",
                    row.status === "done" && "text-text-secondary",
                    row.status === "failed" && "text-red-400",
                  )}
                >
                  {row.label}
                  <ChevronRight
                    className={cn(
                      "h-3.5 w-3.5 text-text-muted transition-transform",
                      isOpen && "rotate-90",
                    )}
                  />
                </span>
                <span className="font-mono text-[11px] tabular-nums text-text-muted">
                  {row.done}/{row.total}
                </span>
              </button>

              {isOpen && (
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 pb-2 pl-8 pr-3 pt-1">
                  {row.children.map((c) => (
                    <div key={c.id} className="flex items-center gap-2">
                      <StepMark status={c.status} size={12} />
                      <span
                        className={cn(
                          "truncate text-xs lowercase",
                          c.status === "pending" && "text-text-muted",
                          c.status === "active" && "text-text-primary",
                          c.status === "done" && "text-text-secondary",
                          c.status === "failed" && "text-red-400",
                        )}
                      >
                        {c.label.replace(CHILD_LABEL_PREFIX, "")}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Live log — terminal-style, optional */}
      {log && log.length > 0 && (
        <div className="mb-3 max-h-28 overflow-y-auto rounded-lg border border-border-default bg-surface-raised/60 px-3 py-2">
          {log.map((line, i) => (
            <div key={i} className="font-mono text-[10px] leading-relaxed text-text-muted">
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
            {doneCount}/{rows.length} steps
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
        {phase === "failed" && (
          <div className="flex items-center gap-2">
            {walletSol != null && (
              <span className="font-mono text-xs tabular-nums text-text-muted">
                {(walletSol / LAMPORTS_PER_SOL).toFixed(2)} SOL
              </span>
            )}
            {onRefetchBalance && (
              <button
                type="button"
                onClick={onRefetchBalance}
                className="rounded-full border border-border-default px-2.5 py-1 text-xs lowercase text-text-muted transition-colors hover:bg-surface-raised hover:text-text-secondary"
                aria-label="Refresh balance"
              >
                refresh
              </button>
            )}
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="rounded-full border border-[var(--tier-accent)] px-4 py-1.5 text-xs font-bold lowercase text-text-gold transition-colors hover:bg-surface-raised"
              >
                resume
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
