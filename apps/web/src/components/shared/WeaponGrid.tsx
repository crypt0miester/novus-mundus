import { cn } from "@/lib/utils";
import { GameIcon, type GameIconId } from "@/components/shared/GameIcon";

interface WeaponGridProps {
  melee: number;
  ranged: number;
  siege: number;
  armor: number;
  className?: string;
}

export function WeaponGrid({
  melee,
  ranged,
  siege,
  armor,
  className,
}: WeaponGridProps) {
  const weapons: { label: string; icon: GameIconId; value: number }[] = [
    { label: "Melee", icon: "weapon-melee", value: melee },
    { label: "Ranged", icon: "weapon-ranged", value: ranged },
    { label: "Siege", icon: "weapon-siege", value: siege },
    { label: "Armor", icon: "weapon-armor", value: armor },
  ];

  return (
    <div className={cn("flex gap-4", className)}>
      {weapons.map((w) => (
        <div key={w.label} className="text-center">
          <GameIcon
            id={w.icon}
            title={w.label}
            size={20}
            className="mx-auto text-text-gold"
          />
          <div className="game-num text-sm">{w.value.toLocaleString()}</div>
          <div className="text-[10px] text-text-muted">{w.label}</div>
        </div>
      ))}
    </div>
  );
}
