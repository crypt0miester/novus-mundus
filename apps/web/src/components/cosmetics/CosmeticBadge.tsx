/**
 * CosmeticBadge — renders an equipped badge image for a player.
 *
 * Input is the raw on-chain `equipped_badge: u16` slot. id===0 means
 * "no badge equipped" → returns null (no DOM emitted). Unknown ids
 * (catalog gap / pre-launch data) also return null. So the EntityPanel
 * can render `<CosmeticBadge id={cosmetics?.equipped_badge ?? 0} />`
 * unconditionally — until a real badge ID lands, nothing draws.
 *
 * Style: rarity-coloured circular frame around the image. Badge art
 * is expected to be a transparent-bg PNG/SVG ~96×96 sized for retina.
 */

import { getCosmeticBadge, RARITY_BORDER } from "@/lib/config/cosmetics-catalog";

interface CosmeticBadgeProps {
  /** Raw on-chain u16 slot value; 0 = nothing equipped. */
  id: number | undefined | null;
  /** Rendered size in CSS px. Default 36 — fits the EntityPanel level pip row. */
  size?: number;
}

export function CosmeticBadge({ id, size = 36 }: CosmeticBadgeProps) {
  const entry = getCosmeticBadge(id);
  if (!entry) return null;
  return (
    <div
      title={`${entry.name}${entry.flavorText ? ` — ${entry.flavorText}` : ""}`}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: "50%",
        border: `2px solid ${RARITY_BORDER[entry.rarity]}`,
        background: "var(--readout-tint, transparent)",
        display: "grid",
        placeItems: "center",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={entry.imgSrc}
        alt={entry.name}
        width={size - 6}
        height={size - 6}
        style={{ display: "block", objectFit: "contain" }}
      />
    </div>
  );
}
