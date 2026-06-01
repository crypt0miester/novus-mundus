"use client";

import NumberFlow, { type Format as NumberFlowFormat } from "@number-flow/react";
import { cn, formatNumber } from "@/lib/utils";
import { useSettings } from "@/lib/store/settings";

type Format = "compact" | "full" | "novi" | "percentage";
type Size = "sm" | "md" | "lg" | "xl";

interface GoldNumberProps {
  value: number;
  format?: Format;
  size?: Size;
  /** No-op today. Kept because ~17 call sites pass `glow={false}` to opt out
   *  of a previous gold-glow effect. Drop this and those call sites together
   *  if the glow isn't coming back. */
  glow?: boolean;
  prefix?: string;
  suffix?: string;
  /**
   * When true (the default) value transitions roll digit-by-digit via
   * `@number-flow/react`. Set false on surfaces where the rolling reads as
   * noise — max caps, denominators (the X in `12 / 80`), level numbers, any
   * config-constant display. This flag only controls *update* behaviour;
   * NumberFlow never animates on mount.
   */
  animate?: boolean;
  /**
   * Optional externally-driven display value. When provided, GoldNumber renders
   * this number as static formatted text instead of deferring to NumberFlow,
   * letting a caller drive a count-up frame-by-frame (e.g. the leaderboard FLIP
   * synchronises a plain-object anime.js tween with the row reorder so the score
   * counts up in lockstep with the physical rank movement). `value` still drives
   * formatting/finite-ness; existing callers that omit this keep NumberFlow. */
  controlledValue?: number;
  className?: string;
}

const SIZE_CLASSES: Record<Size, string> = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-2xl",
  xl: "text-4xl font-bold",
};

// Module-scope constants so NumberFlow's internal `useMemo([format])` keeps its
// fast path (a fresh object literal per render would invalidate the cached
// Intl.NumberFormat instance).
//
// `compact` matches `formatNumber()`: small exact values stay integers ("5",
// never "5.0", since a member/unit count must not read as a decimal) and only a
// compacted value carries a fractional digit ("1.5K", "1K"). minimumFractionDigits
// must be 0, not 1, or compact notation pads every value with a ".0".
//
// `percentage` is NOT `style: "percent"` because callers pass already-scaled
// values (`5` for "5.0%", not `0.05`) and `style: "percent"` would multiply by
// 100.
const FMT_COMPACT: NumberFlowFormat = {
  notation: "compact",
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
};
const FMT_PERCENTAGE: NumberFlowFormat = {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
};

function formatConfig(fmt: Format): { intl?: NumberFlowFormat; suffix: string } {
  switch (fmt) {
    case "compact":
      return { intl: FMT_COMPACT, suffix: "" };
    case "percentage":
      return { intl: FMT_PERCENTAGE, suffix: "%" };
    case "novi":
      return { suffix: " NOVI" };
    case "full":
      return { suffix: "" };
  }
}

/**
 * Gold-tinted number, the chokepoint for every animated value in the UI.
 * Defers to `@number-flow/react` for digit-rolling transitions; falls back to
 * a static `<span>` rendered via `formatNumber()` when animation is disabled
 * or the value isn't a finite Number.
 */
export function GoldNumber({
  value,
  format,
  size = "md",
  prefix,
  suffix,
  animate = true,
  controlledValue,
  className,
}: GoldNumberProps) {
  const storeFormat = useSettings((s) => s.numberFormat);
  const animationsEnabled = useSettings((s) => s.animationsEnabled);
  const fmt: Format = format ?? storeFormat;
  const wrapperClass = cn("font-mono tabular-nums text-text-gold", SIZE_CLASSES[size], className);

  // Caller-driven count-up: render the supplied frame value as static text and
  // step out of NumberFlow's internal clock so the digits stay synchronised with
  // whatever choreography the caller is running. We still gate on finite `value`
  // so a non-numeric semantic value never paints a stray controlled frame.
  if (controlledValue !== undefined && Number.isFinite(controlledValue)) {
    return (
      <span className={wrapperClass}>
        {prefix}
        {formatNumber(controlledValue, fmt)}
        {suffix}
      </span>
    );
  }

  const shouldAnimate = animate && animationsEnabled && Number.isFinite(value);
  if (!shouldAnimate) {
    return (
      <span className={wrapperClass}>
        {prefix}
        {formatNumber(value, fmt)}
        {suffix}
      </span>
    );
  }

  const { intl, suffix: formatSuffix } = formatConfig(fmt);
  const fullSuffix = formatSuffix + (suffix ?? "");
  return (
    <NumberFlow
      value={value}
      format={intl}
      prefix={prefix}
      suffix={fullSuffix || undefined}
      className={wrapperClass}
    />
  );
}
