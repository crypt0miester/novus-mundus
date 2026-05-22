import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ProgressRingProps {
  /** Fill amount, 0–100. Clamped. */
  percent: number;
  /** Outer pixel size of the (square) ring. Default 112. */
  size?: number;
  /** Progress stroke width, in the 120-unit viewBox. Default 6. */
  strokeWidth?: number;
  /** Progress stroke colour (any CSS colour). Default: the tier accent. */
  color?: string;
  className?: string;
  /** Centred content (a number, label, icon…). */
  children?: ReactNode;
}

// r=54 in a 120 viewBox leaves room for the stroke; C is its circumference.
const R = 54;
const C = 2 * Math.PI * R;

/**
 * A circular progress ring — a track plus a dasharray-driven progress arc.
 * Pure: the arc is set inline from `percent` and CSS-transitions, so it
 * animates smoothly on re-render with no refs or effects. Shared by the
 * dashboard vitals rings and the NOVI generator.
 */
export function ProgressRing({
  percent,
  size = 112,
  strokeWidth = 6,
  color = "var(--tier-accent-bright)",
  className,
  children,
}: ProgressRingProps) {
  const p = Math.max(0, Math.min(100, percent));
  return (
    <div className={cn("relative flex-shrink-0", className)} style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          className="text-zinc-800"
        />
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - p / 100)}
          style={{ stroke: color, transition: "stroke-dashoffset 0.8s ease-out" }}
        />
      </svg>
      {children != null && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
      )}
    </div>
  );
}
