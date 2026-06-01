// Server-side hero portrait compositor. No ML at request time; pulls baked
// silhouette + city sigil + ascension mark PNGs off disk and layers them with
// @napi-rs/canvas. See docs/design/HERO_PORTRAITS.md §4 for the layer stack.
//
// Layers shipped: 1 background, 4 silhouette (Bonsai), 5 city sigil (Bonsai,
// cairn fallback), 7 buff icons (existing webp), 9 ascension marks (Bonsai),
// 10 state glow (programmatic). Halo (3) and frame (8) layers were removed;
// layer 6 category banner deferred.

import { createCanvas, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import path from "node:path";
import { BG_SOLID, STATE_GLOW, TIER_ACCENT, type HeroTier } from "./palette";
import type { CompositionParams } from "./fingerprint";
import { BUFF_SLUG } from "./template-map";
import { loadImageCached } from "./image-cache";

export interface ComposeInput {
  templateId: number;
  tier: HeroTier;
  level: number;
  locked: boolean;
  /** Hero in low-HP / active combat state. Slice 0 always passes false. */
  threatened?: boolean;
  /** BuffStat ids (1..18), up to 4. */
  buffs: number[];
  /** meditation_city_id from template; 0 = "everywhere" cairn fallback. */
  meditationCity: number;
  params: CompositionParams;
}

const CANVAS_SIZE = 1024;

// Figure fills the central 70% — 15% padding each side.
const SILHOUETTE_INSET_FRAC = 0.15;

const BUFF_ICON_SIZE = 80;
const BUFF_ICON_RIGHT_INSET = 32;
const BUFF_ICON_VGAP = 10;

const STATE_GLOW_INSET = 4;
const STATE_GLOW_WIDTH = 4;
const STATE_GLOW_BLUR = 24;

// Ascension marks — pure single-tier display. At any level the portrait
// shows marks from ONE tier only, never mixed. Reaching a tier boundary
// upgrades to the next tier (replaces, never accumulates "1 silver + 1
// bronze"). Max 4 marks visible at any time.
//
//   level 1..4   -> 1..4 bronze
//   level 5..24  -> 1..4 silver        (count = floor(level / 5))
//   level 25..99 -> 1..3 gold          (count = floor(level / 25))
//   level 100    -> 1 crimson ascendant (only at cap)
//
// Note: levels within a tier band (e.g. 6, 7, 8, 9 all show 1 silver) are
// visually identical. That's intentional — the marks signal investment
// tier, not precise level. The hero's actual numeric level lives in the
// surrounding UI text.
//
// Marks render in their *natural* tier color (bronze / silver / gold /
// crimson), independent of the hero's own tier accent — they communicate
// investment, not rank. Higher-tier marks render larger so each upgrade
// reads visually as a step up.
// Marks render as a horizontal row at the TOP-RIGHT corner. Right-aligned
// so the row extends leftward as more marks unlock; never crosses the right
// rim's buff column (buffs are vertically centered, marks live above them).
const MARK_GAP = 12;
const MARK_RIGHT_INSET = 32;
const MARK_TOP_INSET = 32;
const MARK_TIER_SIZE: Record<1 | 2 | 3 | 4, number> = {
  1: 64, // bronze
  2: 96, // silver
  3: 128, // gold
  4: 128, // crimson
};
// One representative mark PNG per tier — picked as the most ornate in each
// group. Marks render in their native Bonsai color (no runtime tint).
// The other 12 baked marks are unused for now (kept as alternates).
const MARK_TIER_PNG: Record<1 | 2 | 3 | 4, number> = {
  1: 4, // mark-04-bronze-knot
  2: 8, // mark-08-silver-laurel-wreath
  3: 12, // mark-12-gold-lion-head
  4: 16, // mark-16-crimson-ascendant-star
};

// City sigil — bottom-left medallion. Sized to read against the halo behind
// it; Bonsai sigils carry significant transparent margin around the emblem
// (post-trim), so the displayed glyph is ~60% of this dimension.
const SIGIL_SIZE = 220;
const SIGIL_LEFT_INSET = 16;
const SIGIL_BOTTOM_INSET = 16;

const CAIRN_FALLBACK = "img/icons/game/sanctuary-meditation@2x.webp";

export async function composeHeroImage(input: ComposeInput): Promise<Buffer> {
  const canvas = createCanvas(CANVAS_SIZE, CANVAS_SIZE);
  const ctx = canvas.getContext("2d");

  drawBackground(ctx);
  // Halo layer removed (user 2026-06-01): the ring/aura behind the figure read
  // as ugly. Tier now reads through the silhouette underglow + sigil + marks.
  void input.params.haloKind;
  void input.params.haloSeed;
  await drawSilhouette(ctx, input.templateId, input.tier, input.params);
  await drawCitySigil(ctx, input.meditationCity, input.tier);
  await drawBuffIcons(ctx, input.buffs, input.params.buffNudges);
  await drawAscensionMarks(ctx, input.level);
  drawStateGlow(ctx, input.locked, input.threatened ?? false);

  // Frame layer removed (user 2026-05-28) and halo removed (2026-06-01): tier
  // now reads through the silhouette underglow + sigil + buff icons alone.
  void input.params.cornerVariant;

  return canvas.toBuffer("image/png");
}

function drawBackground(ctx: SKRSContext2D): void {
  ctx.fillStyle = BG_SOLID;
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
}

async function drawSilhouette(
  ctx: SKRSContext2D,
  templateId: number,
  tier: HeroTier,
  params: CompositionParams,
): Promise<void> {
  const silhouettePath = appPath("img", "heroes", "templates", `${templateId}.png`);
  const size = CANVAS_SIZE * (1 - 2 * SILHOUETTE_INSET_FRAC);
  const off = CANVAS_SIZE * SILHOUETTE_INSET_FRAC;

  let img: Image | null = null;
  try {
    img = await loadImageCached(silhouettePath);
  } catch {
    ctx.save();
    ctx.strokeStyle = TIER_ACCENT[tier].bright;
    ctx.lineWidth = 2;
    ctx.strokeRect(off, off, size, size);
    ctx.restore();
    return;
  }

  ctx.save();
  if (params.flipX || params.rotateDeg !== 0) {
    ctx.translate(CANVAS_SIZE / 2, CANVAS_SIZE / 2);
    if (params.flipX) ctx.scale(-1, 1);
    if (params.rotateDeg !== 0) {
      ctx.rotate((params.rotateDeg * Math.PI) / 180);
    }
    ctx.translate(-CANVAS_SIZE / 2, -CANVAS_SIZE / 2);
  }
  ctx.shadowColor = TIER_ACCENT[tier].bright;
  ctx.shadowBlur = 32;
  ctx.drawImage(img, off, off, size, size);
  ctx.restore();
}

async function drawCitySigil(
  ctx: SKRSContext2D,
  cityId: number,
  tier: HeroTier,
): Promise<void> {
  // City 0 (the "everywhere" sentinel) reuses the existing cairn icon.
  const primaryPath =
    cityId === 0
      ? appPath(CAIRN_FALLBACK)
      : appPath("img", "heroes", "city-sigils", `${cityId}.png`);

  let img: Image | null = null;
  try {
    img = await loadImageCached(primaryPath);
  } catch {
    // Sigil not baked yet — fall back to the cairn icon.
    try {
      img = await loadImageCached(appPath(CAIRN_FALLBACK));
    } catch {
      return;
    }
  }

  const tinted = tintToColor(img, TIER_ACCENT[tier].bright, SIGIL_SIZE);
  const x = SIGIL_LEFT_INSET;
  const y = CANVAS_SIZE - SIGIL_SIZE - SIGIL_BOTTOM_INSET;
  // Sigil draws upright — the per-hero rotation read as arbitrary/ugly.
  ctx.drawImage(tinted, x, y);
}

async function drawBuffIcons(
  ctx: SKRSContext2D,
  buffs: number[],
  nudges: ReadonlyArray<number>,
): Promise<void> {
  if (buffs.length === 0) return;
  const visible = buffs.slice(0, 4);
  const totalH = visible.length * BUFF_ICON_SIZE + (visible.length - 1) * BUFF_ICON_VGAP;
  const startY = (CANVAS_SIZE - totalH) / 2;
  const x = CANVAS_SIZE - BUFF_ICON_RIGHT_INSET - BUFF_ICON_SIZE;

  for (let i = 0; i < visible.length; i++) {
    const slug = BUFF_SLUG[visible[i]];
    if (!slug) continue;
    const iconPath = appPath("img", "icons", "game", `buff-${slug}@2x.webp`);
    let icon: Image;
    try {
      icon = await loadImageCached(iconPath);
    } catch {
      continue;
    }
    const y = startY + i * (BUFF_ICON_SIZE + BUFF_ICON_VGAP);
    const nudge = nudges[i] ?? 0;
    ctx.drawImage(icon, x, y + nudge, BUFF_ICON_SIZE, BUFF_ICON_SIZE);
  }
}

async function drawAscensionMarks(ctx: SKRSContext2D, level: number): Promise<void> {
  if (level < 1) return;

  // Pick the single tier and count for this level.
  let tier: 1 | 2 | 3 | 4;
  let count: number;
  if (level >= 100) {
    tier = 4;
    count = 1;
  } else if (level >= 25) {
    tier = 3;
    count = Math.floor(level / 25); // 1..3
  } else if (level >= 5) {
    tier = 2;
    count = Math.floor(level / 5); // 1..4
  } else {
    tier = 1;
    count = level; // 1..4
  }

  if (count === 0) return;

  const sz = MARK_TIER_SIZE[tier];
  const totalW = count * sz + (count - 1) * MARK_GAP;
  // Right-aligned: rightmost mark touches the right inset; row grows left.
  const startX = CANVAS_SIZE - MARK_RIGHT_INSET - totalW;
  const y = MARK_TOP_INSET;

  const markPath = appPath("img", "heroes", "marks", `${MARK_TIER_PNG[tier]}.png`);
  let img: Image | null = null;
  try {
    img = await loadImageCached(markPath);
  } catch {
    return;
  }

  for (let i = 0; i < count; i++) {
    const x = startX + i * (sz + MARK_GAP);
    ctx.drawImage(img, x, y, sz, sz);
  }
}

function drawStateGlow(ctx: SKRSContext2D, locked: boolean, threatened: boolean): void {
  if (!locked && !threatened) return;
  const color = threatened ? STATE_GLOW.threatened : STATE_GLOW.locked;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = STATE_GLOW_WIDTH;
  ctx.shadowColor = color;
  ctx.shadowBlur = STATE_GLOW_BLUR;
  ctx.strokeRect(
    STATE_GLOW_INSET,
    STATE_GLOW_INSET,
    CANVAS_SIZE - 2 * STATE_GLOW_INSET,
    CANVAS_SIZE - 2 * STATE_GLOW_INSET,
  );
  ctx.restore();
}

// Helpers

function appPath(...parts: string[]): string {
  return path.join(process.cwd(), "public", ...parts);
}

// Returns an offscreen canvas of `size`×`size` containing `img` tinted to
// `color` via source-atop. Used for any layer whose bake is monochrome and
// needs to be re-colored per tier (sigils, marks). Frames and halos handle
// their own tinting (halos in halo/index.ts; frames are pre-baked per tier).
function tintToColor(img: Image, color: string, size: number): import("@napi-rs/canvas").Canvas {
  const tmp = createCanvas(size, size);
  const tmpCtx = tmp.getContext("2d");
  tmpCtx.drawImage(img, 0, 0, size, size);
  tmpCtx.globalCompositeOperation = "source-atop";
  tmpCtx.fillStyle = color;
  tmpCtx.fillRect(0, 0, size, size);
  return tmp;
}
