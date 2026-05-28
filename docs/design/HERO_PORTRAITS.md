# Hero Portraits — Procedural Template Pipeline

Status: slice 0 shipped (20 of 79 heroes baked + integrated).
Last touched: 2026-05-28.

> ### Slice-0 changelog (vs original design)
>
> What shipped diverges from the initial proposal in a few places. **The current
> compositor is the source of truth**; this section is a quick "what changed":
>
> - **Frame layer dropped** (§5) — Bonsai's tier-frame bakes had wildly variable
>   thickness across tiers, and tier was already conveyed by halo tint +
>   silhouette underglow + sigil + buff tint. Frame ornaments competed with the
>   halo for the same "ring around the figure" job. Five frame PNGs remain
>   baked at `apps/web/public/img/heroes/frames/` as dead assets but no layer
>   loads them.
> - **Constellation layer dropped** (§4 layer 2) — programmatic dots felt
>   noisy and didn't add signal once the Bonsai halo was rich.
> - **Ascension marks rewritten** (§4 layer 9 / new §4.1) — switched from "16
>   slots, fill in order" to a base-5 collapse system: at any level the
>   portrait shows ONE tier of marks only (1-4 bronze → 1-4 silver → 1-3 gold
>   → 1 crimson ascendant at level 100). Always ≤ 4 marks visible. Mark size
>   grows by tier (bronze 64 px → crimson 148 px) so each upgrade reads
>   visually.
> - **Layout pinned** — sigil bottom-left (220 px), buffs right rim, marks
>   top-right horizontal row. Halo at 40 % opacity so silhouette + marks
>   read cleanly.
> - **Image cache uses file mtime** (new `lib/hero-image/image-cache.ts`) —
>   one `fs.stat` per lookup, invalidates automatically when an asset is
>   re-baked. No more `pkill next dev` after every export.
> - **All 30 Bonsai layer bakes shipped**: 8 halos, 17 city sigils, 16
>   ascension marks (+ 5 unused frames). Plus 20 silhouettes (5 slice-0 +
>   15 expansion batch).

