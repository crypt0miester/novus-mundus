/**
 * Arrival narration — the Cairn's voice when the player lands.
 *
 * The spawn picker decides *where* the player arrives and tags the cell with
 * a `flavor` (the ground's character) and `bearing` (compass from city
 * centre). This module turns those two facts into one Cairn-voiced line.
 *
 * Voice rules from cairn.ts §4: spare, declarative, exact. No first person.
 * No advice. The anchor phrases — "The stone is lit" and "This is a ruin. It
 * does not have to stay one." — are preserved so the arrival reads like part
 * of the existing Act 0 beat, not a separate insert.
 */
import type { SpawnBearing, SpawnFlavor } from "novus-mundus-sdk";

const BEARING_WORD: Record<SpawnBearing, string> = {
  N: "northern",
  NE: "north-eastern",
  E: "eastern",
  SE: "south-eastern",
  S: "southern",
  SW: "south-western",
  W: "western",
  NW: "north-western",
};

/** Per-flavor template — keeps the Cairn's anchor phrases, varies the ground. */
const ARRIVAL_TEMPLATE: Record<SpawnFlavor, (bearingWord: string, cityName: string) => string> = {
  coast: (b, c) =>
    `A road brought you to the ${b} coast of ${c}. The water is at your back, and the salt-wind in it. The stone is lit. — This is a ruin. It does not have to stay one.`,
  foothill: (b, c) =>
    `A road brought you to the ${b} foothills of ${c}. Bare rock above, and the iron in it. The stone is lit. — This is a ruin. It does not have to stay one.`,
  grove: (b, c) =>
    `A road brought you to a grove on the ${b} edge of ${c}. Trees that were here before walls were. The stone is lit. — This is a ruin. It does not have to stay one.`,
  plain: (b, c) =>
    `A road brought you to the ${b} fields outside ${c}. Flat ground, far sight, and no cover. The stone is lit. — This is a ruin. It does not have to stay one.`,
  frontier: (b, c) =>
    `A road brought you to the ${b} marches of ${c}. Watchfires within sight, and the dark past them. The stone is lit. — This is a ruin. It does not have to stay one.`,
  crossroads: (b, c) =>
    `A road brought you to the ${b} crossroads of ${c}. Three ways from here — none of them yours yet. The stone is lit. — This is a ruin. It does not have to stay one.`,
};

/**
 * Render the Cairn's arrival line. Falls back to a bearing-less plain
 * template if flavor/bearing are missing — important for the resume path
 * where a player already exists and the spawn pick has no fresh result to
 * read.
 */
export function arrivalLine(
  cityName: string,
  flavor?: SpawnFlavor | null,
  bearing?: SpawnBearing | null,
): string {
  if (!flavor || !bearing) {
    /*
     * Fallback variant — the bearing word is intentionally absent so the
     * line reads "the fields outside {City}" without the awkward "the
     *  fields" double-space the previous single-replace masked.
     */
    return `A road brought you to the fields outside ${cityName}. Flat ground, far sight, and no cover. The stone is lit. — This is a ruin. It does not have to stay one.`;
  }
  return ARRIVAL_TEMPLATE[flavor](BEARING_WORD[bearing], cityName);
}
