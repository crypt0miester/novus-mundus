interface CoverageNoteProps {
  /** Shortfalls to surface; entries with `count` 0 are dropped. */
  items: { count: number; label: string }[];
}

/**
 * An amber shortfall note for a roster — units without weapons, units without
 * food. Renders nothing when every count is zero, so a tab can mount it
 * unconditionally.
 */
export function CoverageNote({ items }: CoverageNoteProps) {
  const real = items.filter((i) => i.count > 0);
  if (real.length === 0) return null;
  return (
    <div className="space-y-0.5 rounded-lg border border-border-gold/50 bg-accent/15 px-3 py-2 text-xs text-text-gold">
      {real.map((i) => (
        <div key={i.label}>
          <span className="font-mono font-semibold tabular-nums">{i.count.toLocaleString()}</span>{" "}
          {i.label}
        </div>
      ))}
    </div>
  );
}
