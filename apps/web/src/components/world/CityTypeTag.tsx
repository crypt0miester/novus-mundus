import { Crown, Pickaxe, Swords, Coins, type LucideIcon } from "lucide-react";
import { CITY_TYPE_NAMES } from "novus-mundus-sdk";
import { cn } from "@/lib/utils";

// City type as an icon + name, indexed by the on-chain CityType enum
// (Capital, Resource, Combat, Trade). Replaces the old color-coded badges so the
// browse + detail views read in one neutral style instead of green/red/blue.
const CITY_TYPE_ICONS: readonly LucideIcon[] = [Crown, Pickaxe, Swords, Coins];

export function CityTypeTag({ type, className }: { type: number; className?: string }) {
  const i = Math.min(type, 3);
  const Icon = CITY_TYPE_ICONS[i] ?? Crown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md bg-surface-overlay px-2 py-0.5 text-[11px] text-text-secondary",
        className,
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {CITY_TYPE_NAMES[i]}
    </span>
  );
}
