"use client";

import { useCallback, useEffect, useId, useState, type CSSProperties, type ReactNode } from "react";
import { Minus, Plus } from "lucide-react";
import { cn, isFibonacci } from "@/lib/utils";
import { InfoButton } from "@/components/shared/InfoButton";

interface NumberFieldProps {
  /** Current value — a clamped integer; the single source of truth. */
  value: number;
  onChange: (next: number) => void;
  /**
   * Real ceiling — a balance, an affordable count, units available. Required:
   * every position on the slider must map to a value the player can actually
   * commit, so there is no arbitrary fallback.
   */
  max: number;
  /** Real floor. Default 0. */
  min?: number;
  /** Increment for the − / + steppers. Default 1. */
  step?: number;
  label?: string;
  /** Optional explanation rendered as an InfoButton next to the label. */
  info?: ReactNode;
  /** Trailing unit shown inside the field, e.g. "NOVI". */
  suffix?: string;
  disabled?: boolean;
  /** Render the slider row. Default true. */
  showSlider?: boolean;
  /** Render the tappable "max N" shortcut. Default true. */
  showMax?: boolean;
  /**
   * "sm" tightens the row: 32px steppers instead of 40px and a smaller field
   * line-height. Use inside narrow panels (RightPanel sidebar / composers)
   * where the default 40px controls dominate the column.
   */
  size?: "md" | "sm";
  /**
   * Optional override for the Fibonacci-highlight check. The chain's
   * Fibonacci bonus applies to the value the instruction *carries* — for NOVI
   * fields that's `display × 10` raw, so callers should pass the raw value
   * here (e.g. `noviToDeci(value)`) when the highlight needs to predict the
   * actual on-chain bonus. Defaults to the displayed `value`.
   */
  fibonacciCheckValue?: number;
  className?: string;
}

const STEPPER_BASE =
  "flex shrink-0 items-center justify-center rounded-lg border " +
  "border-border-default bg-surface-raised text-text-secondary transition-colors " +
  "hover:bg-surface-overlay hover:text-text-primary " +
  "disabled:opacity-40 disabled:hover:bg-surface-raised disabled:hover:text-text-secondary";
const STEPPER_MD = `${STEPPER_BASE} h-10 w-10`;
const STEPPER_SM = `${STEPPER_BASE} h-8 w-8`;

/**
 * Fibonacci values at or below this are dropped — 1, 2, 3, 5, 8, 13, 21, 34,
 * 55, 89 sit too close together to be worth marking. The first that counts
 * is 144.
 */
const FIB_FLOOR = 89;

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/**
 * NumberField — one numeric value, three ways to set it: a typeable field,
 * − / + steppers, and a slider, all bound together.
 *
 * `min`/`max` are real bounds the caller supplies (a balance, an affordable
 * count) — never an arbitrary default — so every slider position is a value
 * the player can actually commit.
 *
 * The field holds a local draft string while focused, so it can be cleared and
 * retyped freely; it commits (parse to clamp) on blur or Enter. The steppers and
 * slider commit immediately.
 *
 * When the value is a Fibonacci number past `FIB_FLOOR`, the number renders
 * in gold — purely cosmetic, no effect on interaction.
 */
