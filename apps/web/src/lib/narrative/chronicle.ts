/**
 * The Chronicle — the journey, tracked. PLAYER_JOURNEY_GAMEPLAN.md §7.4.
 *
 * The journey's beats, grouped by act: the eleven onboarding steps absorbed
 * into acts 0–II and extended into III–V. Each beat carries the Cairn's
 * framing — why the next thing matters — not a bare task label.
 */
import { ExtensionFlags } from "novus-mundus-sdk";
import { BuildingId } from "@/lib/hooks/useFeatureGate";
import { getTotalUnits, hasBuildingAtLevel, hasExtension, hasTeam } from "./playerHelpers";
import type { Act } from "./types";

// Structural shapes — the real PlayerCore / EstateAccount satisfy these.

type Numeric = bigint;
interface SlotLike {
  buildingType: number;
  status: number;
  level: number;
}
interface PlayerView {
  extensions: number;
  defensiveUnit1: Numeric;
  defensiveUnit2: Numeric;
  defensiveUnit3: Numeric;
  operativeUnit1: Numeric;
  operativeUnit2: Numeric;
  operativeUnit3: Numeric;
  researchAttackBps: number;
  totalEncounterAttacks: Numeric;
  team?: { toBase58(): string } | null;
}
interface EstateView {
  buildings: SlotLike[];
}

/** The few facts a beat's completion is judged on. */
export interface ChronicleFacts {
  hasEstate: boolean;
  hasBuilding: (type: number, minLevel?: number) => boolean;
  units: number;
  researchDone: boolean;
  encountersFought: number;
  extensions: number;
  inHouse: boolean;
  ownsCastle: boolean;
}

/** Gather the chronicle facts from on-chain state. */
export function buildChronicleFacts(
  player: PlayerView | null | undefined,
  estate: EstateView | null | undefined,
  ownsCastle = false,
): ChronicleFacts {
  const buildings = estate?.buildings ?? [];
  return {
    hasEstate: !!estate,
    hasBuilding: (type, minLevel = 1) => hasBuildingAtLevel(buildings, type, minLevel),
    units: player ? getTotalUnits(player) : 0,
    researchDone: (player?.researchAttackBps ?? 0) > 0,
    encountersFought: player ? Number(player.totalEncounterAttacks) : 0,
    extensions: player?.extensions ?? 0,
    inHouse: !!player && hasTeam(player),
    ownsCastle,
  };
}

/** One beat of the journey. */
export interface JourneyBeat {
  act: Act;
  key: string;
  /** Plain label. */
  label: string;
  /** The Cairn's framing — why this beat matters. */
  framing: string;
  /** True once the beat is achieved. */
  done: (f: ChronicleFacts) => boolean;
}

export const JOURNEY_BEATS: readonly JourneyBeat[] = [
  {
    act: 0,
    key: "claim",
    label: "Claim the ground",
    framing: "Stakes in the dirt, and the ground answers. Everything starts here.",
    done: (f) => f.hasEstate,
  },
  {
    act: 1,
    key: "barracks",
    label: "Raise the Barracks",
    framing: "Walls for the people who fight. A holding needs them before it needs anything else.",
    done: (f) => f.hasBuilding(BuildingId.Barracks),
  },
  {
    act: 1,
    key: "camp",
    label: "Raise the Camp",
    framing: "Walls for the people who work. The other half of a holding.",
    done: (f) => f.hasBuilding(BuildingId.Camp),
  },
  {
    act: 1,
    key: "hire",
    label: "Take in your first people",
    framing: "Word crossed the road. Someone walked here to find out if it was true.",
    done: (f) => f.units > 0,
  },
  {
    act: 1,
    key: "market",
    label: "Raise the Market",
    framing: "The holding's first window on the world — a place to trade what the land gives.",
    done: (f) => f.hasBuilding(BuildingId.Market),
  },
  {
    act: 2,
    key: "academy",
    label: "Raise the Academy",
    framing: "The old world left knowledge in the ash. The Academy is where it is dug up.",
    done: (f) => f.hasBuilding(BuildingId.Academy),
  },
  {
    act: 2,
    key: "research",
    label: "Turn knowledge to use",
    framing: "Old-world method, relearned. The holding is sharper for it.",
    done: (f) => f.researchDone,
  },
  {
    act: 2,
    key: "stables",
    label: "Raise the Stables",
    framing: "The road out. Past the Stables, the map is larger than one holding.",
    done: (f) => f.hasBuilding(BuildingId.Stables),
  },
  {
    act: 2,
    key: "first-blood",
    label: "Survive an encounter",
    framing: "The wild does not knock. It came, and the holding still stands.",
    done: (f) => f.encountersFought > 0,
  },
  {
    act: 3,
    key: "house",
    label: "Swear into a House",
    framing:
      "Past the reach of one pair of hands. A House is not friendship — it is debt, chosen well.",
    done: (f) => f.inHouse,
  },
  {
    act: 4,
    key: "heroes",
    label: "Put a name to arms",
    framing: "The realm has begun to learn your name. Heroes answer to it.",
    done: (f) => hasExtension(f, ExtensionFlags.HEROES),
  },
  {
    act: 5,
    key: "crown",
    label: "Take a crown",
    framing: "A ruin once asked what it could become. A seat. A crown. The climb earned it.",
    done: (f) => f.ownsCastle,
  },
];

/** The keys of all beats currently achieved. */
export function beatsDone(facts: ChronicleFacts): Set<string> {
  return new Set(JOURNEY_BEATS.filter((b) => b.done(facts)).map((b) => b.key));
}

/** The first unachieved beat — the next thing on the climb. */
export function nextBeat(facts: ChronicleFacts): JourneyBeat | null {
  return JOURNEY_BEATS.find((b) => !b.done(facts)) ?? null;
}
