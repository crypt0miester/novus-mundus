"use client";

import { useEffect, useRef } from "react";
import { createTimeline, spring } from "animejs";
import { CATEGORY_COLORS, tierColor, type BuildingFeatureConfig } from "@/lib/config/building-features";
import { InfoButton } from "@/components/shared/InfoButton";
import { formatTime, prefersReducedMotion } from "@/lib/utils";
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

// Completion bloom spring for the "Ready!" text pop. Built once at module scope
// so the simulation is not re-run per render (see motion tokens convention).
const READY_POP = spring({ stiffness: 220, damping: 14 });

// One timeline sweeps a single --phase var that BOTH the border color and the
// --glow box-shadow read, so color and bloom can never desync. Fires exactly
// once on the constructing -> ready EDGE (tracked with a per-card ref), never on
// the 1s construction tick or on a card that mounts already-ready (reload
// mid-construction). The grid's FLIP reflow owns all translate motion, so this
// only ever touches --phase / scale and never fights it.
function useReadyBloom(ready: boolean, cardRef: React.RefObject<HTMLElement | null>) {
  const wasReady = useRef(ready);
  useEffect(() => {
    const prev = wasReady.current;
    wasReady.current = ready;
    // Only the false -> true edge blooms. A card that is ready on first effect
    // run (prev === ready === true) is a reload, not a fresh completion.
    if (!ready || prev === ready) return;
    const el = cardRef.current;
    if (!el) return;
    if (prefersReducedMotion()) {
      // Snap to the final lit state, no choreography.
      el.style.setProperty("--phase", "1");
      return;
    }
    const tl = createTimeline({ defaults: { ease: "outQuad" } })
      .add(el, { "--phase": [0, 1], duration: 620 }, 0)
      .add(
        el.querySelectorAll("[data-ready-text]"),
        { scale: [0.6, 1], opacity: [0, 1], ease: READY_POP },
        "<<+=80",
      );
    return () => {
      tl.cancel();
    };
  }, [ready, cardRef]);
}

export function BuildingCard({ data, selected, onClick }: BuildingCardProps) {
  const { config, phase, status, level, constructing, remainingSec, ready, lockReason } = data;
  // One ref across every card shape (div for constructing/locked, button for
  // active/unbuilt). HTMLElement covers both for the bloom's style + query reads.
  const cardRef = useRef<HTMLElement>(null);
  const categoryColor = CATEGORY_COLORS[config.category];
  // FLIP-tracking handle for the grid (keyed by building id, NOT DOM index).
  const bcard = config.id;

  useReadyBloom(ready, cardRef);

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
        const started = Number(data.slot.constructionStarted ?? 0n);
        const ends = Number(data.slot.constructionEnds ?? 0n);
        const total = ends - started;
        return total > 0 ? Math.min(100, Math.round(((total - remainingSec) / total) * 100)) : 0;
      })()
    : 0;

  // Locked state
  if (status === "locked") {
    return (
      <div
        ref={cardRef as React.Ref<HTMLDivElement>}
        data-bcard={bcard}
        className="rounded-lg border border-zinc-800/50 p-3 opacity-40"
      >
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

  // Constructing state. When the card flips to ready, --phase sweeps 0 -> 1 and
  // drives both the border color and the --glow box-shadow off the same var, so
  // the bloom can never desync. Resting state (--phase: 0) reads the plain gold
  // border; the bloom only lifts it for ready cards.
  if (constructing) {
    return (
      <div
        ref={cardRef as React.Ref<HTMLDivElement>}
        data-bcard={bcard}
        style={
          {
            "--phase": ready ? 1 : 0,
            "--glow": "0 0 calc(var(--phase) * 18px) rgba(214, 178, 102, calc(var(--phase) * 0.55))",
            borderColor: ready
              ? "color-mix(in srgb, var(--color-border-gold) calc(60% + var(--phase) * 40%), transparent)"
              : undefined,
            boxShadow: "var(--glow)",
          } as React.CSSProperties
        }
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
            {ready ? (
              <span data-ready-text className="inline-block">
                Ready!
              </span>
            ) : (
              `${timeStr} remaining (${pct}%)`
            )}
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
        ref={cardRef as React.Ref<HTMLButtonElement>}
        data-bcard={bcard}
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
              {Number(data.slot.totalNoviInvested).toLocaleString()} invested{" "}
              <InfoButton>Locked NOVI burned to build and upgrade this slot. It is spent, not refundable.</InfoButton>
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
      ref={cardRef as React.Ref<HTMLButtonElement>}
      data-bcard={bcard}
      onClick={onClick}
      className={`rounded-lg border border-dashed p-3 text-left transition-colors ${
        selected
          ? "border-border-gold bg-accent/20"
          : "border-border-default opacity-60 hover:opacity-80 hover:border-border-default"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-text-primary">{config.name}</span>
        <span className={`text-[11px] font-bold ${tierColor(config.tier)}`}>T{config.tier}</span>
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