export function NumberField({
  value,
  onChange,
  max,
  min = 0,
  step = 1,
  label,
  info,
  suffix,
  disabled = false,
  size = "md",
  showSlider = true,
  showMax = true,
  fibonacciCheckValue,
  className,
}: NumberFieldProps) {
  const stepperClass = size === "sm" ? STEPPER_SM : STEPPER_MD;
  const fieldHeightClass = size === "sm" ? "h-8" : "h-10";
  const fieldId = useId();
  const lo = min;
  const hi = Math.max(min, max);
  // max < min — nothing affordable / available. The caller surfaces its own
  // "insufficient" copy; the control just locks at the floor.
  const rangeEmpty = max < min;
  const inert = disabled || rangeEmpty;
  const current = clamp(value, lo, hi);
  // A Fibonacci value worth marking in gold — the small, dense ones
  // (≤ FIB_FLOOR) are dropped. The check runs against `fibonacciCheckValue`
  // when supplied (NOVI fields pass `noviToDeci(value)` so the highlight
  // predicts the chain's on-raw bonus), otherwise against `current`.
  const fibValue = fibonacciCheckValue ?? current;
  const onFib = isFibonacci(fibValue) && current > FIB_FLOOR;

  // Draft string, live only while the field is focused — lets it be cleared
  // and retyped without the committed value fighting every keystroke.
  const [draft, setDraft] = useState<string | null>(null);

  const commit = useCallback(
    (n: number) => {
      setDraft(null);
      const next = clamp(n, lo, hi);
      if (next !== value) onChange(next);
    },
    [lo, hi, value, onChange],
  );

  // Re-sync the parent if the committed value drifts out of range (e.g. the
  // balance dropped beneath it). The equality guard idles this once settled.
  useEffect(() => {
    if (!rangeEmpty && value !== current) onChange(current);
  }, [value, current, rangeEmpty, onChange]);

  const atMin = current <= lo;
  const atMax = current >= hi;
  const display = draft ?? current.toLocaleString();
  const pct = hi > lo ? ((current - lo) / (hi - lo)) * 100 : 0;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {(label || (showMax && !rangeEmpty)) && (
        <div className={cn("flex items-center gap-2", label ? "justify-between" : "justify-end")}>
          {label && (
            <span className="flex items-center gap-1">
              <label htmlFor={fieldId} className="text-xs text-text-muted">
                {label}
              </label>
              {info && <InfoButton>{info}</InfoButton>}
            </span>
          )}
          {showMax && !rangeEmpty && (
            <button
              type="button"
              disabled={inert || atMax}
              onClick={() => commit(hi)}
              className="font-mono text-[11px] tabular-nums text-text-muted transition-colors hover:text-text-gold disabled:opacity-40 disabled:hover:text-text-muted"
            >
              max {hi.toLocaleString()}
            </button>
          )}
        </div>
      )}

      <div className="flex items-stretch gap-2">
        <button
          type="button"
          aria-label="Decrease"
          disabled={inert || atMin}
          onClick={() => commit(current - step)}
          className={stepperClass}
        >
          <Minus className="h-4 w-4" />
        </button>

        <div
          className={cn(
            `flex ${fieldHeightClass} min-w-0 flex-1 items-center rounded-lg border border-border-default bg-surface transition-colors focus-within:border-[var(--tier-accent)]`,
            inert && "opacity-50",
          )}
        >
          {/* Invisible twin of the suffix — an equal-width counterweight on the
              left, so the number stays dead-centred whatever the suffix says. */}
          {suffix && (
            <span aria-hidden className="invisible shrink-0 px-3 text-xs">
              {suffix}
            </span>
          )}
          <input
            id={fieldId}
            type="text"
            inputMode="numeric"
            disabled={inert}
            value={display}
            onFocus={() => setDraft(String(current))}
            onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
            onBlur={() => {
              if (draft === null) return;
              commit(draft === "" ? lo : parseInt(draft, 10));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className={cn(
              "h-full min-w-0 flex-1 bg-transparent px-3 text-center font-mono text-sm tabular-nums outline-none transition-colors",
              onFib ? "text-text-gold" : "text-text-primary",
            )}
          />
          {suffix && (
            <span className="pointer-events-none shrink-0 px-3 text-xs text-text-muted">
              {suffix}
            </span>
          )}
        </div>

        <button
          type="button"
          aria-label="Increase"
          disabled={inert || atMax}
          onClick={() => commit(current + step)}
          className={stepperClass}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {showSlider && (
        <input
          type="range"
          aria-label={label ?? "Value"}
          disabled={inert || hi <= lo}
          min={lo}
          max={hi}
          step={step}
          value={current}
          onChange={(e) => commit(Number(e.target.value))}
          className="nm-slider"
          style={{ "--nm-fill": `${pct}%` } as CSSProperties}
        />
      )}
    </div>
  );
}
