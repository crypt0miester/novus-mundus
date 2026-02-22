"use client";

import { cn, formatNumber } from "@/lib/utils";
import { useSettings } from "@/lib/store/settings";

interface GoldNumberProps {
  value: number;
  duration?: number;
  format?: "compact" | "full" | "novi" | "percentage";
  size?: "sm" | "md" | "lg" | "xl";
  glow?: boolean;
  prefix?: string;
  suffix?: string;
  delta?: boolean;
  className?: string;
}

export function GoldNumber({
  value,
  format,
  size = "md",
  prefix,
  suffix,
  className,
}: GoldNumberProps) {
  const storeFormat = useSettings((s) => s.numberFormat);
  const fmt = format ?? storeFormat;

  const sizeClasses = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-2xl",
    xl: "text-4xl font-bold",
  };

  return (
    <span
      className={cn(
        "font-mono tabular-nums text-text-gold",
        sizeClasses[size],
        className
      )}
    >
      {prefix}
      {formatNumber(value, fmt)}
      {suffix}
    </span>
  );
}
