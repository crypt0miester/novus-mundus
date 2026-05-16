/**
 * The six acts of the player journey — PLAYER_JOURNEY_GAMEPLAN.md §5.
 *
 * Descriptive, not enforced: `deriveAct()` infers the current act from
 * on-chain state the app already reads. Foundation and Mastery keep the names
 * of the dormant `estate.rs` chapters; the rest are the new connective acts.
 */
import type { ActDef } from "./types";

export const ACTS: readonly ActDef[] = [
  {
    id: 0,
    key: "arrival",
    name: "The Arrival",
    age: "Ashes",
    place: "A ruin. It does not have to stay one.",
    lord: "No one. A survivor, like the rest.",
    inciting: "You stop walking. You drive your stakes.",
    payoff: "The ruin is yours. The stone is lit.",
  },
  {
    id: 1,
    key: "foundation",
    name: "Foundation",
    age: "Ashes",
    place: "A holding. Barely — but a holding.",
    lord: "A lord of mud — but a lord.",
    inciting: "The first building rises.",
    payoff: "Walls that keep the rain off. The first people take you in.",
  },
  {
    id: 2,
    key: "first-blood",
    name: "First Blood",
    age: "Ashes",
    place: "A holding, and the road knows it now.",
    lord: "A lord of mud, and still standing.",
    inciting: "The quiet ends. The world notices you.",
    payoff: "You survive your first real fight. A place on the map, earned.",
  },
  {
    id: 3,
    key: "house",
    name: "The House",
    age: "Crowns",
    place: "A House. A name, with people behind it.",
    lord: "A lord with a House at his back.",
    inciting: "You have built as far as one pair of hands reaches.",
    payoff: "An oath sworn. The stone marks you, not just your walls.",
  },
  {
    id: 4,
    key: "mastery",
    name: "Mastery",
    age: "Crowns",
    place: "A name the realm has learned to say.",
    lord: "A name.",
    inciting: "Your first hero takes a slot.",
    payoff: "Legendary arms, the Catacombs cleared, a rank in the arena.",
  },
  {
    id: 5,
    key: "crown",
    name: "The Crown",
    age: "Dominion",
    place: "A seat. A crown. Yours.",
    lord: "A king.",
    inciting: "A castle stands vacant. You can take it.",
    payoff: "A crown, and a court of your own people.",
  },
];

/** Look up an act definition by id, clamped to the valid range. */
export function actDef(act: number): ActDef {
  return ACTS[Math.max(0, Math.min(5, Math.floor(act)))]!;
}
