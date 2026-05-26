/**
 * CosmeticTitleChip — renders the player's equipped title as a small
 * uppercase chip. Mirrors the existing tier / rarity chip vocabulary
 * in EntityPanel so the panel reads as one family.
 *
 * Input is the raw on-chain `equipped_title: u16`. id===0 → null.
 * Unknown id (catalog gap) → null. Layout-safe to render
 * unconditionally next to other status chips — nothing draws until
 * the catalog has the matching entry.
 */

import { getCosmeticTitle, RARITY_BORDER } from "@/lib/config/cosmetics-catalog";

interface CosmeticTitleChipProps {
  /** Raw on-chain u16 slot value; 0 = no title equipped. */
  id: number | undefined | null;
}

export function CosmeticTitleChip({ id }: CosmeticTitleChipProps) {
  const entry = getCosmeticTitle(id);
  if (!entry) return null;
  const border = RARITY_BORDER[entry.rarity];
  return (
    <span
      title={`${entry.displayName} (${entry.rarity})`}
      style={{
        display: "inline-block",
        fontSize: "0.55rem",
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        padding: "0.15rem 0.45rem",
        border: `1px solid ${border}`,
        color: border,
        background: "var(--readout-tint)",
      }}
    >
      {entry.displayName}
    </span>
  );
}
