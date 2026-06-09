import "server-only";
import type { TimeWindow } from "novus-mundus-sdk";
import { Rng } from "../rng";
import { ARCHETYPES } from "./archetypes";
import { getBuildingMinigame } from "./buildings";
import type { ArchetypeName, GeneratedPuzzle } from "./types";

/**
 * Generate a building's puzzle deterministically.
 *
 * The seed folds in the server RNG secret (via `Rng`), the building, the
 * estate, the day and the window — so a player who abandons and restarts gets
 * the *same* puzzle (no re-rolling for an easier draw), and a building's Dawn
 * and Midday plays seed two distinct puzzles.
 */
export function generatePuzzle(
  building: number,
  estatePda: string,
  day: number,
  window: TimeWindow,
  /** Optional extra seed entropy (dev preview only) so each Begin varies. */
  nonce?: string,
): { archetype: ArchetypeName } & GeneratedPuzzle {
  const config = getBuildingMinigame(building);
  if (!config) {
    throw new Error(`no mini-game configured for building ${building}`);
  }
  const rng = new Rng(
    "estate.minigame",
    estatePda,
    `${building}:${day}:${window}${nonce ? `:${nonce}` : ""}`,
  );
  const generated = ARCHETYPES[config.archetype].generate(rng, config.difficulty, config.content);
  return { archetype: config.archetype, ...generated };
}
