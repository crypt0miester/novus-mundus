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
export function TripleCountInput({
  labels,
  available,
  value,
  onChange,
  icons,
  dense,
}: TripleCountInputProps) {
  const setIndex = (i: number, n: number) => {
    const next = [...value] as [number, number, number];
    next[i] = n;
    onChange(next);
  };

  return (
    // List mode (dense at all widths; default mode on mobile): each
    // slot is ONE horizontal row [icon][label][NumberField][/ avail].
    // sm+ in non-dense mode upgrades to the legacy 3-column grid where
    // the header (icon+label + avail chip) sits above a md-size field.
    <div
      className={
        dense
          ? "mt-1 flex flex-col gap-1"
          : "mt-1 flex flex-col gap-1 sm:grid sm:grid-cols-3 sm:gap-2"
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
            className="shrink-0 rounded px-1 font-mono text-[10px] tabular-nums text-text-secondary transition-colors hover:bg-surface-overlay hover:text-text-gold disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-text-secondary"
          >
            / {avail.toLocaleString()}
          </button>
        );

        return (
          <div key={label}>
            {/* List row: single line. The grid path (sm+, non-dense)
                falls through to the legacy block layout below via the
                `sm:flex-col sm:items-stretch` reset. */}
            <div
              className={
                dense
                  ? "flex items-center gap-2"
                  : "flex items-center gap-2 sm:flex-col sm:items-stretch sm:gap-1"
              }
            >
              {/* Inline icon + label (list mode). Hidden in the sm+
                  grid path where the header below carries them. */}
              <span
                className={
                  dense
                    ? "flex shrink-0 items-center gap-1 text-[10px] text-text-muted"
                    : "flex shrink-0 items-center gap-1 text-[10px] text-text-muted sm:hidden"
                }
              >
                {icons && <GameIcon id={icons[i]} size={14} title={label} />}
                <span className="w-14 truncate">{label}</span>
              </span>

              {/* Grid-mode header (sm+, non-dense): icon + label + the
                  avail chip on one line above the field. */}
              {!dense && (
                <div className="hidden text-[10px] text-text-muted sm:flex sm:items-center sm:justify-between sm:gap-1">
                  <span className="flex items-center gap-1 truncate">
                    {icons && <GameIcon id={icons[i]} size={14} title={label} />}
                    {label}
                  </span>
                  {availButton}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <NumberField
                  showMax={false}
                  min={0}
                  max={avail}
                  value={value[i]}
                  onChange={(n) => setIndex(i, n)}
                  size="sm"
                />
              </div>

              {/* Avail chip at the right end of the list row. Hidden in
                  the sm+ grid path (the header above carries it). */}
              <span className={dense ? "" : "sm:hidden"}>{availButton}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
