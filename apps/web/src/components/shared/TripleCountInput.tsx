import { NumberField } from "@/components/shared/NumberField";

/** Defensive unit slots, in on-chain order (defensiveUnit1/2/3). */
export const DEFENSIVE_UNIT_LABELS: [string, string, string] = ["Infantry", "Cavalry", "Siege"];

/** Weapon slots, in on-chain order (melee/ranged/siege). */
export const WEAPON_LABELS: [string, string, string] = ["Melee", "Ranged", "Siege"];

/** Operative unit slots, in on-chain order (operativeUnit1/2/3). */
export const OPERATIVE_UNIT_LABELS: [string, string, string] = ["Laborer", "Artisan", "Engineer"];

interface TripleCountInputProps {
  labels: [string, string, string];
  available: [number, number, number];
  value: [number, number, number];
  onChange: (next: [number, number, number]) => void;
}

/**
 * Three number inputs that write into a tuple, each clamped to [0, available].
 * Used for committing units / weapons / operatives to an action.
 */
export function TripleCountInput({ labels, available, value, onChange }: TripleCountInputProps) {
  return (
    <div className="mt-1 grid grid-cols-3 gap-2">
      {labels.map((label, i) => (
        <div key={label} className="block">
          <div className="text-[10px] text-text-muted">
            {label} <span className="text-text-secondary">/ {available[i].toLocaleString()}</span>
          </div>
          <NumberField
            className="mt-0.5"
            showSlider={false}
            showMax={false}
            min={0}
            max={available[i]}
            value={value[i]}
            onChange={(n) => {
              const next = [...value] as [number, number, number];
              next[i] = n;
              onChange(next);
            }}
          />
        </div>
      ))}
    </div>
  );
}
