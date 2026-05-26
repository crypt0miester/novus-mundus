/**
 * CosmeticBadgeChip — inline chip variant of a badge for headers/panels
 * where vertical real estate is tight.
 *
 * Renders a small badge image + uppercase name inside a rarity-coloured
 * border, matching the existing tier/title chip vocabulary in
 * EntityPanel. Use this when the badge sits in a chip rail beside
 * other status pills (tier, title). For a larger standalone badge,
 * use `<CosmeticBadge>`.
 *
 * id===0 or unknown id returns null → safe to render unconditionally
 * in chip rows.
 */

import { getCosmeticBadge, RARITY_BORDER } from "@/lib/config/cosmetics-catalog";

interface CosmeticBadgeChipProps {
  /** Raw on-chain u16 slot value; 0 = nothing equipped. */
  id: number | undefined | null;
}

export function CosmeticBadgeChip({ id }: CosmeticBadgeChipProps) {
  const entry = getCosmeticBadge(id);
  if (!entry) return null;
  const border = RARITY_BORDER[entry.rarity];
  return (
    <span
      title={`${entry.name}${entry.flavorText ? ` — ${entry.flavorText}` : ""}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.3rem",
        fontSize: "0.55rem",
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        padding: "0.15rem 0.45rem",
        border: `1px solid ${border}`,
        color: border,
        background: "var(--readout-tint)",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={entry.imgSrc}
        alt=""
        width={14}
        height={14}
        style={{ display: "block", objectFit: "contain", flexShrink: 0 }}
      />
      <span>{entry.name}</span>
    </span>
  );
}
