"use client";

import { useEffect, useState } from "react";
import MagicRings from "@/components/shared/animations/MagicRing";

/**
 * BootRing — ambient back layer for `LoadingSequence` and `TransitionOverlay`.
 *
 * Color comes from the same gold palette the transition overlay's gold lines
 * use (`#92400e` → `#fbbf24`), not the tier-accent system. The tier accent
 * can be red on Tier 4 or muddy on Tier 0; the gold gradient is the app's
 * universal "ritual / chrome" hue, used wherever the UI wants to read as
 * legendary regardless of tier.
 *
 * Other knobs vs stock `MagicRing`:
 *   - locked-down interaction (`followMouse=false`, `clickBurst=false`,
 *     `hoverScale=1`) — boot screens aren't toys
 *   - bright back-layer: `opacity 0.9`, `ringCount 6`, `speed 0.7`,
 *     `attenuation 6`, `lineThickness 2.5`
 *
 * Drops entirely on mobile (`window.matchMedia("(min-width: 1024px)")`) — the
 * Three.js context + visual weight isn't worth it on a phone. Also skipped
 * under `prefers-reduced-motion`.
 */
const GOLD_DEEP = "#92400e";   // amber-800, same as transition overlay edges
const GOLD_BRIGHT = "#fbbf24"; // amber-400, same as transition overlay center

export function BootRing() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const desktop = window.matchMedia("(min-width: 1024px)").matches;
    if (reduced || !desktop) return;
    setShow(true);
  }, []);

  if (!show) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0"
    >
      <MagicRings
        color={GOLD_DEEP}
        colorTwo={GOLD_BRIGHT}
        speed={0.7}
        ringCount={6}
        attenuation={6}
        lineThickness={2.5}
        opacity={0.9}
        baseRadius={0.3}
        radiusStep={0.12}
        followMouse={false}
        clickBurst={false}
        hoverScale={1}
      />
    </div>
  );
}
