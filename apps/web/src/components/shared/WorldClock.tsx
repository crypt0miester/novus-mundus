"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Moon, Sun, Sunrise, Sunset, type LucideIcon } from "lucide-react";
import {
  useWorldClock,
  PHASES,
  phaseWidth,
  type PhaseBody,
} from "@/lib/hooks/useWorldClock";
import { cn, formatTime } from "@/lib/utils";

const BODY_ICON: Record<PhaseBody, LucideIcon> = {
  moon: Moon,
  sun: Sun,
  sunrise: Sunrise,
  sunset: Sunset,
};

// Arc geometry, in the SVG's 240×120 viewBox. The celestial body rides a
// half-circle: dawn at the left foot, Midday at the apex, dusk at the right.
const CX = 120;
const CY = 110;
const R = 94;

/** Day fraction (0–1) to the body's [x, y] on the arc, in viewBox units. */
function arcPoint(dayFraction: number): [number, number] {
  const theta = Math.PI * (1 - dayFraction);
  return [CX + R * Math.cos(theta), CY - R * Math.sin(theta)];
}

/**
 * The world clock — a persistent, glanceable read on the day. Time-of-day
 * gates every NOVI-consumption multiplier in the game, so it lives in the
 * chrome: a phase glyph + label in the bar, opening an arc that shows where
 * the player sits in the cycle and when the phase turns over.
 */
/** `compact` drops the label + hour to just the phase glyph — for the cramped
 *  mobile status bar, where the popover still carries the full read. */
export function WorldClock({ compact = false }: { compact?: boolean }) {
  const { current, next, dayFraction, secondsToNext, clock } = useWorldClock();
  const pathname = usePathname();

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close on navigation and on an outside tap.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const Glyph = BODY_ICON[current.body];
  const [bx, by] = arcPoint(dayFraction);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Time of day: ${current.name}`}
        className={cn(
          "flex items-center rounded-md text-xs transition-colors hover:bg-surface-raised",
          compact ? "p-1" : "gap-1.5 px-2 py-1",
        )}
      >
        <Glyph
          className="h-3.5 w-3.5 shrink-0"
          style={{ color: current.color }}
        />
        {!compact && (
          <>
            <span className="font-medium text-text-secondary">
              {current.name}
            </span>
            <span className="hidden font-mono text-text-muted sm:inline">
              · {clock}
            </span>
          </>
        )}
      </button>

      {open && (
        <div
          // Anchored right — the widget sits near the right edge of the
          // bar on both desktop and mobile, so the 244px popover grows
          // inward rather than off the screen edge.
          className="absolute right-0 top-full z-50 mt-2 w-[244px] rounded-xl border border-border-default bg-[var(--nm-bg-bar)] p-3 shadow-xl shadow-black/40"
        >
          {/* The day's arc — gradient sky, the body riding it at `now`. */}
          <div className="relative mx-auto h-[104px] w-[220px]">
            <svg
              viewBox="0 0 240 120"
              className="absolute inset-0 h-full w-full overflow-visible"
            >
              <defs>
                <linearGradient id="nm-sky" x1="0" y1="0" x2="1" y2="0">
                  {PHASES.map((p) => (
                    <stop
                      key={p.name}
                      offset={p.start / 1000}
                      stopColor={p.color}
                    />
                  ))}
                  <stop offset="1" stopColor={PHASES[0]!.color} />
                </linearGradient>
              </defs>
              <path
                d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`}
                fill="none"
                stroke="url(#nm-sky)"
                strokeWidth="4"
                strokeLinecap="round"
              />
            </svg>
            <div
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${(bx / 240) * 100}%`, top: `${(by / 120) * 100}%` }}
            >
              <Glyph
                className="h-5 w-5"
                style={{
                  color: current.color,
                  filter: `drop-shadow(0 0 5px ${current.color}) drop-shadow(0 0 11px ${current.color})`,
                }}
              />
            </div>
          </div>

          {/* Phase + the in-world hour. */}
          <div className="flex items-baseline justify-between">
            <span
              className="font-display text-base font-semibold tracking-wide"
              style={{ color: current.color }}
            >
              {current.name}
            </span>
            <span className="font-mono text-xs text-text-muted">≈ {clock}</span>
          </div>
          <div className="mt-0.5 text-xs text-text-muted">
            {next.name} in {formatTime(secondsToNext, "compact")}
          </div>

          {/* The whole cycle as a ribbon, with a marker at `now`. */}
          <div className="relative mt-3 h-1.5">
            <div className="flex h-full overflow-hidden rounded-full">
              {PHASES.map((p, i) => (
                <div
                  key={p.name}
                  style={{ flexGrow: phaseWidth(i), backgroundColor: p.color }}
                />
              ))}
            </div>
            <div
              className="absolute top-1/2 h-3.5 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-text-primary ring-2 ring-[var(--nm-bg-bar)]"
              style={{ left: `${dayFraction * 100}%` }}
            />
          </div>

          <p className="mt-3 text-[11px] leading-snug text-text-muted">
            local hour, set by your city's longitude.
          </p>
        </div>
      )}
    </div>
  );
}
