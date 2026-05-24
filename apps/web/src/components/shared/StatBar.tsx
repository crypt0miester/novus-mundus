"use client";

import { cn } from "@/lib/utils";

interface StatBarProps {
  current: number;
  max: number;
  label?: string;
  /** "health" ramps green to amber to red as the value drops. */
  color?: "gold" | "green" | "red" | "blue" | "purple" | "tier" | "health";
  size?: "sm" | "md" | "lg";
  showValues?: boolean;
  className?: string;
}

// `gold` routes through --color-text-gold so the bar tracks per-tier overrides
// from globals.css (bronze/silver/gold), staying in lock-step with sibling
// gold text rather than hardcoding a fixed gold shade.
const colorMap = {
  gold: "bg-[var(--color-text-gold)]",
  green: "bg-emerald-500",
  red: "bg-red-500",
  blue: "bg-blue-500",
  purple: "bg-purple-500",
  tier: "bg-[var(--nm-accent)]",
};

/** Health ramp — green while healthy, amber when worn down, red when critical. */
function healthClass(pct: number): string {
  if (pct > 50) return "bg-emerald-500";
  if (pct > 25) return "bg-gold-500";
  return "bg-red-500";
}

const sizeMap = {
  sm: "h-1",
  md: "h-2",
  lg: "h-3",
};

export function StatBar({
  current,
  max,
  label,
  color = "gold",
  size = "md",
  showValues = true,
  className,
}: StatBarProps) {
  const pct = max > 0 ? Math.min(100, (current / max) * 100) : 0;
  const barClass = color === "health" ? healthClass(pct) : colorMap[color];

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {(label || showValues) && (
        <div className="flex items-center justify-between text-xs">
          {label && <span className="uppercase tracking-wider text-text-muted">{label}</span>}
          {showValues && (
            <span className="game-num text-xs">
              {current.toLocaleString()} / {max.toLocaleString()}
            </span>
          )}
        </div>
      )}
      <div className={cn("overflow-hidden rounded-full bg-zinc-800", sizeMap[size])}>
        <div
          className={cn("h-full rounded-full transition-[width] duration-700 ease-out", barClass)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
