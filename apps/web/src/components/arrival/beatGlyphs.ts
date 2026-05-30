// The ink sigil at page center morphs its silhouette per Arrival beat (3b in
// docs/design/ANIMEJS_MOTION_OPPORTUNITIES.md). svg.morphTo only interpolates
// cleanly when the source and target paths share an identical command
// structure (same node count, same command sequence), otherwise the morph
// jumps. So every glyph below is authored to ONE shared template: a closed
// loop of exactly eight cubic-bezier segments (`M` + 8 `C` + `Z`) drawn around
// the centre of a 100x100 box. Only the eight anchor points and their handles
// move between glyphs; the command count never changes, which is what keeps the
// morph (and the draw-in) point-matched.
//
// The eight anchors run clockwise from the top. Keep them in that order in
// every glyph so a node never has to cross the silhouette to reach its morph
// target. If you add a glyph, copy the template and only move coordinates.

// The shared viewBox the sigil <svg> must declare so these coordinates land.
export const GLYPH_VIEWBOX = "0 0 100 100";

import type { Beat } from "./Arrival";

// world: a near-perfect orb. The world, surfaced at last.
const WORLD =
  "M 50 12 C 60 12 71 18 79 21 C 84 29 88 40 88 50 C 88 60 84 71 79 79 C 71 84 60 88 50 88 C 40 88 29 84 21 79 C 16 71 12 60 12 50 C 12 40 16 29 21 21 C 29 16 40 12 50 12 Z";

// choice: a faceted compass diamond. The fork in the road, four bearings.
const CHOICE =
  "M 50 8 C 56 26 58 30 70 38 C 74 44 78 46 92 50 C 78 54 74 56 70 62 C 58 70 56 74 50 92 C 44 74 42 70 30 62 C 26 56 22 54 8 50 C 22 46 26 44 30 38 C 42 30 44 26 50 8 Z";

// claim: a planted stake with a pennant reading off to one side. The ground is
// yours; a name goes on the map.
const CLAIM =
  "M 47 8 C 49 9 64 11 82 18 C 72 24 64 28 53 32 C 53 44 53 58 53 70 C 56 76 58 82 60 92 C 53 90 46 90 40 92 C 42 82 44 76 47 70 C 47 50 47 30 47 16 C 47 13 47 10 47 8 Z";

// jump: a four-pointed spark, the premium leap that skips the long road.
const JUMP =
  "M 50 6 C 53 28 56 38 62 44 C 70 47 80 50 94 50 C 80 50 70 53 62 56 C 56 62 53 72 50 94 C 47 72 44 62 38 56 C 30 53 20 50 6 50 C 20 50 30 47 38 44 C 44 38 47 28 50 6 Z";

// cairn: stacked stones, the marker that wakes and speaks. A tapered stack
// read top to bottom, four anchors down each flank.
const CAIRN =
  "M 50 12 C 60 13 66 16 68 24 C 64 32 58 36 56 44 C 64 48 72 54 73 64 C 68 74 58 80 50 88 C 42 80 32 74 27 64 C 28 54 36 48 44 44 C 42 36 36 32 32 24 C 34 16 40 13 50 12 Z";

// Every Beat the Arrival can land on maps to a glyph; the director morphs the
// sigil to GLYPH[next] across each transition.
export const GLYPH: Record<Beat, string> = {
  world: WORLD,
  choice: CHOICE,
  claim: CLAIM,
  jump: JUMP,
  cairn: CAIRN,
};
