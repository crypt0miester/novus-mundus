// Halo pattern dispatch. Eight kinds indexed by HaloKind.
//
// Pivoted from programmatic vector patterns to Bonsai-baked PNGs:
//   - Each kind loads images/heroes/halos/halo-<slug>.png at runtime
//   - The halo is tinted to TIER_ACCENT[tier].primary via an OFFSCREEN canvas
//     (source-atop on the main canvas would flood everything because the
//     layer-1 background is opaque black)
//   - Drawn at full canvas size centered; no rotation (rotation barely
//     reads on a near-circular ornament and the pubkey already drives
//     the halo KIND via fingerprint.haloKind)
//   - Slight alpha so the halo stays behind the silhouette visually
//   - If the PNG is missing (slice in progress, asset deleted) we fall back
//     to the programmatic concentric draw so the render never fails
//
// Bake provenance: images/halos/halos.json -> images/scripts/generate-halos.sh
// -> images/scripts/export-halos-to-app.sh.

import { createCanvas, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import path from "node:path";
import type { HaloKind } from "../fingerprint";
import { drawConcentric, type HaloDrawParams } from "./concentric";
import { loadImageCached } from "../image-cache";

const SLUG_BY_KIND: Record<HaloKind, string> = {
  0: "halo-concentric",
  1: "halo-radial-spokes",
  2: "halo-runic",
  3: "halo-voronoi",
  4: "halo-scale-mail",
  5: "halo-isohypse",
  6: "halo-herringbone",
  7: "halo-sunburst",
};

const HALO_ALPHA = 0.4;
// Inset on each side as a fraction of canvas — halo sits inside the frame
// with a clear breathing band between halo outer edge and frame inner edge.
const HALO_INSET_FRAC = 0.08;

export async function drawHalo(
  kind: HaloKind,
  ctx: SKRSContext2D,
  p: HaloDrawParams,
): Promise<void> {
  const slug = SLUG_BY_KIND[kind];
  const haloPath = path.join(process.cwd(), "public", "img", "heroes", "halos", `${slug}.png`);

  let img: Image | null = null;
  try {
    img = await loadImageCached(haloPath);
  } catch {
    // Bake not yet exported — fall back to the programmatic concentric
    // pattern so the route stays green during incremental rollout.
    drawConcentric(ctx, p);
    return;
  }

  const cx = p.centerX;
  const cy = p.centerY;
  const native = Math.min(img.width, img.height);
  const drawSize = Math.floor(native * (1 - 2 * HALO_INSET_FRAC));
  const half = drawSize / 2;

  // Offscreen canvas: tint the halo to the tier accent without polluting
  // the main canvas's source-atop pool. The main canvas already has an
  // opaque black background; running source-atop directly on it would
  // flood the entire canvas with the tint color.
  const tmp = createCanvas(drawSize, drawSize);
  const tmpCtx = tmp.getContext("2d");
  tmpCtx.drawImage(img, 0, 0, drawSize, drawSize);
  tmpCtx.globalCompositeOperation = "source-atop";
  tmpCtx.fillStyle = p.strokeColor;
  tmpCtx.fillRect(0, 0, drawSize, drawSize);

  ctx.save();
  ctx.globalAlpha = HALO_ALPHA;
  ctx.drawImage(tmp, cx - half, cy - half, drawSize, drawSize);
  ctx.restore();
}

export type { HaloDrawParams };
