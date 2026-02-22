import { cn } from "@/lib/utils";

type BadgeVariant =
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
  default: "bg-zinc-800 text-zinc-300 border-zinc-700",
  gold: "bg-amber-950/50 text-amber-400 border-amber-800",
  success: "bg-emerald-950/50 text-emerald-400 border-emerald-800",
  danger: "bg-red-950/50 text-red-400 border-red-800",
  info: "bg-blue-950/50 text-blue-400 border-blue-800",
  common: "bg-zinc-800 text-zinc-400 border-zinc-600",
  uncommon: "bg-emerald-950/50 text-emerald-400 border-emerald-700",
  rare: "bg-blue-950/50 text-blue-400 border-blue-700",
  epic: "bg-purple-950/50 text-fuchsia-400 border-purple-700",
  legendary: "bg-amber-950/50 text-amber-400 border-amber-600",
  mythic: "bg-red-950/50 text-red-400 border-red-600",
};

export function Badge({
  variant = "default",
  children,
  className,
  pulse,
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        variantStyles[variant],
        pulse && "animate-pulse",
        className
      )}
    >
      {children}
    </span>
  );
}