This document specifies how each minted Hero NFT is rendered as a square portrait
served from `/api/hero/image/<hero_pubkey>`. The system is **procedural by
template**: ~79 base silhouettes are generated **once at build time** by
[Bonsai-Image-4B](https://prismml.com/news/bonsai-image-4b) — a 4B-parameter
diffusion transformer derived from FLUX.2 Klein 4B and quantized for local
inference, released by Prism-ML under Apache 2.0 ([HF
collection](https://huggingface.co/collections/prism-ml/bonsai-image)). The
per-instance portrait is **composited at request time** from those templates
plus deterministic overlays driven by the hero's pubkey and on-chain state.
No ML at request time, no API quotas, no per-image cost.

The catalog itself (the 79 hero names, tiers, buffs, meditation cities) lives in
[`docs/HERO_GALLERY.md`](../HERO_GALLERY.md) and
[`sdks/novus-mundus-ts-kit/cli/data/heroes.ts`](../../sdks/novus-mundus-ts-kit/cli/data/heroes.ts);
this doc is only about how those heroes are *drawn*.

---

## 1. Goals & non-goals

**Goals.**
1. One portrait per minted hero, **provably unique** per pubkey, **on-brand** to
   the Novus Mundus black-and-gold visual language.
2. **Constant build cost** as hero supply grows: O(templates) ML calls, not
   O(mints). Adding a hero is a row in a JSON manifest + one Bonsai run.
3. **Runtime cost ≪ ML**: the image route is pure server-side compositing
   (target p50 < 30 ms cold, < 5 ms warm via CDN). Edge-compatible on Node.
4. **Stable & cacheable**: identical inputs → byte-identical PNG. Strong ETag,
   long CDN max-age, level-bump invalidates with `?v=<level>` from clients.
5. **Readable at a glance**: a player should be able to look at the portrait
   and immediately identify *what the hero is*, *what tier it is*, *which
   buffs it grants*, and *which city it meditates in*.

**Non-goals.**
- Photorealism, faces, or per-instance ML generation.
- Any pubkey-driven hue/saturation rotation — palette discipline overrides
  visual entropy (see §3).
- View-dependent rendering (the route is stateless w.r.t. the viewing player).

---

## 2. Architecture overview

```
            BUILD TIME (one-shot, re-run when heroes.json changes)
   ┌─────────────────────────────────────────────────────────────────┐
   │  images/heroes/heroes.json   (manifest: id, templateId, seed,    │
   │                               tier, category, subject)           │
   │                          │                                       │
   │                          ▼                                       │
   │  images/scripts/generate-heroes.sh                               │
   │     ↓ HTTP → local Bonsai FastAPI (http://localhost:8000)        │
   │  images/heroes/raw/<id>.png    (1024² faceless silhouette PNG)   │
   │                          │                                       │
   │                          ▼                                       │
   │  images/scripts/export-heroes-to-app.sh                          │
   │     · alpha-strip the solid-white background                     │
   │     · trim + recenter on transparent 1024² canvas                │
   │     · (no tint here — runtime applies tier wash via canvas)      │
   │  apps/web/public/img/heroes/templates/<templateId>.png           │
   └─────────────────────────────────────────────────────────────────┘

            RUNTIME (per request, no ML)
   ┌─────────────────────────────────────────────────────────────────┐
   │  GET /api/hero/image/<pubkey>?v=<level>                          │
   │                          │                                       │
   │                          ▼                                       │
   │  fetchHero(pubkey) → { templateId, tier, level, locked }         │
   │  fingerprintFromPubkey(pubkey.toBytes()) → composition params    │
   │                          │                                       │
   │                          ▼                                       │
   │  compose(@napi-rs/canvas):                                       │
   │    background → constellation → halo → silhouette →              │
   │    city sigil → category banner → buff icons → frame →           │
   │    level marks → state glow                                      │
   │                          │                                       │
   │                          ▼                                       │
   │  PNG (1024², ~80–200 KB) + strong ETag + long Cache-Control      │
   └─────────────────────────────────────────────────────────────────┘
```

The compositor uses [`@napi-rs/canvas`](https://github.com/Brooooooklyn/canvas)
(chosen over `sharp` because halos are drawn directly with vector primitives
rather than pre-baked PNGs — see §4).

---

## 3. The pinned palette

The Novus Mundus theme (`apps/web/src/app/globals.css`) is aggressively
monochromatic: **solid black backgrounds, antique gold reliefs, with a
controlled tier accent ladder** (bronze → gold → crimson). Hero portraits
inherit this palette verbatim — **the pubkey never drives color**, only
composition.

```ts
// apps/web/src/lib/hero-image/palette.ts
//
// Hero-tier accent ladder. Identical lineage to the subscription tier ladder
// in globals.css, so portraits read as part of the same family as the rest
// of the app.

export const TIER_ACCENT = {
  // Common (tier 0): antique gold — the icon-system baseline.
  0: { primary: "#C9A961", bright: "#dbc185" },
  // Rare (tier 1): bronze — matches subscription tier 1.
  1: { primary: "#CD7F32", bright: "#D4944A" },
  // Epic (tier 2): sovereign gold — matches subscription tier 2.
  2: { primary: "#daa520", bright: "#f1af09" },
  // Legendary (tier 3): bright gold + crimson hairline inlay below.
  3: { primary: "#f1af09", bright: "#fde047", inlay: "#9a2222" },
  // Mythic (tier 4): crimson + bright gold heraldry. Top of the ladder.
  4: { primary: "#8B1A1A", bright: "#9a2222", inlay: "#f1af09" },
} as const;

export const STATE_GLOW = {
  // Hero is locked (in expedition, on castle defense, etc.).
  // Cairn 'working' from globals.css.
  locked: "#b07d2b",
  // Hero is in a threatened combat state (e.g. low HP mid-encounter).
  // Cairn 'threatened' from globals.css.
  threatened: "#a23a2c",
} as const;

export const BG_SOLID  = "#000000";  // matches every existing icon background
export const STAR_TINT = "#C9A961";  // constellation dots @ 4–12% alpha
```

There is no "at-home" glow in the canonical portrait — the hero's
**meditation city sigil is permanently embedded** as a layer (§4 layer 5), so
identity-of-origin is always visible regardless of viewer. The view-dependent
"you are in this hero's home city right now" affordance, if we want it, is a
CSS shadow applied by the client over the `<img>` element, not a server-side
re-render.

---

## 4. Layer composition stack

Final canvas: **1024 × 1024 RGBA PNG**. All overlays composite with
`source-over` unless noted.

```
 ┌────────────────────────────────────────────────────────────────┐
 │  LAYER 10  outer state glow (locked / threatened only)         │
 │ ┌────────────────────────────────────────────────────────────┐ │
 │ │  LAYER 8   tier frame (5 variants, drawn vector)           │ │
 │ │ ┌────────────────────────────────────────────────────────┐ │ │
 │ │ │       L6 category banner                                │ │ │
 │ │ │ ┌──────┐                                  ┌──────────┐ │ │ │
 │ │ │ │ glyph│                                  │ L7 buff  │ │ │ │
 │ │ │ └──────┘                                  │   icon 1 │ │ │ │
 │ │ │           ┌──────────────────────┐        ├──────────┤ │ │ │
 │ │ │           │                      │        │ L7 buff  │ │ │ │
 │ │ │           │   LAYER 4            │        │   icon 2 │ │ │ │
 │ │ │           │   silhouette         │        ├──────────┤ │ │ │
 │ │ │           │   (faceless,         │        │ L7 buff  │ │ │ │
 │ │ │           │    duotone tint)     │        │   icon 3 │ │ │ │
 │ │ │           │                      │        ├──────────┤ │ │ │
 │ │ │           │                      │        │ L7 buff  │ │ │ │
 │ │ │           └──────────────────────┘        │   icon 4 │ │ │ │
 │ │ │  L3 halo ring (1 of 8 generative patterns)└──────────┘ │ │ │
 │ │ │  L2 constellation field (8–16 dots, pubkey-derived)     │ │ │
 │ │ │  L1 solid black background #000000                      │ │ │
 │ │ │                                                          │ │ │
 │ │ │           ┌──────────────────────┐                       │ │ │
 │ │ │           │ L5 meditation city   │                       │ │ │
 │ │ │           │    sigil             │                       │ │ │
 │ │ │           └──────────────────────┘                       │ │ │
 │ │ │      L9 level marks · · · · · · · · · ·                  │ │ │
 │ │ └────────────────────────────────────────────────────────┘ │ │
 │ └────────────────────────────────────────────────────────────┘ │
 └────────────────────────────────────────────────────────────────┘
```

**Layer table (as shipped — see changelog at top):**

| # | Layer | Source | Color | Position | Driven by |
|---|-------|--------|-------|----------|-----------|
| 1 | Background | `fillRect` | `#000000` | full canvas | constant |
| ~~2~~ | ~~Constellation~~ | DROPPED — noisy once Bonsai halo landed | | | |
| 3 | Halo | `/img/heroes/halos/halo-<kind>.png` (1 of 8) tinted to tier via offscreen canvas | `TIER_ACCENT[tier].primary`, **40% alpha** | centered, 8% inset | tier (color) + pubkey bytes 0..1 (which kind) |
| 4 | Silhouette | `/img/heroes/templates/<templateId>.png` | native (deep-black body + antique-gold rim from Bonsai) + tier-bright shadow underglow | central 70% (15% inset) | templateId |
| 5 | Meditation city sigil | `/img/heroes/city-sigils/<cityId>.png` tinted to tier-bright | `TIER_ACCENT[tier].bright` | **bottom-left, 220 px** | template's `meditationCityId` (cairn fallback if `0` or missing) |
| ~~6~~ | ~~Category banner~~ | deferred (not in slice 0) | | | |
| 7 | Buff icons (1–4) | `/img/icons/game/buff-*@2x.webp` | as authored | right rim, vertically centered, 80 px each | template's `buffs[]` |
| ~~8~~ | ~~Tier frame~~ | DROPPED — see changelog | | | |
| 9 | Ascension marks (1–4) | `/img/heroes/marks/<n>.png` (1 of 16) | native Bonsai gold; size varies by tier (64 / 96 / 128 / 148 px) | **top-right, horizontal row, right-aligned** | hero's `level` via base-5 collapse (§4.1) |
| 10 | State glow | outer rectangle stroke + shadow | `STATE_GLOW.locked` (working brown) or `STATE_GLOW.threatened` (cairn red) | canvas edge | hero's lock / combat flags; omitted when idle |

### 4.1 Ascension marks — base-5 collapse

Pure single-tier display. At any level the portrait shows marks from ONE
tier only — never mixed. Reaching a tier boundary upgrades to the next
tier (replaces, never accumulates "1 silver + 1 bronze"). Max 4 marks
visible at any time.

```
level 1..4    -> 1..4 bronze knot      (mark-04)
level 5..24   -> 1..4 silver wreath    (mark-08)   count = floor(level / 5)
level 25..99  -> 1..3 gold lion-head   (mark-12)   count = floor(level / 25)
level 100     -> 1 crimson ascendant   (mark-16) — only at cap (u8 ≤ 100 per programs/novus_mundus/src/helpers/estate.rs)
```

Mark size grows by tier (64 → 96 → 128 → 148 px) so each upgrade reads
visually as a step up. Levels within a tier band (e.g. 6, 7, 8, 9 all
show 1 silver) are intentionally identical — the marks signal investment
tier, not precise level. Precise level lives in surrounding UI text.

Layers 4–7 reuse **existing repo assets** end-to-end:

- Silhouettes: produced by the Bonsai pipeline in §6.
- City sigils: hand-authored per meditation city (§8). Twelve cities total
  (`meditationCityId 1..12`). Heroes with `meditationCityId == 0` (crypto
  icons, "everywhere") get the `sanctuary-meditation` cairn icon from the
  existing icon set as their sigil.
- Category banners: reuse the existing
  `forge-banner` / `sanctuary-banner` / `market-banner` / `barracks-banner` /
  `camp-banner` / `infirmary-banner` PNGs from
  `images/icons/raw/` (already shipped to `apps/web/public/img/icons/game/`).
  Mapping table:

  | category | banner asset |
  |----------|--------------|
  | 0 Historical    | `camp-banner` |
  | 1 Mythological  | `sanctuary-banner` |
  | 2 CryptoIcons   | `market-banner` |
  | 3 Gaming        | `barracks-banner` |
  | 4 Original      | `forge-banner` |

- Buff icons: the existing 18 relief icons at
  `apps/web/public/img/icons/game/buff-*.webp` (with `@2x` retina variants)
  map 1:1 to the `BuffStat` enum in
  `programs/novus_mundus/src/state/hero.rs` (values 1..18). For each hero we
  render the icons for its non-zero `buffs[].stat`, right-aligned along the
  right rim, top-down, 80 × 80 each. The compositor loads the `@2x` (128 px)
  variant and downsamples in canvas for a sharper edge at the target size.

---

## 5. Tier frame ornamentation — DROPPED

> **Removed in slice 0.** Bonsai's tier-frame bakes had wildly variable
> thickness across tiers (Common ~ 50 px, Mythic ~ 150 px on each side),
> which forced every other layer to be defensive about layout. And tier
> was already conveyed by halo tint + silhouette underglow + sigil + buff
> tint — the frame was duplicative ornament fighting the halo for the same
> "ring around the figure" job.
>
> The 5 frame PNGs remain baked at
> `apps/web/public/img/heroes/frames/frame-<tier>.png` as dead assets;
> `compose.ts` no longer calls `drawFrame`. To resurrect the layer:
> re-import `drawFrame` and `await drawFrame(...)` after layer 7. The
> code path is intact in `frame.ts`.

### Original design (kept for reference)

| Tier | Frame |
|------|-------|
| 0 Common | 1 px hairline border, `TIER_ACCENT[0].primary` |
| 1 Rare | 2 px double-line border, bronze, with small dot accents at corners |
| 2 Epic | thicker gold frame with quatrefoil corners, no inlay |
| 3 Legendary | gold double frame with a hairline `inlay: #9a2222` crimson line *between* the two gold strokes |
| 4 Mythic | full crimson frame, bright-gold heraldic corner cartouches drawn with the heraldic-fleur primitive |

Corner ornaments come in **4 variants per tier**; the pubkey picks one
(byte 10) so two Mythics aren't visually identical at the corners. Variants
are hand-tuned vector shapes (no ML), implemented in
`apps/web/src/lib/hero-image/frame.ts`.

---

## 6. Build-time pipeline (Bonsai)

The hero pipeline mirrors the existing icon pipeline in shape: a JSON
manifest + a `generate-*.sh` script that fans out one prompt per asset with a
stable `seed`, followed by an `export-*.sh` post-processing pass.

### 6.1 The manifest — `images/heroes/heroes.json`

```json
{
  "_comment": "Hero silhouette manifest for procedural portrait pipeline. Bonsai-generated faceless silhouettes, one per template. generate-heroes.sh reads this; export-heroes-to-app.sh post-processes raw output into apps/web/public/img/heroes/templates/. Each hero has a fixed seed so re-runs are deterministic and regenerating one hero never disturbs the rest.",

  "defaults": {
    "model":    "prism-ml/bonsai-image-ternary-4B-mlx-2bit",
    "variant":  "ternary",
    "backend":  "mlx",
    "width":    1024,
    "height":   1024,
    "steps":    28,
    "endpoint": "http://localhost:8000/generate"
  },

  "preamble": "Single game character silhouette. One isolated full-body figure, centered, no scene, no ground, no background details.",

  "style": {
    "silhouette": "Style: a single full-body faceless figure rendered as a near-black silhouette with subtle antique gold edge lighting from the upper left. ABSOLUTELY no visible face — the face is fully concealed by a helmet, mask, hood, veil, or other culturally-appropriate covering. Color: deep matte black (#0a0a0a) silhouette with antique gold (#C9A961) rim light on a pure solid white (#FFFFFF) background, so the figure can be cleanly alpha-keyed off the white background in post-processing."
  },

  "tail": "Composition: perfectly centered, square 1:1, the figure fills roughly the central 70% of the frame on a clean uniform solid white background. Figure only — absolutely no text, no letters, no numbers, no scene, no decoration, no shadow on the ground.",

  "heroes": [
    {
      "id":           "tpl-001-roman-centurion",
      "templateId":   1,
      "tier":         0,
      "category":     0,
      "seed":         2001,
      "subject":      "A Roman centurion, planted firmly with both feet apart and shoulders broad; the face entirely concealed by a transverse-crested galea, the visor a single dark band; wearing lorica segmentata in fluted steel bands; gladius lowered at the hip; scutum slung at the back."
    },
    {
      "id":           "tpl-010-alexander-the-great",
      "templateId":   10,
      "tier":         1,
      "category":     0,
      "seed":         2010,
      "subject":      "A Macedonian king, in a regal upright stance with the chin slightly raised and one hand on the hip; the face entirely concealed by a tall plumed Phrygian helmet whose brow band casts full shadow over the face; wearing a scaled linothorax over a short tunic; kopis sword raised high in the right hand; military cloak swept dramatically behind."
    },
    {
      "id":           "tpl-155-paper-hands",
      "templateId":   155,
      "tier":         0,
      "category":     2,
      "seed":         2155,
      "subject":      "A hooded crypto trader, in a watchful stance with the body half-turned and the head slightly inclined; the face entirely concealed by a deep merchant's cowl pulled low and a folded paper bandana drawn up over the mouth; wearing a worn long merchant's coat with a wide sash; two limp parchments held forward in one hand; a battered courier satchel hung at the hip."
    }
  ]
}
```

> **All `subject` strings must follow the §6.5 grammar.** The three samples
> above are grammar-conformant.

`templateId` is the stable on-chain key (the same `u16` used by
`HeroTemplate::template_id` in `state/hero.rs`). `id` is the file-system slug
used for raw output paths. `seed` is a stable integer per template, chosen to
make re-runs of one template deterministic without disturbing the others (same
discipline as `images/icons/icons.json`).

The full prompt sent to Bonsai is constructed exactly like `generate-icons.sh`:

```
<preamble> <subject> <style.silhouette> <tail>
```

### 6.2 The generator — `images/scripts/generate-heroes.sh`

Bash, mirrors `generate-icons.sh`. Reads the manifest with `jq`, POSTs each
hero to the local Bonsai FastAPI server, writes raw 1024 px PNG to
`images/heroes/raw/<id>.png`.

```bash
# Usage:
#   ./generate-heroes.sh                                   # every hero, canonical (ternary) bake
#   ./generate-heroes.sh tpl-001-roman-centurion           # one by id
#   ./generate-heroes.sh --variant binary tpl-001-...      # fast-iteration bake (binary)
#   FORCE=1 ./generate-heroes.sh                           # re-generate even if raw exists
#   BONSAI_URL=http://10.0.0.5:8000 ./generate-heroes.sh   # second Mac on the LAN
#
# Requires: jq, curl, a local Bonsai-image-demo server (Apple Silicon, MLX).
# Bonsai endpoint defaults to manifest's defaults.endpoint (http://localhost:8000).
# Variant defaults to manifest's defaults.variant (ternary).
```

Bonsai's FastAPI request shape (confirmed against
[`scripts/send_request.sh`](https://github.com/PrismML-Eng/Bonsai-image-demo/blob/main/scripts/send_request.sh)):

```
POST /generate
Content-Type: application/json
Max-Time: 600s

{ "prompt": "<full prompt>", "seed": 2001, "steps": 28, "width": 1024, "height": 1024 }

→ HTTP 200, Content-Type: image/png
  (response body is raw PNG bytes — no JSON wrapper, no base64)
```

The generator writes the response body straight to
`images/heroes/raw/<id>.png` with `curl -o`. No JSON parsing, no base64
decode. Re-running on an existing file is a no-op unless `FORCE=1`.

`steps` defaults to 28 (a reasonable Flux denoising count at 1024² for both
ternary and binary checkpoints). Iterate by passing `--steps N` to
`generate-heroes.sh` if a particular hero needs more refinement; the chosen
value can also be pinned per-hero in the manifest by adding a `steps:` field
to that entry, which overrides `defaults.steps`.

### 6.3 The exporter — `images/scripts/export-heroes-to-app.sh`

Post-processes raw Bonsai output into app-ready silhouettes. Mirrors
`export-icons-to-app.sh`. Per hero:

1. **Alpha-strip the solid white background.** ImageMagick `-fuzz 14%` on
   `#FFFFFF` → transparent. Tuned with `PNG_FUZZ` env var like the icon
   pipeline.
2. **Trim & recenter** to 1024² transparent canvas (so all templates share
   aspect).
3. **Write to** `apps/web/public/img/heroes/templates/<templateId>.png`.

No duotone or tier tint is applied at this stage. The silhouette keeps its
native colors (deep-black body + antique-gold rim from Bonsai) and the
tier-accent ramp is layered on at runtime by the compositor (§4 layer 4 +
`compose.ts`). That gives us one bake artifact per template; changing a
tier accent never requires re-baking, and we can preview a hero at every
tier without 5× the disk.

The exporter is idempotent and per-hero — adding one hero re-runs only one
PNG.

### 6.4 The Bonsai server (operator setup — Apple Silicon)

This pipeline targets **Apple Silicon exclusively** via the MLX backend
(`mflux`). Bonsai-Image-4B is Apache-2.0 and fully OSS — no token, no
gating, no rate limits, no per-image cost. Operators stand up the FastAPI
server from a
[Bonsai-image-demo](https://github.com/PrismML-Eng/Bonsai-image-demo)
checkout and the generator script points at it:

```bash
# In a Bonsai-image-demo checkout:
./scripts/serve.sh --variant ternary --port 8000
```

Re-running the whole catalog is a hardware-bound batch job; nothing leaves
the machine.

#### MLX checkpoints we use

The HF collection ships six checkpoints; we use **two of them**, both Apple-
Silicon MLX, both 4B parameters, both derived from FLUX.2 Klein 4B:

| HF id | quant | bits/weight | xfm size | quality vs FLUX.2 Klein 4B | use |
|-------|-------|-------------|----------|-----------------------------|-----|
| `prism-ml/bonsai-image-ternary-4B-mlx-2bit` | ternary | 1.71  | 1.21 GB | 95% | **canonical builds** |
| `prism-ml/bonsai-image-binary-4B-mlx-1bit`  | binary  | 1.125 | 0.93 GB | 88% | fast prompt iteration |

The other four checkpoints (`gemlite-*` for CUDA, `*-unpacked` reference
float) are not used by this pipeline. If we ever need a regression
comparison against the unquantized reference, we can pull
`prism-ml/bonsai-image-ternary-4B-unpacked` ad-hoc — it isn't part of the
canonical bake.

**Authoring workflow**: iterate on a hero's prompt under binary
(`--variant binary` flag to `generate-heroes.sh`) for fast turnaround, then
re-bake the final asset under ternary (default) before committing the raw
PNG. Convention only — there's no automated gate; reviewer eyeballs the
silhouette and re-bakes if anything looks like an iteration leftover.

#### Speed expectations on Apple Silicon (Prism-ML's published numbers)

| hardware | resolution | per-image |
|----------|------------|-----------|
| Mac M4 Pro          | 512²  | ~6 s |
| Mac M4 Pro          | 1024² | ~15–25 s (extrapolated; Flux resolution scaling is sub-linear) |
| iPhone 17 Pro Max   | 512²  | ~9.4 s (not part of the build pipeline; listed for context) |

At **1024² ternary on a Mac M4 Pro**, the full 79-hero catalog bakes in
roughly **20–30 minutes**. A single hero re-bake is sub-minute. This is the
budget the rest of the design assumes: cheap enough to re-run the catalog
when the style block changes, fast enough that hero-by-hero prompt
iteration is interactive.

#### Memory budget

Mean-active unified-memory use during inference is **1.5–1.96 GB at 512²**
and **1.95–2.38 GB at 1024²** (Prism-ML figures). Any Mac with ≥ 16 GB
unified memory has comfortable headroom alongside the OS and editor; 8 GB
machines will work but should close other apps during the bake.

### 6.5 Subject grammar — the theme

Bonsai (Flux) is highly sensitive to prompt structure: same skeleton → same
framing, same lighting, same density of detail. The roster must read as one
cohesive set, so the `subject` field in `heroes.json` is **not freeform** — it
follows a strict six-slot grammar. The visual style block (`style.silhouette`),
the `preamble`, and the `tail` lock the *visual* theme (palette, framing,
faceless rule, no-background rule); this grammar locks the *content* theme
(stance, dress, gear) so each hero is the same camera, same pose family, same
articulation level — only the cultural specifics change.

#### 6.5.1 The grammar

Every `subject` string is exactly this sentence:

```
A <NAMED_ARCHETYPE>, <STANCE>; the face entirely concealed by <HEAD_COVER>;
wearing <TORSO>; <PRIMARY_ITEM>; <SECONDARY_ITEM>.
```

Six slots. Five are filled from controlled vocabularies (§6.5.3 – §6.5.6).
Only one — `NAMED_ARCHETYPE` — is unique per hero.

The punctuation is part of the grammar: semicolons separate phrases so Bonsai
attends to each slot as a distinct directive. Do **not** rephrase, merge, or
re-order slots.

#### 6.5.2 Slot 1 — `NAMED_ARCHETYPE`

A short noun phrase identifying the character's culture and role. This is the
**only** slot that varies freely across heroes. Examples drawn from the
existing 79-hero catalog:

- Historical: "Roman centurion", "Macedonian king", "Norse raider",
  "Silk Road merchant", "Spartan hoplite", "Edo-era ronin",
  "Byzantine cataphract".
- Mythological: "Olympian thunderbearer", "underworld ferryman",
  "Norse all-father", "winged messenger of the gods".
- CryptoIcons: "hooded crypto trader", "diamond-bearer",
  "cypherpunk operator", "rugpull villain".
- Gaming: "armored plumber-knight", "green-clad swordbearer",
  "barrel-throwing simian warlord".
- Original: "Cairn-walker pilgrim", "Sanctuary warden",
  "Forge-marked smith-knight".

Style notes for this slot: short (2–4 words), noun-phrase, no proper names of
*real people* in the prompt itself — those are conveyed by the gear and
helmet description, not the name. ("A Macedonian king" rather than
"Alexander the Great", because Flux models trained on Alexander would imagine
a face — we want a culture, not a portrait.)

#### 6.5.3 Slot 2 — `STANCE` (controlled vocabulary, 5 options)

Pick exactly one. The choice is driven by the template's `heroType`:

| id              | stance phrase | preferred for `heroType` |
|-----------------|---------------|--------------------------|
| `CONTRAPPOSTO`  | "standing in a heroic contrapposto, weight on the back foot, one hip cocked" | Hybrid (3) |
| `BATTLE_READY`  | "in a battle-ready stance, feet shoulder-width and the body slightly squared" | Offensive (0) |
| `REGAL`         | "in a regal upright stance with the chin slightly raised and one hand on the hip" | Economic (2), some Defensive (1) |
| `WATCHFUL`      | "in a watchful stance with the body half-turned and the head slightly inclined" | Economic (2), Hybrid (3) |
| `PLANTED`       | "planted firmly with both feet apart and shoulders broad" | Defensive (1), some Offensive (0) |

The mapping is a *preference*, not a hard rule — when a hero's flavor calls
for a stance outside its type's default, override. The five stances together
give the roster pose variety without ever surprising the camera.

#### 6.5.4 Slot 3 — `HEAD_COVER` (must conceal the face)

The faceless rule is non-negotiable (it's also baked into `style.silhouette`).
This slot describes *how* the face is covered. Permitted phrasings always
follow the shape:

```
the face entirely concealed by <NOUN PHRASE>, <DETAIL>
```

Vocabulary by category (use the row matching the hero, or adapt to flavor):

| category | typical head cover |
|----------|--------------------|
| Historical (0) | culturally appropriate helmet (galea, Phrygian, Norman, kettle, sallet, kabuto, salade) with crest/visor/cheek-piece details that obscure the face |
| Mythological (1) | a divine half-mask, a thunder-engraved diadem with a brow band, a horned aspect-helm, a winged casque |
| CryptoIcons (2) | a deep merchant's cowl pulled low, a folded bandana drawn up over the mouth, a hood + balaclava, a featureless mirrored visor |
| Gaming (3) | the character's signature head silhouette rendered as a faceless silhouette (e.g. plumed shell-helm cast in shadow, deep blocky helm with a single dark visor band) |
| Original (4) | a Sanctuary's draped veil, a Cairn-walker's deep stone-grey cowl, a Forge-marked smith's leather mask with brass studs |

Always include a `<DETAIL>` clause that *explains how* the face is hidden:
`"the visor a single dark band"`, `"the brow band casting full shadow over
the face"`, `"the mask featureless and matte"`. Without this, Flux sometimes
synthesises a face inside the helmet anyway.

#### 6.5.5 Slot 4 — `TORSO` (armor or signature garment)

Always introduced with `wearing`. Single phrase, short. Examples by register:

- Armored: "lorica segmentata in fluted steel bands", "scaled linothorax over
  a short tunic", "ringmail under a fur-lined raider's cloak", "a heavy
  brigandine reinforced with riveted plates", "a lacquered ō-yoroi cuirass".
- Robed: "a brocaded merchant's robe with a wide sash", "a long monastic
  robe belted at the waist", "a worn long merchant's coat with a wide sash".
- Mythic: "a star-flecked chiton clasped at one shoulder", "a winged
  cuirass scribed with runes".

Never combine multiple armor pieces in this slot — the silhouette must read
clearly at small sizes.

#### 6.5.6 Slot 5 — `PRIMARY_ITEM` (held / wielded)

The signature item held in the hand(s). Single phrase. Examples:

- Weapon: "gladius lowered at the hip", "kopis sword raised high in the
  right hand", "longbow strung diagonally across the body", "a hooked
  cavalry lance angled forward".
- Tool: "a heavy purse held forward in one hand", "a sextant cradled in
  both hands", "two limp parchments held forward in one hand".
- Mythic: "a forked lightning rod gripped in both hands", "a single
  shadowed coin held between two fingers".

Stance and item must agree. A `BATTLE_READY` stance with a `"longbow stowed
across the back"` reads as confused; pair it with `"longbow drawn,
arrow nocked"` instead.

#### 6.5.7 Slot 6 — `SECONDARY_ITEM` (signature back / hip / shoulder)

A second piece of identifying gear that complements the primary. Examples:

- "scutum slung at the back"
- "military cloak swept dramatically behind"
- "a war banner planted at the right side"
- "a battered courier satchel hung at the hip"
- "a heavy two-handed axe slung diagonally over the back"
- "a longbow's quiver of fletched arrows at the hip"

If a hero has no obvious secondary, repeat / extend the primary's silhouette
("a second matched gladius scabbarded at the back"). Never leave the slot
empty — the prompt sentence must parse cleanly.

#### 6.5.8 Worked examples

```
A Roman centurion,
  planted firmly with both feet apart and shoulders broad;
  the face entirely concealed by a transverse-crested galea, the visor a single dark band;
  wearing lorica segmentata in fluted steel bands;
  gladius lowered at the hip;
  scutum slung at the back.

A Macedonian king,
  in a regal upright stance with the chin slightly raised and one hand on the hip;
  the face entirely concealed by a tall plumed Phrygian helmet whose brow band casts full shadow over the face;
  wearing a scaled linothorax over a short tunic;
  kopis sword raised high in the right hand;
  military cloak swept dramatically behind.

A hooded crypto trader,
  in a watchful stance with the body half-turned and the head slightly inclined;
  the face entirely concealed by a deep merchant's cowl pulled low and a folded paper bandana drawn up over the mouth;
  wearing a worn long merchant's coat with a wide sash;
  two limp parchments held forward in one hand;
  a battered courier satchel hung at the hip.

A Spartan hoplite,
  planted firmly with both feet apart and shoulders broad;
  the face entirely concealed by a crested Corinthian helm whose T-slot visor leaves only deep shadow where the face would be;
  wearing a bronze muscle cuirass over a short red tunic;
  a long dory spear held upright at the right shoulder;
  a circular bronze aspis hung at the left arm.

A green-clad swordbearer,
  in a battle-ready stance, feet shoulder-width and the body slightly squared;
  the face entirely concealed by the deep shadow of a pointed long-eared cap pulled forward;
  wearing a belted forest tunic over a riveted hauberk;
  a slim straight sword drawn level in the right hand;
  a small kite shield strapped to the left forearm.
```

#### 6.5.9 Authoring checklist

When adding a hero to `heroes.json`, the `subject` is grammar-conformant iff
all of these hold:

- [ ] Starts with `A ` followed by a noun phrase (slot 1).
- [ ] Contains exactly five `;` separators.
- [ ] Slot 2 phrase appears verbatim from the §6.5.3 table.
- [ ] Slot 3 contains the literal sub-phrase `the face entirely concealed by`.
- [ ] Slot 4 starts with `wearing `.
- [ ] Slots 5 and 6 are non-empty and refer to distinct items.
- [ ] Ends with `.` — no trailing whitespace, no extra punctuation.

A simple TypeScript validator at
`sdks/novus-mundus-ts/scripts/heroimg/validate-manifest.ts` enforces these
rules locally — `generate-heroes.sh` runs it as a pre-flight and refuses to
hit Bonsai if any hero's `subject` fails the checklist, so a bad prompt
doesn't burn a few minutes of inference before you notice. This keeps the
catalog from drifting as new heroes are added by different authors.

### 6.6 Operator runbook — Apple Silicon

The full path from a clean Mac to a baked hero PNG. The Bonsai checkout
lives **inside our repo** at `images/bonsai/` (gitignored — its Python venv
and multi-GB model weights are never committed). Three thin wrapper scripts
in `images/scripts/` handle the lifecycle:

| script | purpose |
|--------|---------|
| `bonsai-install.sh` | one-time: clone Bonsai-image-demo into `images/bonsai/`, run its `setup.sh` (Python venv + mflux + weights, 5-10 GB download) |
| `bonsai-serve.sh`   | foreground: launches `images/bonsai/scripts/serve.sh` with `BONSAI_VARIANT=ternary` and `BACKEND_PORT=8000` |
| `bonsai-health.sh`  | pre-flight: `curl /openapi.json` against `$BONSAI_URL`, exits 0 if alive |

We don't write any Python. The Bonsai demo manages its own environment;
we just shell out to it and POST to its `/generate` endpoint.

#### First-time setup (~15-20 min, one-time per machine)

```bash
images/scripts/bonsai-install.sh
# Clones https://github.com/PrismML-Eng/Bonsai-image-demo (default ref: main)
#   into images/bonsai/, then runs its setup.sh:
#     · creates images/bonsai/.venv
#     · pip installs mflux, fastapi, uvicorn, huggingface_hub, ...
#     · downloads MLX checkpoints into images/bonsai/models/
#   First-time disk + bandwidth: ~5-10 GB.
```

Pin a specific upstream commit by setting `BONSAI_REF=<sha-or-tag>` before
running. While Bonsai-image-demo is fresh, tracking `main` is fine; bump
when something breaks.

#### Bake-time workflow

Two terminals:

```bash
# Terminal A — keep the daemon running while you bake.
images/scripts/bonsai-serve.sh
# Server warms weights (~5-10 s), then listens on 127.0.0.1:8000.
# Ctrl-C unloads weights and shuts down.

# Terminal B — kick off the bake (slice 0+).
images/scripts/bonsai-health.sh       # one-line sanity check
images/scripts/generate-heroes.sh     # POSTs every manifest entry to localhost:8000
images/scripts/export-heroes-to-app.sh   # alpha-strip + duotone + trim
```

`generate-heroes.sh` calls `bonsai-health.sh` first and aborts with a clear
message if the daemon isn't up — no silent hang.

#### Switching variants

For prompt iteration, restart the daemon with `BONSAI_VARIANT=binary`
(faster, 88% quality):

```bash
# In terminal A:
^C
BONSAI_VARIANT=binary images/scripts/bonsai-serve.sh
```

Re-bake the final asset under `ternary` (default) before committing the raw
PNG — convention only, no automated gate.

#### Disk + memory at a glance

| location | grows to | committed? |
|----------|----------|------------|
| `images/bonsai/.venv/`              | ~1 GB             | no (gitignored) |
| `images/bonsai/models/`             | 5-10 GB           | no (gitignored) |
| `images/bonsai/` (git, code only)   | ~50 MB            | no (gitignored — re-clone from upstream) |
| `images/heroes/raw/`                | ~80 × 1 MB        | no (gitignored — re-bake from Bonsai) |
| `apps/web/public/img/heroes/templates/` | ~80 × 200 KB  | yes (the final assets we serve) |
| RAM during inference                | 1.95-2.38 GB (unified) | — |

#### Fallback if Bonsai-image-demo's setup fails

If `setup.sh` blows up on this Mac (Python version mismatch, mflux build
failure, weight-download error), drop to **mflux directly** — that's the
underlying Apple MLX-Flux library Bonsai is built on, and it loads HF
checkpoints in ~20 lines of Python:

```python
# scripts/bonsai-bake.py (fallback path, only if bonsai-serve.sh is broken)
from mflux import Flux1
model = Flux1.from_hub("prism-ml/bonsai-image-ternary-4B-mlx-2bit")
img = model.generate_image(
    prompt="<full prompt>",
    seed=2001, width=1024, height=1024, num_inference_steps=28,
)
img.save("images/heroes/raw/<id>.png")
```

A daemon variant of this (read prompts from stdin, write PNGs to a queue
dir) would give us the same warm-cache batching the FastAPI server
provides. Document this path in §13 if we ever need it; today's plan stays
on Bonsai-image-demo.

---

## 7. Halo patterns

Eight patterns, all drawn with `@napi-rs/canvas` vector primitives so they
scale without quality loss and don't need pre-baked PNGs. Each is a function
of `(seed: number, tier: 0..4, ctx: CanvasRenderingContext2D)`.

| id | sketch | character |
|----|--------|-----------|
| 0 concentric  | nested rings, irregular spacing | austere, ceremonial |
| 1 radial-spokes | radial lines from center | martial, banner-like |
| 2 runic       | small glyphs placed on a ring | mystical, mythological |
| 3 voronoi     | jittered voronoi cells, edges only | architectural, structural |
| 4 scale-mail  | overlapping scale arcs | armored, defensive |
| 5 isohypse    | flowing contour curves | landscape, organic |
| 6 herringbone | woven diagonal motif | mercantile, woven |
| 7 sunburst    | rays of varying length | heroic, celebratory |

The pattern type is **derived from the pubkey** (`bytes[0..1] % 8`) — not from
category — so two Centurions get different halos. Tier controls **stroke
weight and luminosity ramp**, not the pattern.

Implementation lives in `apps/web/src/lib/hero-image/halo/`, one file per
pattern, each exporting a pure draw function. Patterns are unit-tested by
hashing their canvas output and comparing to a fixture.

---

## 8. City sigils

**Seventeen** cities are referenced by the current 79-hero catalog —
`meditationCityId` values `1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16,
19, 22` — plus the `0` "everywhere" sentinel for crypto-icon heroes with no
fixed origin. (Counted from
`sdks/novus-mundus-ts-kit/cli/data/heroes.ts` on 2026-05-27; IDs `14, 17,
18, 20, 21` are valid cities in the world but no current hero meditates
there, so they get no sigil until a hero is added that uses them.)

**Shipped as Bonsai bakes** (slice 0 — not hand-authored as originally
proposed). Manifest at `images/sigils/sigils.json`, generated by
`generate-sigils.sh`, exported by `export-sigils-to-app.sh`. Each sigil is
a heraldic medallion appropriate to its city's lore region (Roman aquila
for Solterrae, Byzantine star-crescent for Kaelindra, ashoka chakra for
Maravhen, etc.) on transparent background. Output:
`apps/web/public/img/heroes/city-sigils/<cityId>.png`. Tinted to the
hero's tier-bright color at runtime via offscreen canvas.

cityId 0 (the "everywhere" sentinel) reuses the existing
`sanctuary-meditation` cairn icon from `apps/web/public/img/icons/game/`.

| cityId | city | sigil subject (concept) |
|--------|------|-------------------------|
| 0 | (everywhere) | reuse `sanctuary-meditation` cairn — five stacked stones |
| 1..13, 15, 16, 19, 22 | per HERO_GALLERY.md | filled in during implementation against the canonical city list |

Hand-authored beats AI here because: (a) only 17 assets total, (b) sigils
are tiny on the canvas (~14% of frame) so AI variance is wasted, (c) hand
control lets us guarantee they read clearly at small sizes.

If a hero's `meditationCityId` is `0` (crypto-icon heroes like Paper Hands —
no fixed origin), the sigil slot is filled with the
existing `sanctuary-meditation` cairn icon, which already exists in the icon
manifest.

---

## 9. Pubkey → composition mapping

The Solana pubkey is 32 bytes. We use it **only** for compositional
variation — never for color.

```
bytes  0..1   → halo pattern type           ( (b0<<8 | b1) % 8 )
bytes  2..7   → halo PRNG seed              (passed into the chosen pattern)
byte   8      → horizontal flip             ( flip iff b8 < 51, i.e. ~20% chance,
                                              readable-default biased)
byte   9      → silhouette rotation tweak   ( -3°..+3°, mapped from b9 )
byte  10      → corner ornament variant     ( 0..3, b10 % 4 )
byte  11      → city sigil rotation         ( -15°..+15°, mapped from b11 )
byte  12      → category banner variant     ( 0..3, b12 % 4 — currently 1 variant per
                                              category, reserved for future variants )
bytes 13..15  → buff icon vertical nudges   ( ±6px each, mapped from b13/b14/b15 )
bytes 16..31  → constellation               ( 8 dots × 2 coords, mapped to a safe
                                              rim band outside the silhouette bounding box )
```

`apps/web/src/lib/hero-image/fingerprint.ts` is a **pure function** of the
32-byte pubkey + the hero's on-chain state (`{ templateId, tier, level,
locked }`). It returns a `CompositionParams` struct consumed by `compose.ts`.
Unit tests hash a known pubkey + state and assert the returned struct.

```ts
// apps/web/src/lib/hero-image/fingerprint.ts (signature only)
export interface CompositionParams {
  haloKind: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  haloSeed: number;            // 48-bit PRNG seed
  flipX: boolean;
  rotateDeg: number;           // -3..+3
  cornerVariant: 0 | 1 | 2 | 3;
  citySigilRotateDeg: number;  // -15..+15
  categoryBannerVariant: 0 | 1 | 2 | 3;
  buffNudges: [number, number, number, number];  // px
  constellation: Array<{ x: number; y: number }>;  // 8 points in [0,1]²
}

export function fingerprintFromPubkey(
  pubkey: Uint8Array,                            // 32 bytes
  state: { templateId: number; tier: number; level: number; locked: boolean },
): CompositionParams;
```

---

## 10. The runtime route

`apps/web/src/app/api/hero/image/[pubkey]/route.ts`

```ts
import { PublicKey, Connection } from "@solana/web3.js";
import { parseAssetV1 } from "novus-mundus-sdk";
import { fingerprintFromPubkey } from "@/lib/hero-image/fingerprint";
import { composeHeroImage } from "@/lib/hero-image/compose";

export const runtime = "nodejs";

// Server-side counterpart to apps/web/src/lib/hooks/useLockedHeroes.ts —
// same getAccountInfo + parseAssetV1 pattern, single-shot for one pubkey.
// Lives in apps/web/src/lib/chain/heroes.ts (to be added in slice 0).
async function fetchHero(connection: Connection, pubkey: PublicKey) {
  const info = await connection.getAccountInfo(pubkey, "confirmed");
  if (!info?.data) throw new Error("hero account not found");
  const asset = parseAssetV1(info.data);
  if (!asset) throw new Error("not a hero asset");
  return asset;  // exposes templateId, tier, level, locked via plugins
}

export async function GET(
  req: Request,
  { params }: { params: { pubkey: string } },
) {
  const pubkey = new PublicKey(params.pubkey);
  const hero   = await fetchHero(getConnection(), pubkey);
  const fp     = fingerprintFromPubkey(pubkey.toBytes(), hero);
  const png    = await composeHeroImage(hero, fp);

  const etag = `"h:${hero.templateId}:${hero.tier}:${hero.level}:${hero.locked ? 1 : 0}:v1"`;
  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  return new Response(png, {
    headers: {
      "Content-Type":  "image/png",
      "ETag":          etag,
      "Cache-Control": "public, max-age=60, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
```

Clients should embed `?v=<level>` in URLs so a level-up bypasses the browser
cache without server cooperation:

```tsx
<img src={`/api/hero/image/${hero.address.toBase58()}?v=${hero.level}`} />
```

The cache key is fully determined by `(templateId, tier, level, locked,
pubkey)` — same inputs → byte-identical PNG. The route does **not** consult
the viewing player's identity or current city.

---

## 11. File layout — as shipped

```
images/heroes/    heroes.json + raw/<id>.png     # 20 hero silhouettes (slice 0 + first expansion)
images/halos/     halos.json  + raw/<id>.png     # 8 halo patterns
images/sigils/    sigils.json + raw/<id>.png     # 17 city sigils
images/marks/     marks.json  + raw/<id>.png     # 16 ascension marks
images/frames/    frames.json + raw/<id>.png     # 5 tier frames (BAKED but currently unused — see §5)

images/scripts/
  generate-{heroes,halos,sigils,marks,frames}.sh   # one per layer
  export-{heroes,halos,sigils,marks,frames}-to-app.sh
  bonsai-{install,serve,health}.sh                 # local Bonsai daemon (§6.6)

apps/web/public/img/heroes/
  templates/<templateId>.png    # final tinted silhouettes (input to L4)
  halos/halo-<kind>.png         # 8 halo PNGs (input to L3)
  city-sigils/<cityId>.png      # 17 sigils + cairn fallback (input to L5)
  marks/<n>.png                 # 16 ascension marks (input to L9)
  frames/frame-<tier>.png       # 5 frame PNGs (unused — see §5)

apps/web/src/lib/hero-image/
  palette.ts          # TIER_ACCENT, STATE_GLOW, BG_SOLID, STAR_TINT
  fingerprint.ts      # pubkey -> CompositionParams (pure)
  template-map.ts     # templateId -> {tier, category, buffs, meditationCity}
  image-cache.ts      # mtime-aware loadImageCached (shared by compose + halo)
  compose.ts          # canvas pipeline orchestrator
  frame.ts            # 5 tier frames (kept as dead code — see §5)
  halo/
    index.ts          # dispatch — loads halo PNG, tints to tier via offscreen canvas
    concentric.ts     # programmatic fallback when halo PNG missing

apps/web/src/lib/chain/
  heroes.ts           # fetchHero — getAccountInfo + parseAssetV1

apps/web/src/app/api/hero/image/[pubkey]/route.ts
```

---

## 12. Slice 0 — first deliverable

Before committing to the full 79-hero build, the first PR ships a vertical
slice end-to-end:

1. `images/heroes/heroes.json` skeleton with **5 templates only** (one per
   tier — Roman Centurion / Alexander / Cleopatra / a Legendary / a Mythic).
2. `generate-heroes.sh` and `export-heroes-to-app.sh` working against a local
   Bonsai server.
3. **1 halo pattern** (`concentric`), with the dispatch table stubbed for the
   other 7.
4. **5 frame variants** (1 per tier), corner variants stubbed to a single
   default.
5. **1 city sigil** (the cairn fallback, by reusing the existing
   `sanctuary-meditation` icon).
6. `palette.ts`, `fingerprint.ts`, `compose.ts`, a server-side `fetchHero`
   helper (`apps/web/src/lib/chain/heroes.ts`, mirroring `useLockedHeroes`),
   and the API route.
   Also: add `@napi-rs/canvas` to `apps/web/package.json` deps.
7. A throwaway page at `/dev/hero-portraits` that lists the 5 minted heroes
   in the local validator with their portraits side-by-side so we can eyeball
   the output.

Acceptance criteria for slice 0:

- Hitting `/api/hero/image/<pubkey>` for any of the 5 minted heroes returns a
  valid 1024² PNG in < 50 ms warm.
- Two different pubkeys minted from the same template return visibly
  different portraits (different constellation, different halo seed) while
  sharing silhouette and frame.
- Re-running `generate-heroes.sh tpl-001-roman-centurion` produces a
  byte-identical raw PNG.

Once slice 0 lands, the remaining work is **catalog data entry** (filling out
the manifest for the other 74 heroes) plus **mechanical content** (7 more
halo patterns, 11 more city sigils, 16 corner-variant tweaks) — none of which
requires further architectural decisions.

---
