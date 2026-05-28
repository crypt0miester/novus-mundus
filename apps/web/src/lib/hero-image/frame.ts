// Tier frames — one Bonsai-baked PNG per tier.
//
// Pivoted from programmatic vector strokes to Bonsai-baked PNGs:
//   - Each tier loads images/heroes/frames/frame-<slug>.png (baked in its
//     own tier color, so no runtime tint needed — unlike halos)
//   - Drawn at full canvas size centered
//   - If the PNG is missing (slice in progress, asset deleted), the
//     programmatic fallback strokes a vector frame so the route stays green
//
// Bake provenance: images/frames/frames.json -> images/scripts/generate-frames.sh
// -> images/scripts/export-frames-to-app.sh.

import {
  loadImage,
  type Image,
  type SKRSContext2D,
} from "@napi-rs/canvas";
import path from "node:path";
import { TIER_ACCENT, type HeroTier } from "./palette";

const SLUG_BY_TIER: Record<HeroTier, string> = {
  0: "frame-common",
  1: "frame-rare",
  2: "frame-epic",
  3: "frame-legendary",
  4: "frame-mythic",
};

export interface FrameDrawParams {
  size: number;
  cornerVariant: 0 | 1 | 2 | 3;
}

export async function drawFrame(
  ctx: SKRSContext2D,
  tier: HeroTier,
  p: FrameDrawParams,
): Promise<void> {
  const slug = SLUG_BY_TIER[tier];
  const framePath = path.join(
    process.cwd(),
    "public",
    "img",
    "heroes",
    "frames",
    `${slug}.png`,
  );

  let img: Image | null = null;
  try {
    img = await loadImageCached(framePath);
  } catch {
    drawProgrammaticFrame(ctx, tier, p);
    return;
  }

  ctx.drawImage(img, 0, 0, p.size, p.size);
  void p.cornerVariant;
}

const FRAME_INSET = 12;

function drawProgrammaticFrame(
  ctx: SKRSContext2D,
  tier: HeroTier,
  p: FrameDrawParams,
): void {
  ctx.save();

  const accent = TIER_ACCENT[tier];
  const size = p.size;
  const inset = FRAME_INSET;

  switch (tier) {
    case 0:
      ctx.strokeStyle = accent.primary;
      ctx.lineWidth = 1;
      ctx.strokeRect(inset, inset, size - 2 * inset, size - 2 * inset);
      break;

    case 1:
      ctx.strokeStyle = accent.primary;
      ctx.lineWidth = 2;
      ctx.strokeRect(inset, inset, size - 2 * inset, size - 2 * inset);
      ctx.lineWidth = 1;
      ctx.strokeRect(
        inset + 4,
        inset + 4,
        size - 2 * inset - 8,
        size - 2 * inset - 8,
      );
      break;

    case 2:
      ctx.strokeStyle = accent.primary;
      ctx.lineWidth = 3;
      ctx.strokeRect(inset, inset, size - 2 * inset, size - 2 * inset);
      drawCornerMarks(ctx, inset, size, accent.bright, 6);
      break;

    case 3: {
      ctx.strokeStyle = accent.primary;
      ctx.lineWidth = 3;
      ctx.strokeRect(inset, inset, size - 2 * inset, size - 2 * inset);
      ctx.strokeRect(
        inset + 8,
        inset + 8,
        size - 2 * inset - 16,
        size - 2 * inset - 16,
      );
      const inlay = accent.inlay;
      if (inlay) {
        ctx.strokeStyle = inlay;
        ctx.lineWidth = 1;
        ctx.strokeRect(
          inset + 4,
          inset + 4,
          size - 2 * inset - 8,
          size - 2 * inset - 8,
        );
      }
      drawCornerMarks(ctx, inset, size, accent.bright, 9);
      break;
    }

    case 4: {
      ctx.strokeStyle = accent.primary;
      ctx.lineWidth = 5;
      ctx.strokeRect(inset, inset, size - 2 * inset, size - 2 * inset);
      const inlay = accent.inlay;
      if (inlay) {
        ctx.strokeStyle = inlay;
        ctx.lineWidth = 1;
        ctx.strokeRect(
          inset + 6,
          inset + 6,
          size - 2 * inset - 12,
          size - 2 * inset - 12,
        );
      }
      drawCornerMarks(ctx, inset, size, inlay ?? accent.bright, 14);
      break;
    }
  }

  ctx.restore();
  void p.cornerVariant;
}

function drawCornerMarks(
  ctx: SKRSContext2D,
  inset: number,
  size: number,
  color: string,
  markSize: number,
): void {
  ctx.save();
  ctx.fillStyle = color;
  const positions: Array<[number, number]> = [
    [inset, inset],
    [size - inset - markSize, inset],
    [inset, size - inset - markSize],
    [size - inset - markSize, size - inset - markSize],
  ];
  for (const [x, y] of positions) {
    ctx.fillRect(x, y, markSize, markSize);
  }
  ctx.restore();
}

const imageCache = new Map<string, Image>();

async function loadImageCached(p: string): Promise<Image> {
  const cached = imageCache.get(p);
  if (cached) return cached;
  const img = await loadImage(p);
  imageCache.set(p, img);
  return img;
}
