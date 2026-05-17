import { BuildingType } from "novus-mundus-sdk";
import type { ArchetypeName, Difficulty } from "./types";
import loreQuiz from "./content/lore-quiz.json";
import triage from "./content/triage.json";

/**
 * Which mini-game each estate building runs — archetype, per-building
 * difficulty knobs, player-facing flavor, and optional archetype content
 * (flavor labels, or a question bank).
 *
 * Phases 1-3 cover the fourteen graded buildings. Barracks and Forge (the
 * Reflex archetype) join once the timed long-poll protocol is built; Citadel
 * and Sanctuary are Class A choices and need no archetype here.
 */
export interface BuildingMinigame {
  archetype: ArchetypeName;
  difficulty: Difficulty;
  flavor: { title: string; tagline: string };
  /** Archetype-specific content — flavor labels, or an MCQ question bank. */
  content?: unknown;
}

const ESTATE_MINIGAMES: Partial<Record<BuildingType, BuildingMinigame>> = {
  // Dusk — MCQ / Memory (Phase 1-2 reference buildings)
  [BuildingType.Observatory]: {
    archetype: "mcq",
    difficulty: { questions: 5, options: 4, minStars: 3, maxStars: 9 },
    flavor: {
      title: "Star Reading",
      tagline: "Count the bright stars in each constellation.",
    },
  },
  [BuildingType.Treasury]: {
    archetype: "memory",
    difficulty: { pairs: 6 },
    flavor: {
      title: "Ledger Audit",
      tagline: "Match every entry in the ledger.",
    },
  },

  // MCQ — knowledge banks
  [BuildingType.Academy]: {
    archetype: "mcq",
    difficulty: { questions: 5 },
    flavor: {
      title: "Daily Lecture",
      tagline: "Test your knowledge of the old world.",
    },
    content: loreQuiz,
  },
  [BuildingType.Infirmary]: {
    archetype: "mcq",
    difficulty: { questions: 5 },
    flavor: {
      title: "Triage",
      tagline: "Match each ailment to its remedy.",
    },
    content: triage,
  },

  // SetSelect — pick the items where one value beats the other
  [BuildingType.Market]: {
    archetype: "set-select",
    difficulty: { items: 6 },
    flavor: {
      title: "Deal Finder",
      tagline: "Spot the genuine bargains among the traps.",
    },
    content: {
      instruction: "Tap the genuine bargains — a deal is real when the price sits below the value.",
      aLabel: "Price",
      bLabel: "Value",
      names: ["Iron", "Hide", "Salt", "Rope", "Grain", "Pelt", "Oil", "Cloth"],
    },
  },
  [BuildingType.Dock]: {
    archetype: "set-select",
    difficulty: { items: 6 },
    flavor: {
      title: "Catch of the Day",
      tagline: "Pick the nets that hauled a true catch.",
    },
    content: {
      instruction: "Pick the nets that hauled a true catch — a net runs full when the catch beats the cast.",
      aLabel: "Cast",
      bLabel: "Catch",
      names: ["North Net", "Reef Net", "Deep Line", "Tide Trap", "Drift Net", "Weir", "Pole Line", "Crab Pot"],
    },
  },
  [BuildingType.Vault]: {
    archetype: "set-select",
    difficulty: { items: 6 },
    flavor: {
      title: "Security Inspection",
      tagline: "Flag the flawed wards before they fail.",
    },
    content: {
      instruction: "Flag the flawed wards — a ward is flawed when its strength falls short of the strain on it.",
      aLabel: "Strength",
      bLabel: "Strain",
      names: ["Iron Ward", "Stone Seal", "Old Lock", "Rune Bar", "Deadbolt", "Chain Gate", "Watch Glyph", "Trap Sill"],
    },
  },
  [BuildingType.Mine]: {
    archetype: "set-select",
    difficulty: { items: 6 },
    flavor: {
      title: "Prospector's Eye",
      tagline: "Pick the seams that run with gems.",
    },
    content: {
      instruction: "Pick the gem-bearing seams — a seam runs rich when its glint outshines its dross.",
      aLabel: "Dross",
      bLabel: "Glint",
      names: ["North Seam", "Deep Seam", "Cliff Vein", "Old Shaft", "Ash Vein", "Low Cut", "Drift Seam", "Quartz Run"],
    },
  },

  // Assignment — sort each item into its bin by a reading
  [BuildingType.Workshop]: {
    archetype: "assignment",
    difficulty: { items: 6, bins: 3 },
    flavor: {
      title: "Scrap Sorting",
      tagline: "Sort the day's salvage by its grade.",
    },
    content: {
      instruction: "Sort each piece of salvage into its grade by the purity reading.",
      valueLabel: "Purity",
      bins: ["Common", "Uncommon", "Rare"],
      names: ["Bent Nail", "Cracked Plate", "Hinge", "Coil", "Strut", "Bracket", "Rivet Bag", "Gear Tooth"],
    },
  },
  [BuildingType.Camp]: {
    archetype: "assignment",
    difficulty: { items: 6, bins: 3 },
    flavor: {
      title: "Muster Roll",
      tagline: "Assign the new recruits to their posts.",
    },
    content: {
      instruction: "Assign each recruit to a post by their aptitude reading.",
      valueLabel: "Aptitude",
      bins: ["Watch", "Patrol", "Vanguard"],
      names: ["Recruit Vael", "Recruit Orin", "Recruit Sable", "Recruit Rook", "Recruit Wren", "Recruit Calla", "Recruit Dane", "Recruit Pike"],
    },
  },
  [BuildingType.Farm]: {
    archetype: "assignment",
    difficulty: { items: 6, bins: 2 },
    flavor: {
      title: "Harvest Sort",
      tagline: "Sort the ripe crops from the unripe.",
    },
    content: {
      instruction: "Sort the harvest by its ripeness reading — what is not yet ripe is set aside.",
      valueLabel: "Ripeness",
      bins: ["Unripe", "Ripe"],
      names: ["Ashgrain", "Emberroot", "Brimrice", "Soot Melon", "Cinder Bean", "Husk Gourd", "Coalcorn", "Glasswheat"],
    },
  },

  // Reflex — timed Class C games
  [BuildingType.Barracks]: {
    archetype: "reflex",
    difficulty: { rounds: 12, targetMs: 280, floorMs: 620 },
    flavor: {
      title: "Morning Drill",
      tagline: "React to the sergeant's command — strike on the signal.",
    },
    content: { mode: "react" },
  },
  [BuildingType.Forge]: {
    archetype: "reflex",
    difficulty: { rounds: 3, tolerancePct: 26 },
    flavor: {
      title: "Fire the Furnace",
      tagline: "Release at the optimal heat — not a moment early or late.",
    },
    content: { mode: "precision" },
  },

  // Ordering — arrange the items by a metric
  [BuildingType.Arena]: {
    archetype: "ordering",
    difficulty: { items: 5 },
    flavor: {
      title: "Warm-Up Bout",
      tagline: "Order your counters to the opponent's tells.",
    },
    content: {
      instruction: "Read the tells — order your counters from the weakest opening to the strongest.",
      metricLabel: "Tell",
      names: ["Low Guard", "Feint", "Cross Step", "Shoulder Drop", "High Guard", "Pivot", "Bind"],
      ascending: true,
    },
  },
  [BuildingType.DungeonEntry]: {
    archetype: "ordering",
    difficulty: { items: 5 },
    flavor: {
      title: "Threshold Watch",
      tagline: "Set the warding glyphs in sequence.",
    },
    content: {
      instruction: "Set the warding glyphs in their proper order, the faintest ward first.",
      metricLabel: "Ward",
      names: ["Glyph of Salt", "Glyph of Iron", "Glyph of Ash", "Glyph of Bone", "Glyph of Deep", "Glyph of Watch", "Glyph of Seal"],
      ascending: true,
    },
  },
  [BuildingType.TransportBay]: {
    archetype: "ordering",
    difficulty: { items: 5 },
    flavor: {
      title: "Route Planning",
      tagline: "Order the waypoints for the fastest road.",
    },
    content: {
      instruction: "Plan the route — order the waypoints from nearest to farthest.",
      metricLabel: "Leagues",
      names: ["Old Bridge", "Mill Ford", "Ash Crossing", "Salt Road", "Ruin Gate", "Cliff Path", "Deepwood"],
      ascending: true,
    },
  },
};

/** The mini-game config for a building, or undefined if it has none. */
export function getBuildingMinigame(building: number): BuildingMinigame | undefined {
  return ESTATE_MINIGAMES[building as BuildingType];
}
