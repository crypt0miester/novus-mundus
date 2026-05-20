#!/usr/bin/env bash
# Derive all app-side logo assets from the canonical source.
# Drops PNGs/SVGs into apps/web/public/img/logo and Next.js auto-detected
# icon files into apps/web/src/app/.
#
# Requires: ImageMagick (magick), potrace, rsvg-convert.
#
# Usage:
#   ./export-to-app.sh                                  # uses default canonical source
#   SRC=/abs/path.png ./export-to-app.sh                # override source
#   APP_DIR=/abs/apps/web ./export-to-app.sh            # override target app
#   BG_HEX="#0A0E14" GOLD="#C9A961" ./export-to-app.sh  # theme overrides
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="${SRC:-${REPO_ROOT}/images/logo/FINAL-novus-mundus-rotated-mark-transparent.png}"
APP_DIR="${APP_DIR:-${REPO_ROOT}/apps/web}"
BG_HEX="${BG_HEX:-#0A0E14}"
GOLD="${GOLD:-#C9A961}"

[[ -f "${SRC}" ]] || { echo "source not found: ${SRC}" >&2; exit 2; }
[[ -d "${APP_DIR}" ]] || { echo "app dir not found: ${APP_DIR}" >&2; exit 2; }

PUB="${APP_DIR}/public/img/logo"
APP_ROOT="${APP_DIR}/src/app"
mkdir -p "${PUB}" "${APP_ROOT}"

echo "source: ${SRC}"
echo "app:    ${APP_DIR}"
echo "bg:     ${BG_HEX}"
echo "gold:   ${GOLD}"

TMP_BMP="$(mktemp -t logo-bmp-XXXXXX).bmp"
TMP_SVG_RAW="$(mktemp -t logo-svg-XXXXXX).svg"

# 1. Vectorize: alpha -> threshold -> bitmap -> potrace -> raw svg
magick "${SRC}" -alpha extract -threshold 50% -negate "${TMP_BMP}"
potrace "${TMP_BMP}" -s -o "${TMP_SVG_RAW}" --turdsize 8 --opttolerance 0.2

# 2. Clean SVG variants (themed currentColor, explicit gold, explicit white)
build_svg() {
  local out="$1" fill="$2"
  {
    echo "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 2048 2048\" preserveAspectRatio=\"xMidYMid meet\" fill=\"${fill}\"><title>Novus Mundus</title>"
    awk '/^<g /{p=1} p{print} /^<\/svg>/{exit}' "${TMP_SVG_RAW}" \
      | sed 's/fill="#000000"/fill="inherit"/'
  } > "${out}"
}
build_svg "${PUB}/logo.svg"        "currentColor"
build_svg "${PUB}/logo-gold.svg"   "${GOLD}"
build_svg "${PUB}/logo-white.svg"  "#FFFFFF"

echo "  svg:   ${PUB}/logo.svg, logo-gold.svg, logo-white.svg"

# 3. Sized transparent PNGs for in-app use
for S in 64 128 256 512 1024; do
  magick "${SRC}" -resize "${S}x${S}" -strip "${PUB}/logo-${S}.png"
  echo "  png:   ${PUB}/logo-${S}.png"
done

# 4. On-black PNGs at common sizes
for S in 256 512 1024; do
  magick "${SRC}" -resize "${S}x${S}" -background "${BG_HEX}" -alpha remove -alpha off \
    "${PUB}/logo-${S}-on-black.png"
done

# 5. Next.js App Router auto-detected files in src/app/
#    - favicon.ico (multi-size .ico)
#    - icon.png (256, served as <link rel="icon">)
#    - apple-icon.png (180x180 for iOS home screen)
#    - opengraph-image.png (1200x630 og card)
#    - twitter-image.png (1200x630 twitter card)
magick "${SRC}" -background "${BG_HEX}" -alpha remove -alpha off \
  \( -clone 0 -resize 16x16 \) \
  \( -clone 0 -resize 32x32 \) \
  \( -clone 0 -resize 48x48 \) \
  -delete 0 "${APP_ROOT}/favicon.ico"
echo "  next:  ${APP_ROOT}/favicon.ico"

magick "${SRC}" -resize 256x256 -strip "${APP_ROOT}/icon.png"
echo "  next:  ${APP_ROOT}/icon.png"

magick "${SRC}" -resize 180x180 -background "${BG_HEX}" -alpha remove -alpha off -strip \
  "${APP_ROOT}/apple-icon.png"
echo "  next:  ${APP_ROOT}/apple-icon.png"

# Social cards: 1200x630, logo centered on brand background, glyph sized to ~62% of height
GLYPH_PX=$(awk -v h=630 'BEGIN{printf "%d", h*0.62}')
magick -size 1200x630 "xc:${BG_HEX}" \
  \( "${SRC}" -resize "x${GLYPH_PX}" \) \
  -gravity center -compose over -composite -strip \
  "${APP_ROOT}/opengraph-image.png"
cp "${APP_ROOT}/opengraph-image.png" "${APP_ROOT}/twitter-image.png"
echo "  next:  ${APP_ROOT}/opengraph-image.png, twitter-image.png"

rm -f "${TMP_BMP}" "${TMP_SVG_RAW}"
echo "done."
