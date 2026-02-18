"use client";

import { cn } from "@/lib/utils";

interface StatBarProps {
  current: number;
  max: number;
  label?: string;
  color?: "gold" | "green" | "red" | "blue" | "purple" | "tier";
  size?: "sm" | "md" | "lg";
  showValues?: boolean;
  className?: string;
}

const colorMap = {
  gold: "bg-amber-500",
  green: "bg-emerald-500",
  red: "bg-red-500",
  blue: "bg-blue-500",
  purple: "bg-purple-500",
  tier: "bg-[var(--nm-accent)]",
};

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

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {(label || showValues) && (
        <div className="flex items-center justify-between text-xs">
          {label && (
            <span className="uppercase tracking-wider text-text-muted">
              {label}
            </span>
          )}
          {showValues && (
            <span className="game-num text-xs">
              {current.toLocaleString()} / {max.toLocaleString()}
            </span>
          )}
        </div>
      )}
      <div
        className={cn(
          "overflow-hidden rounded-full bg-zinc-800",
          sizeMap[size]
        )}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-700 ease-out",
            colorMap[color]
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
