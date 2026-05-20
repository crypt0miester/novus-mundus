"use client";

import { useRef, useEffect, useState } from "react";
import { cn, formatTime } from "@/lib/utils";

interface GoldCountdownProps {
  endsAt: number;
  onComplete?: () => void;
  format?: "full" | "compact" | "colon";
  urgentThreshold?: number;
  showProgress?: boolean;
  startedAt?: number;
  label?: string;
  size?: "sm" | "md" | "lg";
}

export function GoldCountdown({
  endsAt,
  onComplete,
  format = "full",
  urgentThreshold = 300,
  showProgress,
  startedAt,
  label,
  size = "md",
}: GoldCountdownProps) {
  const timerRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    let done = false;

    const update = () => {
      const now = Math.floor(Date.now() / 1000);
      const remaining = Math.max(0, endsAt - now);

      if (timerRef.current) {
        timerRef.current.textContent = remaining === 0 ? "READY" : formatTime(remaining, format);
      }

      if (barRef.current && startedAt) {
        const total = endsAt - startedAt;
        const elapsed = now - startedAt;
        const pct = Math.min(100, (elapsed / total) * 100);
        barRef.current.style.width = `${pct}%`;
      }

      if (
        remaining > 0 &&
        remaining <= urgentThreshold &&
        timerRef.current
      ) {
        timerRef.current.classList.add("text-danger");
        timerRef.current.classList.remove("text-text-gold");
      }

      if (remaining === 0 && !done) {
        done = true;
        setCompleted(true);
        onComplete?.();
      }
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [endsAt, startedAt, format, urgentThreshold, onComplete]);

  const sizeClasses = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-2xl",
  };

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <span className="text-xs uppercase tracking-wider text-zinc-500">
          {label}
        </span>
      )}
      <div className="flex items-center gap-2">
        <span className="text-zinc-500">◷</span>
        <span
          ref={timerRef}
          className={cn(
            "font-mono tabular-nums text-text-gold",
            sizeClasses[size]
          )}
        />
      </div>
      {showProgress && (
        <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div
            ref={barRef}
            className="h-full rounded-full bg-[var(--nm-accent)] transition-[width] duration-1000"
            style={{ width: "0%" }}
          />
        </div>
      )}
    </div>
  );
}
