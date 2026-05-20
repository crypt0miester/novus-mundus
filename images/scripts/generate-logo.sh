#!/usr/bin/env bash
# Generate the Novus Mundus logo mark (icon only — no wordmark) via Krea.
# Re-run to iterate on prompt/seed/model/style.
#
# Usage:
#   ./generate-logo.sh                                        # defaults
#   MODEL=bytedance/seedream-4 ./generate-logo.sh
#   SEED=4242 ./generate-logo.sh
#   PROMPT_VARIANT=v2-cairn-spiral ./generate-logo.sh
#   STYLE=engraved-coin ./generate-logo.sh
#
# Composition variants:
#   v1-phi-seal | v2-cairn-spiral | v3-golden-compass | v4-phi-glyph (mark only, no rings)
#
# Style variants (visual treatment, layered on top of any composition):
#   classic              — antique gold on obsidian (default, original)
#   engraved-coin        — coin/medallion relief, metallic depth
#   minimalist-line      — single-weight modern line, app-icon friendly
#   verdigris-bronze     — oxidized aged copper, teal-green patina
#   stained-glass        — jewel-tone illuminated panels
#   carved-stone         — sandstone bas-relief, ancient ruin feel
#   blueprint            — cyan technical drafting on midnight paper
#   neon-arcane          — luminous magenta/teal glow on void
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${REPO_ROOT}/images/logo"
mkdir -p "${OUT_DIR}"

MODEL="${MODEL:-ideogram/ideogram-3}"
SEED="${SEED:-1618}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-1024}"
PROMPT_VARIANT="${PROMPT_VARIANT:-v1-phi-seal}"
STYLE="${STYLE:-classic}"

# Compositional core: which glyph/arrangement is at the center.
case "${PROMPT_VARIANT}" in
  v1-phi-seal)
    CORE="A circular heraldic emblem. Central glyph: an elegant Greek letter Phi (Φ) treated as a monogram — a vertical bar with a perfectly circular oval intersecting at center — with a precise golden-ratio logarithmic spiral coiling outward through it. Surrounding the central glyph: two concentric thin rings with subtle astrolabe-style tick marks between them at golden-angle intervals (137.5°). Small ornamental sun-disc glyph at the bottom of the outer ring."
    SHORT="phi-seal"
    ;;
  v2-cairn-spiral)
    CORE="A bold circular emblem. Central glyph: a stacked-stone cairn silhouette (three or four irregular stones balanced vertically) with a single golden-ratio logarithmic spiral rising from its peak. Surrounding the central glyph: a single thin ring with subtle compass-tick ornaments at the four cardinal points."
    SHORT="cairn-spiral"
    ;;
  v3-golden-compass)
    CORE="A circular emblem. Central glyph: a compass rose whose spokes radiate at golden-angle intervals (137.5°), with a small inscribed logarithmic spiral coiling at its center. Surrounding the central glyph: two concentric thin rings, the inner ring decorated with small star-burst ornaments."
    SHORT="golden-compass"
    ;;
  v4-phi-glyph)
    CORE="A single isolated glyph — no rings, no border, no enclosing circle of any kind. Just the glyph itself floating in negative space: an elegant Greek letter Phi (Φ) treated as a monogram with a vertical bar and stacked oval shapes intersecting at center, with a precise golden-ratio logarithmic spiral coiling outward through it. The glyph is the only subject in the frame."
    SHORT="phi-glyph"
    ;;
  *)
    echo "unknown PROMPT_VARIANT: ${PROMPT_VARIANT}" >&2
    exit 2
    ;;
esac

# Style treatment: how the composition is rendered.
case "${STYLE}" in
  classic)
    STYLE_DESC="Style: timeless mythic strategy game logo mark — like a Renaissance cartographer's wax seal meets modern minimalist branding. Sharp vector-clean line work, no photographic noise, ample negative space. Color: antique gold (#C9A961) with warm copper highlights on deep obsidian black (#0A0E14)."
    ;;
  engraved-coin)
    STYLE_DESC="Style: ancient bronze medallion freshly struck — relief sculpture detail, subtle metallic depth and micro-shadows where the glyph rises off the surface, like an archaeological coin from a lost empire. Color: warm polished bronze and aged gold catching directional light from upper left, on a deep obsidian black background with faint metallic vignette."
    ;;
  minimalist-line)
    STYLE_DESC="Style: ultra-modern minimalist logo, single-weight thin line stroke throughout, perfect geometric precision, no flourishes, app-icon ready, scales to favicon. Color: pure thin antique-gold (#C9A961) line on flat obsidian black (#0A0E14), no shading, no gradients."
    ;;
  verdigris-bronze)
    STYLE_DESC="Style: ancient oxidized bronze artifact recovered from the sea — verdigris green-blue patina creeping across darker bronze, hint of weathered erosion at the edges, deeply atmospheric. Color: muted teal-green verdigris (#3FA08A) and aged bronze (#8B6B3D) on near-black charcoal, mood lit."
    ;;
  stained-glass)
    STYLE_DESC="Style: illuminated stained glass window panel from a great hall — jewel-tone sections divided by gold leading, light glowing through from behind, sacred geometry feel. Color: deep sapphire, ruby, amber, and emerald jewel tones with bright gold leading, on black void."
    ;;
  carved-stone)
    STYLE_DESC="Style: bas-relief sandstone carving from an ancient temple wall — deep chiseled lines, weathered edges, dust caught in the recesses, archaeological. Color: warm sandstone beige and ochre with deep shadowed recesses, on dark stone-grey background."
    ;;
  blueprint)
    STYLE_DESC="Style: technical drafting blueprint — fine cyan construction lines, measurement annotations dissolving into pure geometry, drafted with precise compass and straightedge. Color: bright cyan (#5BE0FF) line on deep midnight-blue paper (#0A1A2E), with faint white grid lines barely visible."
    ;;
  neon-arcane)
    STYLE_DESC="Style: luminous arcane sigil glowing from within — soft bloom and atmospheric haze around the strokes, sacred-tech aesthetic, looks like it was scribed in light. Color: hot magenta (#FF3DCB) and electric teal (#00E5C8) glow on absolute void black, intense central luminosity falling off into darkness."
    ;;
  *)
    echo "unknown STYLE: ${STYLE}" >&2
    exit 2
    ;;
esac

UNIVERSAL_TAIL="Composition: perfectly symmetrical, centered, square 1:1, ample negative space, the icon occupies roughly the central 70% of the frame. Icon only — absolutely no text, no letters, no wordmark, no inscriptions, no characters of any kind. No people, no clutter."

PROMPT="Game logo mark (icon only, no text). ${CORE} ${STYLE_DESC} ${UNIVERSAL_TAIL}"

TS="$(date +%Y-%m-%d-%H-%M-%S)"
OUT="${OUT_DIR}/${TS}-novus-mundus-${SHORT}-${STYLE}.png"

echo "model:    ${MODEL}"
echo "variant:  ${PROMPT_VARIANT}"
echo "style:    ${STYLE}"
echo "seed:     ${SEED}"
echo "size:     ${WIDTH}x${HEIGHT}"
echo "out:      ${OUT}"
echo

krea generate image \
  -m "${MODEL}" \
  --width "${WIDTH}" --height "${HEIGHT}" \
  --seed "${SEED}" \
  --aspect 1:1 \
  -p "${PROMPT}" \
  -o "${OUT}"
