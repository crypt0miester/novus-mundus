import { cn } from "@/lib/utils";

interface UnitGridProps {
  defense: [number, number, number]; // T1, T2, T3
  offense: [number, number, number]; // T1, T2, T3
  compact?: boolean;
  className?: string;
}

const tierLabels = ["T1", "T2", "T3"];

export function UnitGrid({
  defense,
  offense,
  compact = false,
  className,
}: UnitGridProps) {
  const defTotal = defense.reduce((a, b) => a + b, 0);
  const offTotal = offense.reduce((a, b) => a + b, 0);

  if (compact) {
    return (
      <div className={cn("flex gap-4 text-sm", className)}>
        <span className="text-text-secondary">
          DEF <span className="game-num">{defTotal.toLocaleString()}</span>
        </span>
        <span className="text-text-secondary">
          OPS <span className="game-num">{offTotal.toLocaleString()}</span>
        </span>
      </div>
    );
  }

  return (
    <div className={cn("grid grid-cols-2 gap-4", className)}>
      <div>
        <div className="mb-1 text-xs uppercase tracking-wider text-text-muted">
          Defense
        </div>
        <div className="game-num text-lg">{defTotal.toLocaleString()}</div>
        <div className="mt-1 space-y-0.5">
          {defense.map((count, i) => (
            <div key={tierLabels[i]} className="flex justify-between text-xs">
              <span className="text-text-muted">{tierLabels[i]}</span>
              <span className="game-num">{count.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1 text-xs uppercase tracking-wider text-text-muted">
          Operatives
        </div>
        <div className="game-num text-lg">{offTotal.toLocaleString()}</div>
        <div className="mt-1 space-y-0.5">
          {offense.map((count, i) => (
            <div key={tierLabels[i]} className="flex justify-between text-xs">
              <span className="text-text-muted">{tierLabels[i]}</span>
              <span className="game-num">{count.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
