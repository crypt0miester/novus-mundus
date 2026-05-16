/**
 * The Cairn's voice — PLAYER_JOURNEY_GAMEPLAN.md §4.
 *
 * Spare, declarative, exact. The Cairn states; it does not advise, comfort,
 * scold, or cheer. It speaks in no person — never "I". The flatness is the
 * character.
 *
 * Two things live here:
 *  - the *through-line*: what the Cairn names — the place and the lord, per
 *    act, bent by the estate's mood. This is the emotional spine.
 *  - the *beats*: named one-off lines for specific moments.
 *
 * Keyed by theme from day one (§11) so a future theme is a content drop, not a
 * rewrite. Only `medieval` is authored; the rest fall back to it.
 */
import type { Act, Axis, Mood, Theme } from "./types";

/** One axis-answer for one act: a canonical line plus optional mood-bent variants. */
interface AxisAnswer {
  canonical: string;
  /** Mood-bent overrides — used when the estate's mood matches (§4, principle 3). */
  moods?: Partial<Record<Mood, string>>;
}

interface CairnContent {
  /** The through-line: the place + lord answers, per act. */
  through: Record<Axis, Record<Act, AxisAnswer>>;
  /** Named beat lines for specific moments. */
  beats: Record<string, string>;
}

// Medieval — the authored theme.

const MEDIEVAL: CairnContent = {
  through: {
    place: {
      0: { canonical: "This is a ruin. It does not have to stay one." },
      1: {
        canonical: "A holding. Barely — but a holding.",
        moods: {
          raw: "Stakes in the mud, and the shape of walls to come. The start of a holding.",
          working: "A holding, and it is going up.",
          thriving: "A holding, and a good one.",
        },
      },
      2: {
        canonical: "A holding, and the road knows it now.",
        moods: {
          thriving: "A holding, and a good one. The road knows it.",
          threatened: "A holding — and someone is testing whether it stays one.",
        },
      },
      3: {
        canonical: "A House. A name, with people behind it.",
        moods: {
          threatened: "A House — and a House is a thing other Houses weigh.",
        },
      },
      4: {
        canonical: "A name the realm has learned to say.",
        moods: {
          threatened: "A name worth taking. That was always the cost of having one.",
        },
      },
      5: {
        canonical: "A seat. A crown. Yours.",
        moods: {
          threatened: "A crown. The having of it and the keeping of it are not the same.",
        },
      },
    },
    lord: {
      0: { canonical: "No one. A survivor, like the rest." },
      1: { canonical: "A lord of mud — but a lord." },
      2: { canonical: "A lord of mud, and still standing." },
      3: { canonical: "A lord with a House at his back." },
      4: { canonical: "A name." },
      5: { canonical: "A king." },
    },
  },
  beats: {
    arrival:
      "A dozen came up that road before you. They counted gold they did not have, and the road took them back. You drove your stakes instead. The stone is lit. — This is a ruin. It does not have to stay one.",
    firstBuilding:
      "Walls that meet at the corners. People died in this place once. Now it keeps the rain out. That is the whole distance traveled. It is not nothing.",
    protectionEnds:
      "The quiet held while the holding was small. It is not small now. Word has crossed the road: there is something here worth the walk. To be worth taking was the asking. It has arrived.",
    costlyDefeat:
      "People were spent here. Not numbers — people. They came because a rumor said this lord could keep them. The rumor is poorer tonight.",
    findingHouse:
      "The holding has reached the edge of one pair of hands. Past this line nothing is taken — it is given, and given is owed. A House is not friendship. It is debt, chosen well.",
    oath:
      "The oath is spoken. What a House gives is never a gift — it is given, and given is owed. You are sworn. From here the stone marks you, not only your walls.",
    actThree:
      "Every lord whose holding fell, the stone went dark the day they broke. It has not gone dark. — That is not counsel. It is only what the light is doing.",
    crown:
      "A ruin once asked what it could become. The question has its answer. — A crown. The climb earned it, stake by stake, stone by stone. The stone has marked the whole road. It marks this too: the place is yours.",
    coronation:
      "Stake by stake, stone by stone, the climb has its answer. A crown. A seat. A court of your own people around it. The place is yours — and the realm will have to come and take it to learn otherwise.",
    everyReturn:
      "You are back. The holding kept turning while you were gone.",
  },
};

// Theme registry.

const THEMES: Partial<Record<Theme, CairnContent>> = {
  medieval: MEDIEVAL,
};

function content(theme: Theme): CairnContent {
  return THEMES[theme] ?? MEDIEVAL;
}

// Selectors.

/**
 * The through-line — what the Cairn names. Returns the mood-bent variant when
 * one exists for the current mood, otherwise the canonical line.
 */
export function throughLine(
  axis: Axis,
  act: Act,
  mood: Mood,
  theme: Theme = "medieval",
): string {
  const answer = content(theme).through[axis][act];
  return answer.moods?.[mood] ?? answer.canonical;
}

/** A named beat line, or an empty string if the key is unknown. */
export function cairnBeat(key: string, theme: Theme = "medieval"): string {
  return content(theme).beats[key] ?? "";
}

// The Report — the Cairn's account of what moved while you were away (§8).

function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/** Cairn-voiced lines for the comeback Report. The caller supplies the data. */
export const cairnReport = {
  opener: (): string => cairnBeat("everyReturn"),
  buildingsRose: (names: string[]): string =>
    names.length === 1
      ? `${names[0]} stands now where it did not. People died in this place once. Now it keeps the rain out.`
      : `Walls met their corners while you were gone — ${list(names)} stand now.`,
  buildingsImproved: (names: string[]): string =>
    `Raised higher in your absence: ${list(names)}.`,
  attacked: (n: number): string =>
    n === 1
      ? "The holding was tested once while you were gone. It held."
      : `The holding was tested ${n} times while you were gone. It held.`,
  protectionEnded: (): string =>
    "The quiet has ended. Word has crossed the road: there is something here worth the walk.",
  joinedHouse: (): string =>
    "There is a House at your back now. Nothing it gave was free — but it was given.",
  unitsGained: (n: number): string =>
    n === 1
      ? "One more came up the road and stayed."
      : `${n} more came up the road and stayed.`,
  streakGained: (n: number): string =>
    n === 1
      ? "Another day kept. The stone counts it."
      : `${n} more days kept. The stone counts them.`,
};
