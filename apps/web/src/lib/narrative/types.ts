/**
 * Narrative layer — shared types.
 *
 * The journey is six acts; the Cairn names where the player stands on the
 * climb along two axes (the place, the lord), bent by the estate's mood.
 * See PLAYER_JOURNEY_GAMEPLAN.md §4–§5.
 */

/** The six acts of the journey. 0 = The Arrival … 5 = The Crown. */
export type Act = 0 | 1 | 2 | 3 | 4 | 5;

/** The estate's mood — drives the Cairn's colour and bends its lines. */
export type Mood = "raw" | "working" | "thriving" | "threatened";

/** The two axes the Cairn names: the loud one (the place), the quiet one (the lord). */
export type Axis = "place" | "lord";

/** Kingdom theme. Only `medieval` has authored content today; the rest fall back to it. */
export type Theme = "medieval" | "cyberpunk" | "scifi" | "modern" | "postapocalyptic";

/** The Age of the kingdom an act belongs to (storyline §V). */
export type Age = "Ashes" | "Crowns" | "Dominion";

/**
 * A single building's lifecycle phase — one source of truth for every surface
 * (the Cairn's beats, the estate mood, and later the building card's actions).
 */
export type BuildingPhase =
  | "unbuilt" // no slot, or an empty slot
  | "rising" // first construction, timer running
  | "raised" // first construction, timer elapsed — awaits a manual Complete
  | "standing" // active, idle
  | "improving" // an upgrade in progress, timer running (feature still usable)
  | "improved"; // an upgrade done, timer elapsed — awaits a manual Complete

/** Static description of one act. */
export interface ActDef {
  id: Act;
  /** kebab-case key, stable for lookups. */
  key: string;
  /** Display name, e.g. "The Arrival". */
  name: string;
  /** The kingdom Age this act sits within. */
  age: Age;
  /** The place-axis answer — what the holding is. */
  place: string;
  /** The lord-axis answer — what the player is. */
  lord: string;
  /** The inciting beat that opens the act. */
  inciting: string;
  /** The payoff that closes it. */
  payoff: string;
}
