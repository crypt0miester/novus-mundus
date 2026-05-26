import { NumberField } from "@/components/shared/NumberField";
import { GameIcon, type GameIconId } from "@/components/shared/GameIcon";

/** Defensive unit slots, in on-chain order (defensiveUnit1/2/3). */
export const DEFENSIVE_UNIT_LABELS: [string, string, string] = ["Infantry", "Cavalry", "Siege"];

/** Weapon slots, in on-chain order (melee/ranged/siege). */
export const WEAPON_LABELS: [string, string, string] = ["Melee", "Ranged", "Siege"];

/** Operative unit slots, in on-chain order (operativeUnit1/2/3). */
export const OPERATIVE_UNIT_LABELS: [string, string, string] = ["Laborer", "Artisan", "Engineer"];

/** Matching icon ids for each label tuple (same on-chain order). */
export const DEFENSIVE_UNIT_ICONS: [GameIconId, GameIconId, GameIconId] = [
  "unit-infantry",
  "unit-cavalry",
  "unit-siege",
];
export const WEAPON_ICONS: [GameIconId, GameIconId, GameIconId] = [
  "weapon-melee",
  "weapon-ranged",
  "weapon-siege",
];
export const OPERATIVE_UNIT_ICONS: [GameIconId, GameIconId, GameIconId] = [
  "unit-laborer",
  "unit-artisan",
  "unit-engineer",
];

interface TripleCountInputProps {
  labels: [string, string, string];
  available: [number, number, number];
  value: [number, number, number];
  onChange: (next: [number, number, number]) => void;
  /** Optional matching icon ids for each slot — rendered to the left of the label. */
  icons?: [GameIconId, GameIconId, GameIconId];
  /**
   * Force the stacked list layout even at sm+ widths. Use inside narrow
   * containers (RightPanel sidebar is ~288px on desktop) where the 3-column
   * grid would crush the steppers. Default: false → responsive (list on
   * mobile, grid on sm+).
   */
  dense?: boolean;
}

/**
 * Three number inputs that write into a tuple, each clamped to [0, available].
 * Used for committing units / weapons / operatives to an action.
 */
export function TripleCountInput({ labels, available, value, onChange, icons, dense }: TripleCountInputProps) {
  const setIndex = (i: number, n: number) => {
    const next = [...value] as [number, number, number];
    next[i] = n;
    onChange(next);
  };

  return (
    // Mobile (or dense=true at any width): vertical list (icon stacked above
    // label on the left, controls on the right; thin 50%-width centred
    // divider between rows). Otherwise sm+ uses the 3-column grid.
    <div
      className={
        dense
          ? "mt-1 flex flex-col gap-1.5"
          : "mt-1 flex flex-col gap-3 sm:grid sm:grid-cols-3 sm:gap-2"
      }
    >
      {labels.map((label, i) => {
        const avail = available[i];
        const disabled = avail <= 0;
        const availButton = (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setIndex(i, avail)}
            title={disabled ? "None available" : `Use max (${avail.toLocaleString()})`}
            className="rounded px-1 font-mono text-[10px] tabular-nums text-text-secondary transition-colors hover:bg-surface-overlay hover:text-text-gold disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-text-secondary"
          >
            / {avail.toLocaleString()}
          </button>
        );

        return (
          <div key={label}>
            {/* List row (mobile, or any time dense=true): icon stacked
                above label on the left, controls stacked on the right.
                The grid path stays the legacy block layout. */}
            <div className={dense ? "flex items-center gap-3" : "flex items-center gap-3 sm:block"}>
              <span
                className={
                  dense
                    ? "my-auto flex w-12 shrink-0 flex-col items-center gap-0.5 self-center text-center text-[9px] text-text-muted"
                    : "my-auto flex w-16 shrink-0 flex-col items-center gap-1 self-center text-center text-[10px] text-text-muted sm:hidden"
                }
              >
                {icons && <GameIcon id={icons[i]} size={dense ? 16 : 24} title={label} />}
                <span className="truncate">{label}</span>
              </span>
              {!dense && (
                <div className="hidden text-[10px] text-text-muted sm:flex sm:items-center sm:justify-between sm:gap-1">
                  <span className="flex items-center gap-1 truncate">
                    {icons && <GameIcon id={icons[i]} size={14} title={label} />}
                    {label}
                  </span>
                  {availButton}
                </div>
              )}
              <div className={dense ? "min-w-0 flex-1" : "min-w-0 flex-1 sm:mt-1"}>
                <div className={dense ? "mb-1 flex justify-end" : "mb-1 flex justify-end sm:hidden"}>
                  {availButton}
                </div>
                <NumberField
                  showMax={false}
                  min={0}
                  max={avail}
                  value={value[i]}
                  onChange={(n) => setIndex(i, n)}
                  size={dense ? "sm" : "md"}
                />
              </div>
            </div>
            {/* Divider — 50% width, centred — between rows. Mobile-only
                in responsive mode; always in dense mode. */}
            {i < labels.length - 1 && (
              <div
                className={
                  dense
                    ? "mx-auto mt-1.5 h-px w-1/2 bg-zinc-800/60"
                    : "mx-auto mt-3 h-px w-1/2 bg-zinc-800/60 sm:hidden"
                }
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
