/**
 * CosmeticFrame — renders a rarity-themed ring around the wearer's badge
 * or avatar. id===0 / unknown ids fall through (no frame applied) so the
 * EntityPanel can render `<CosmeticFrame id={cosmetics?.equipped_avatar_frame ?? 0}>`
 * unconditionally.
 *
 * Style: a circular border matching the catalog's ring config, optionally
 * with a soft glow halo. Children render inside the ring.
 */

import { getCosmeticFrame } from "@/lib/config/cosmetics-catalog";

interface CosmeticFrameProps {
  /** Raw on-chain u16 slot value; 0 = nothing equipped. */
  id: number | undefined | null;
  /** Rendered diameter in CSS px. */
  size?: number;
  /** Content wrapped by the frame — typically a badge or avatar element. */
  children: React.ReactNode;
}

export function CosmeticFrame({ id, size = 48, children }: CosmeticFrameProps) {
  const entry = getCosmeticFrame(id);
  if (!entry) {
    return <>{children}</>;
  }
  const r = entry.ring;
  return (
    <div
      title={`${entry.name}${entry.flavorText ? ` — ${entry.flavorText}` : ""}`}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        border: `${r.borderWidth}px ${r.borderStyle ?? "solid"} ${r.borderColor}`,
        boxShadow: r.glow ? `0 0 12px ${r.glow}` : undefined,
        display: "grid",
        placeItems: "center",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {children}
    </div>
  );
}
