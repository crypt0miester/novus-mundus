import { cn } from "@/lib/utils";

interface ResourceRowProps {
  label: string;
  value: string | number;
  prefix?: string;
  className?: string;
}

export function ResourceRow({ label, value, prefix, className }: ResourceRowProps) {
  return (
    <div className={cn("flex items-center justify-between text-sm", className)}>
      <span className="text-text-secondary">{label}</span>
      <span className="game-num">
        {prefix && <span className="mr-1">{prefix}</span>}
        {typeof value === "number" ? value.toLocaleString() : value}
      </span>
    </div>
  );
}
