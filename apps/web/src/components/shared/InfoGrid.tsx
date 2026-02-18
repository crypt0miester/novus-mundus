"use client";

import { cn } from "@/lib/utils";

export interface InfoGridItem {
  label: string;
  value: string | number;
  suffix?: string;
  highlight?: boolean;
}

interface InfoGridProps {
  items: InfoGridItem[];
  columns?: 2 | 3 | 4;
  className?: string;
}

export function InfoGrid({ items, columns = 4, className }: InfoGridProps) {
  const colClass =
    columns === 2
      ? "grid-cols-2"
      : columns === 3
        ? "grid-cols-2 md:grid-cols-3"
        : "grid-cols-2 md:grid-cols-4";

  return (
    <div className={cn("grid gap-3", colClass, className)}>
      {items.map((item) => (
        <div key={item.label} className="rounded-lg bg-surface/60 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">
            {item.label}
          </div>
          <div
            className={cn(
              "mt-0.5 font-mono text-sm font-semibold tabular-nums",
              item.highlight ? "text-amber-400" : "text-text-primary",
            )}
          >
            {item.value}
            {item.suffix && (
              <span className="ml-0.5 text-[10px] font-normal text-zinc-500">
                {item.suffix}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
