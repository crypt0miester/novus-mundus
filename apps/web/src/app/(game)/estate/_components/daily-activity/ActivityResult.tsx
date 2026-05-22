"use client";

import { useEffect, useState } from "react";

interface ActivityResultProps {
  title: string;
  /** 0-100 for graded mini-games; omitted for Class A choices. */
  score?: number;
  /** The reward / outcome line. */
  summary: string;
  onClose: () => void;
}

/**
 * The reward reveal shown after a daily activity is co-signed. Graded
 * mini-games count the score up; Class A choices just show the outcome.
 */
export function ActivityResult({ title, score, summary, onClose }: ActivityResultProps) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (score === undefined) return;
    let raf = 0;
    const start = performance.now();
    const duration = 900;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(eased * score));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [score]);

  return (
    <div className="card accent-border animate-in fade-in zoom-in-95 text-center duration-300">
      <div className="text-xs uppercase tracking-wider text-text-muted">{title} — complete</div>
      {score !== undefined && (
        <div className="mt-2 font-display text-5xl font-bold tabular-nums text-text-gold">
          {shown}
          <span className="ml-1 text-lg text-text-muted">/ 100</span>
        </div>
      )}
      <p className="mt-2 text-sm text-text-secondary">{summary}</p>
      <button
        onClick={onClose}
        className="mt-4 rounded-lg border border-border-gold bg-accent/20 px-6 py-2 text-sm font-semibold text-text-gold transition-colors hover:bg-accent/40"
      >
        Done
      </button>
    </div>
  );
}
