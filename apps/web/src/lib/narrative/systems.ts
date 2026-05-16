/**
 * Per-system narrative framing — PLAYER_JOURNEY_GAMEPLAN.md §6.
 *
 * The Cairn's framing for the places of the game: the four city *types* (the
 * Arrival, §7.2), every estate building (§6.1–6.8), and the standalone systems
 * — the House, the Castle, the Shop (§6.5–6.7). Pure data; the screens read it.
 */
import { BuildingId } from "@/lib/hooks/useFeatureGate";

/** Framing for one city type. `type` matches the on-chain `cityType` (0–3). */
export interface CityTypeFraming {
  type: number;
  name: string;
  /** Glyph — matches the existing onboarding icons. */
  icon: string;
  /** What kind of life this ground offers. */
  line: string;
}

export const CITY_TYPES: readonly CityTypeFraming[] = [
  {
    type: 0,
    name: "Capital",
    icon: "♛",
    line: "Built on an old seat of power. The foundations run deep here — and so do the rivals who want them.",
  },
  {
    type: 1,
    name: "Trade",
    icon: "◆",
    line: "A crossroads. Coin and rumor move through these gates — and soon enough, word of you.",
  },
  {
    type: 2,
    name: "Combat",
    icon: "⚔",
    line: "Hard ground, close to the wild. Here a holding is tested early, and often.",
  },
  {
    type: 3,
    name: "Resource",
    icon: "⛏",
    line: "Built over what the old world buried. The digging is rich — and the digging is where the danger sleeps.",
  },
];

/** Framing for a city type, falling back to a neutral default for unknown values. */
export function cityType(type: number): CityTypeFraming {
  return (
    CITY_TYPES[type] ?? {
      type,
      name: "Settlement",
      icon: "◈",
      line: "Ground claimed from the ruins. What it becomes is the asking.",
    }
  );
}

/**
 * The Cairn's framing for one building. `role` is a short reframe of its terse
 * function label; `line` is the longer framing — a building as a place, not a
 * stat source. Keyed by `BuildingId`.
 */
export interface BuildingFraming {
  role: string;
  line: string;
}

export const BUILDING_FRAMING: Readonly<Record<number, BuildingFraming>> = {
  [BuildingId.Mansion]: {
    role: "Your hall",
    line: "The roof you sleep under. The holding is measured from this door outward.",
  },
  [BuildingId.Barracks]: {
    role: "Where soldiers are taken in",
    line: "Walls for the people who fight. They come up the road on a rumor; here is where they are kept.",
  },
  [BuildingId.Workshop]: {
    role: "Where broken things are mended",
    line: "The old world left a great deal broken. Little of it has to stay that way.",
  },
  [BuildingId.Vault]: {
    role: "The locked door",
    line: "A slow clock and a door that holds. What is set down here is meant to be kept.",
  },
  [BuildingId.Dock]: {
    role: "The water's edge",
    line: "Boats go out empty. They come back heavy, or they do not come back.",
  },
  [BuildingId.Forge]: {
    role: "Fire and a hammer",
    line: "Arms are not found in the ash. They are beaten out of it.",
  },
  [BuildingId.Market]: {
    role: "Where the holding trades",
    line: "The caravan road ends at this gate — the holding's one window on the world's commerce.",
  },
  [BuildingId.Academy]: {
    role: "Where knowledge is dug up",
    line: "The old world buried its learning with itself. Here it is brought back to the light.",
  },
  [BuildingId.Arena]: {
    role: "Ground for the testing",
    line: "Ground set aside for one lord to measure against another. Blood, by agreement.",
  },
  [BuildingId.Sanctuary]: {
    role: "The still room",
    line: "A hero sits here, and is quiet, and stands up sharper than they sat down.",
  },
  [BuildingId.Observatory]: {
    role: "The high window",
    line: "The stars were a map once, before the Sundering. They can be read again.",
  },
  [BuildingId.Treasury]: {
    role: "The counting-house",
    line: "Coin that is watched is coin that stays. The Treasury watches.",
  },
  [BuildingId.Citadel]: {
    role: "The high keep",
    line: "From the Citadel a lord calls others to march. The calling carries far.",
  },
  [BuildingId.Camp]: {
    role: "Where workers are taken in",
    line: "Walls for the people who labor — not soldiers, hands. A holding needs both kinds.",
  },
  [BuildingId.Mine]: {
    role: "The shaft into the dark",
    line: "The old world's wealth lies under the ground. So does the reason it stopped digging.",
  },
  [BuildingId.Catacombs]: {
    role: "The stair going down",
    line: "The dead city lies beneath the living one. It is not as empty as a grave should be.",
  },
  [BuildingId.Farm]: {
    role: "The worked ground",
    line: "Plain food, plainly grown. A holding eats before it fights.",
  },
  [BuildingId.Stables]: {
    role: "Horses and the road",
    line: "Past the Stables the map is larger than one holding. The road is how a lord reaches it.",
  },
  [BuildingId.Infirmary]: {
    role: "Where the wounded mend",
    line: "People spent in a fight are not always people lost. Some of them come back.",
  },
};

/** Framing for a building, falling back to a neutral default for unknown ids. */
export function buildingFraming(buildingId: number): BuildingFraming {
  return (
    BUILDING_FRAMING[buildingId] ?? {
      role: "A building of the holding",
      line: "Walls, and a use for them. The holding is the sum of these.",
    }
  );
}

/** Framing for a standalone system screen — the House, the Castle, the Shop. */
export interface SystemFraming {
  title: string;
  line: string;
}

export const SYSTEM_FRAMING: Readonly<Record<string, SystemFraming>> = {
  house: {
    title: "The Houses",
    line: "A lord with no House is a large hall and one man rattling in it. A House is a claim to legitimacy — and a debt, chosen well.",
  },
  castle: {
    title: "The Seat",
    line: "A castle is a seat of power, and power is a thing other lords come to take. To hold one is to be worth the coming.",
  },
  shop: {
    title: "The Caravan",
    line: "Merchants and charters reach a holding worth the visit. What they offer, they offer plainly — and the choosing is yours.",
  },
};

/** Framing for a system screen, falling back to a neutral default. */
export function systemFraming(key: string): SystemFraming {
  return (
    SYSTEM_FRAMING[key] ?? {
      title: "A place in the world",
      line: "Ground beyond the holding. What it is depends on what you do here.",
    }
  );
}
