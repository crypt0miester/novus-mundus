import { cn } from "@/lib/utils";

export type BadgeVariant =
  | "default"
  | "gold"
  | "success"
  | "danger"
  | "info"
  | "common"
  | "uncommon"
  | "rare"
  | "epic"
  | "legendary"
  | "mythic";

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
  pulse?: boolean;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-surface-overlay text-text-muted border-border-default",
  gold: "bg-accent/50 text-text-gold border-border-gold",
  success: "bg-emerald-950/50 text-emerald-400 border-emerald-800",
  danger: "bg-red-950/50 text-red-400 border-red-800",
  info: "bg-blue-950/50 text-blue-400 border-blue-800",
  // Gold-intensity rarity ladder — neutral (mundane) climbing to bright gold.
  common: "bg-surface-overlay text-text-muted border-border-default",
  uncommon: "bg-zinc-700/50 text-zinc-200 border-zinc-500",
  rare: "bg-accent/50 text-gold-500 border-border-gold",
  epic: "bg-accent/40 text-gold-400 border-border-gold",
  legendary: "bg-accent/40 text-gold-200 border-border-gold-bright",
  mythic: "bg-red-950/50 text-red-400 border-red-600",
};

export function Badge({ variant = "default", children, className, pulse }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        variantStyles[variant],
        pulse && "animate-pulse",
        className,
      )}
    >
      {children}
    </span>
  );
}
