"use client";

import { cn } from "@/lib/utils";

interface HeroImageProps {
  /** Hero mint pubkey (base58) for a minted hero, composed from on-chain state. */
  pubkey?: string | null;
  /** Template id, for an unminted preview (no chain account yet). */
  templateId?: number | null;
  /** Hero level. Drives ascension marks and busts the browser cache on level-up. */
  level?: number;
  locked?: boolean;
  threatened?: boolean;
  alt?: string;
  className?: string;
}

/**
 * The composited hero portrait (silhouette, halo, city sigil, buffs, ascension
 * marks). A minted hero reads its on-chain state from `/heroes/{pubkey}/image`;
 * the `v={level}` param busts the browser cache so the portrait refreshes when
 * the hero levels up. An unminted template renders the level-1 preview, the
 * same surface shown on the mint screen.
 */
export function HeroImage({
  pubkey,
  templateId,
  level = 1,
  locked,
  threatened,
  alt = "hero",
  className,
}: HeroImageProps) {
  let src: string | null = null;
  if (pubkey) {
    const q = new URLSearchParams({ v: String(level) });
    src = `/heroes/${pubkey}/image?${q.toString()}`;
  } else if (templateId != null) {
    const q = new URLSearchParams({
      preview: "1",
      template: String(templateId),
      level: String(level),
    });
    if (locked) q.set("locked", "1");
    if (threatened) q.set("threatened", "1");
    src = `/heroes/template-${templateId}/image?${q.toString()}`;
  }
  if (!src) return null;

  // eslint-disable-next-line @next/next/no-img-element -- composited route, not a static asset
  return <img src={src} alt={alt} loading="lazy" className={cn("object-cover", className)} />;
}
