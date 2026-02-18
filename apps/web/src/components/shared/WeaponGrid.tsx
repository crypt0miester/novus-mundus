import { cn } from "@/lib/utils";

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
  const weapons = [
    { label: "Melee", icon: "⚔", value: melee },
    { label: "Ranged", icon: "🏹", value: ranged },
    { label: "Siege", icon: "⚙", value: siege },
    { label: "Armor", icon: "🛡", value: armor },
  ];

  return (
    <div className={cn("flex gap-4", className)}>
      {weapons.map((w) => (
        <div key={w.label} className="text-center">
          <div className="text-xs text-text-muted">{w.icon}</div>
          <div className="game-num text-sm">{w.value.toLocaleString()}</div>
          <div className="text-[10px] text-text-muted">{w.label}</div>
        </div>
      ))}
    </div>
  );
}
