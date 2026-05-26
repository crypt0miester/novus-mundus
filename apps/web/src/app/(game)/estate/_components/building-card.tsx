"use client";

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
}

export function BuildingCard({ data, selected, onClick }: BuildingCardProps) {
  const { config, phase, status, level, constructing, remainingSec, ready, lockReason } = data;
  const categoryColor = CATEGORY_COLORS[config.category];
  const eyebrow = (
    <span
      className={`shrink-0 text-[9px] font-medium uppercase tracking-[0.18em] ${categoryColor} opacity-70`}
    >
      {config.category}
    </span>
  );

  // Time display for constructing buildings
  const timeStr = formatTime(remainingSec, "compact");

  // Progress for constructing buildings
  const pct = data.slot
    ? (() => {
        const started = data.slot.constructionStarted?.toNumber?.() ?? 0;
        const ends = data.slot.constructionEnds?.toNumber?.() ?? 0;
        const total = ends - started;
        return total > 0 ? Math.min(100, Math.round(((total - remainingSec) / total) * 100)) : 0;
      })()
    : 0;

  // Locked state
  if (status === "locked") {
    return (
      <div className="rounded-lg border border-zinc-800/50 p-3 opacity-40">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-zinc-600">{config.name}</span>
          <span className="text-[10px] text-zinc-700">T{config.tier}</span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] text-zinc-700">{lockReason || config.desc}</span>
          {eyebrow}
        </div>
      </div>
    );
  }

  // Constructing state
  if (constructing) {
    return (
      <div
        className={`relative overflow-hidden rounded-lg border ${
          selected ? "border-border-gold bg-accent/20" : "border-border-gold/60"
        } bg-surface-raised p-3 cursor-pointer`}
        onClick={onClick}
      >
        {/* Progress bar overlay */}
        <div className="absolute inset-y-0 left-0 bg-accent/20" style={{ width: `${pct}%` }} />
        <div className="relative">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-text-primary">{config.name}</span>
            <span className="rounded bg-surface-overlay px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-text-secondary">
              {status === "upgrading" ? `Lv ${level}` : "New"}
            </span>
          </div>
          <div className="text-xs text-text-gold font-mono tabular-nums mt-1">
            {ready ? "Ready!" : `${timeStr} remaining (${pct}%)`}
          </div>
          {(phase === "improving" || phase === "improved") && hasCenterView(config.id) && (
            <div className="mt-0.5 text-[10px] text-text-muted">
              {config.featureHint ?? "In use"} · still open
            </div>
          )}
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-[11px] text-text-muted">
              {ready ? "tap to complete" : "tap to speed up"}
            </span>
            {eyebrow}
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
        className={`rounded-lg border p-3 text-left transition-colors ${
          selected
            ? "border-border-gold bg-accent/20"
            : "border-border-default hover:border-border-gold/40"
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
        <div className="mt-1 flex items-baseline justify-between gap-2">
          {data.slot?.totalNoviInvested ? (
            <span className="text-[11px] text-text-muted tabular-nums">
              {(data.slot.totalNoviInvested.toNumber?.() ?? 0).toLocaleString()} invested
            </span>
          ) : (
            <span />
          )}
          {eyebrow}
        </div>
      </button>
    );
  }

  // Unbuilt state
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border border-dashed p-3 text-left transition-colors ${
        selected
          ? "border-border-gold bg-accent/20"
          : "border-border-default opacity-60 hover:opacity-80 hover:border-border-default"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-text-primary">{config.name}</span>
        <span
          className={`text-[11px] font-bold ${
            config.tier === 3
              ? "text-gold-500"
              : config.tier === 2
                ? "text-text-gold"
                : "text-text-muted"
          }`}
        >
          T{config.tier}
        </span>
      </div>
      <div className="text-xs text-text-muted">{config.desc}</div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold text-text-muted">
          {config.tier === 1 ? "1k" : config.tier === 2 ? "2k" : "3k"} NOVI
        </span>
        {eyebrow}
      </div>
    </button>
  );
}
