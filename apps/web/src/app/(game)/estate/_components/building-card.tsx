"use client";

import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { CATEGORY_COLORS, type BuildingFeatureConfig } from "@/lib/config/building-features";
import { formatTime } from "@/lib/utils";
import { hasCenterView } from "./feature-view";
import type { BuildingPhase } from "@/lib/narrative";

export type BuildingStatus = "active" | "building" | "upgrading" | "unbuilt" | "locked";

export interface BuildingCardData {
  config: BuildingFeatureConfig;
  /** Lifecycle phase — the single source of truth (lib/narrative). */
  phase: BuildingPhase;
  status: BuildingStatus;
  level: number;
  constructing: boolean;
  remainingSec: number;
  ready: boolean;
  /** Lock reason — shown when the building can't be built yet */
  lockReason?: string;
  slot: any;
}

interface BuildingCardProps {
  data: BuildingCardData;
  selected: boolean;
  onClick: () => void;
  onSpeedup?: () => void;
  onComplete?: (reportPhase: (p: TxPhase) => void) => Promise<string>;
}

export function BuildingCard({
  data,
  selected,
  onClick,
  onSpeedup,
  onComplete,
}: BuildingCardProps) {
  const { config, phase, status, level, constructing, remainingSec, ready, lockReason } = data;
  const categoryColor = CATEGORY_COLORS[config.category];

  // Time display for constructing buildings
  const timeStr = formatTime(remainingSec, "compact");

  // Progress for constructing buildings
  const pct = data.slot
    ? (() => {
        const started = data.slot.constructionStarted?.toNumber?.() ?? 0;
        const ends = data.slot.constructionEnds?.toNumber?.() ?? 0;
        const total = ends - started;
        return total > 0
          ? Math.min(100, Math.round(((total - remainingSec) / total) * 100))
          : 0;
      })()
    : 0;

  // Locked state
  if (status === "locked") {
    return (
      <div className={`rounded-lg border-l-2 ${categoryColor} border border-zinc-800/50 p-3 opacity-40`}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-zinc-600">{config.name}</span>
          <span className="text-[10px] text-zinc-700">T{config.tier}</span>
        </div>
        <div className="text-[11px] text-zinc-700">{lockReason || config.desc}</div>
      </div>
    );
  }

  // Constructing state
  if (constructing) {
    return (
      <div
        className={`relative overflow-hidden rounded-lg border-l-2 ${categoryColor} border ${
          selected ? "border-amber-600 bg-amber-900/20" : "border-amber-700/60"
        } bg-surface-raised p-3 cursor-pointer`}
        onClick={onClick}
      >
        {/* Progress bar overlay */}
        <div
          className="absolute inset-y-0 left-0 bg-amber-900/20"
          style={{ width: `${pct}%` }}
        />
        <div className="relative">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-text-primary">{config.name}</span>
            <span className="rounded bg-surface-overlay px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-text-secondary">
              {status === "upgrading" ? `Lv ${level}` : "New"}
            </span>
          </div>
          <div className="text-xs text-amber-600 font-mono tabular-nums mt-1">
            {ready ? "Ready to complete" : `${timeStr} remaining (${pct}%)`}
          </div>
          {(phase === "improving" || phase === "improved") &&
            hasCenterView(config.id) && (
              <div className="mt-0.5 text-[10px] text-text-muted">
                {config.featureHint ?? "In use"} · still open
              </div>
            )}
          <div className="mt-2 flex gap-1" onClick={(e) => e.stopPropagation()}>
            {ready && onComplete ? (
              <TxButton
                onClick={(rp) => { rp("sending"); return onComplete(rp); }}
                className="px-3 py-1 text-[11px]"
              >
                Complete
              </TxButton>
            ) : onSpeedup ? (
              <button
                onClick={(e) => { e.stopPropagation(); onSpeedup(); }}
                className="rounded border border-amber-700/50 px-2 py-1 text-[11px] font-medium text-amber-600 hover:bg-amber-900/20"
              >
                Speed Up
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  // Active state
  if (status === "active") {
    return (
      <button
        onClick={onClick}
        className={`rounded-lg border-l-2 ${categoryColor} border p-3 text-left transition-colors ${
          selected
            ? "border-amber-600 bg-amber-900/20"
            : "border-border-default hover:border-amber-800/40"
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-text-primary">{config.name}</span>
          <span className="rounded bg-surface-overlay px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-text-secondary">
            Lv {level}
          </span>
        </div>
        {config.featureHint && (
          <div className="text-[11px] text-text-muted mt-0.5">{config.featureHint}</div>
        )}
        {data.slot?.totalNoviInvested && (
          <div className="mt-1 text-[11px] text-text-muted tabular-nums">
            {(data.slot.totalNoviInvested.toNumber?.() ?? 0).toLocaleString()} invested
          </div>
        )}
      </button>
    );
  }

  // Unbuilt state
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border-l-2 ${categoryColor} border border-dashed p-3 text-left transition-colors ${
        selected
          ? "border-amber-600 bg-amber-900/20"
          : "border-border-default opacity-60 hover:opacity-80 hover:border-border-default"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-text-primary">{config.name}</span>
        <span
          className={`text-[11px] font-bold ${
            config.tier === 3
              ? "text-amber-500"
              : config.tier === 2
                ? "text-text-gold"
                : "text-text-muted"
          }`}
        >
          T{config.tier}
        </span>
      </div>
      <div className="text-xs text-text-muted">{config.desc}</div>
      <div className="mt-1 text-[11px] font-semibold text-text-muted">
        {config.tier === 1 ? "1k" : config.tier === 2 ? "2k" : "3k"} NOVI
      </div>
    </button>
  );
}
