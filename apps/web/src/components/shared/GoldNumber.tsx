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
// `compact` mirrors the pre-NumberFlow `formatNumber()` output by forcing one
// decimal — "1.0K" not "1K" for exact values — so the static fallback branch
// and the animated branch render identical glyphs.
//
// `percentage` is NOT `style: "percent"` because callers pass already-scaled
// values (`5` for "5.0%", not `0.05`) and `style: "percent"` would multiply by
// 100.
const FMT_COMPACT: NumberFlowFormat = {
  notation: "compact",
  minimumFractionDigits: 1,
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
  className,
}: GoldNumberProps) {
  const storeFormat = useSettings((s) => s.numberFormat);
  const animationsEnabled = useSettings((s) => s.animationsEnabled);
  const fmt: Format = format ?? storeFormat;
  const wrapperClass = cn(
    "font-mono tabular-nums text-text-gold",
    SIZE_CLASSES[size],
    className,
  );

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
