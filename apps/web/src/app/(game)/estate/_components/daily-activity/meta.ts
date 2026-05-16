import { BuildingType } from "novus-mundus-sdk";

/**
 * Client-side display metadata for the estate daily activities that have a UI.
 *
 * Phases 2-3 ship sixteen activities — fourteen graded mini-games and the two
 * Class A choices (Citadel, Sanctuary). Barracks and Forge (the Reflex
 * archetype) join once the timed protocol is built; extend `DAILY_ACTIVITIES`
 * as they land.
 */

/** How the activity is performed: a graded mini-game, or a one-tap choice. */
export type ActivityKind = "play" | "stance" | "blessing";

export interface ActivityMeta {
  building: number;
  title: string;
  tagline: string;
  kind: ActivityKind;
}

export const DAILY_ACTIVITIES: ActivityMeta[] = [
  // Dawn / Midday — economy & exploration
  {
    building: BuildingType.Workshop,
    title: "Scrap Sorting",
    tagline: "Sort the day's salvage by its grade.",
    kind: "play",
  },
  {
    building: BuildingType.Dock,
    title: "Catch of the Day",
    tagline: "Pick the nets that hauled a true catch.",
    kind: "play",
  },
  {
    building: BuildingType.Vault,
    title: "Security Inspection",
    tagline: "Flag the flawed wards before they fail.",
    kind: "play",
  },
  {
    building: BuildingType.Mine,
    title: "Prospector's Eye",
    tagline: "Pick the seams that run with gems.",
    kind: "play",
  },
  {
    building: BuildingType.Farm,
    title: "Harvest Sort",
    tagline: "Sort the ripe crops from the unripe.",
    kind: "play",
  },
  // Midday
  {
    building: BuildingType.Market,
    title: "Deal Finder",
    tagline: "Spot the genuine bargains among the traps.",
    kind: "play",
  },
  {
    building: BuildingType.Academy,
    title: "Daily Lecture",
    tagline: "Test your knowledge of the old world.",
    kind: "play",
  },
  {
    building: BuildingType.Arena,
    title: "Warm-Up Bout",
    tagline: "Order your counters to the opponent's tells.",
    kind: "play",
  },
  {
    building: BuildingType.TransportBay,
    title: "Route Planning",
    tagline: "Order the waypoints for the fastest road.",
    kind: "play",
  },
  // Dawn — military
  {
    building: BuildingType.Camp,
    title: "Muster Roll",
    tagline: "Assign the new recruits to their posts.",
    kind: "play",
  },
  {
    building: BuildingType.Barracks,
    title: "Morning Drill",
    tagline: "React to the sergeant's command.",
    kind: "play",
  },
  {
    building: BuildingType.Forge,
    title: "Fire the Furnace",
    tagline: "Release at the optimal heat.",
    kind: "play",
  },
  // Dusk
  {
    building: BuildingType.Observatory,
    title: "Star Reading",
    tagline: "Count the bright stars in each constellation.",
    kind: "play",
  },
  {
    building: BuildingType.Treasury,
    title: "Ledger Audit",
    tagline: "Match every entry in the ledger.",
    kind: "play",
  },
  {
    building: BuildingType.DungeonEntry,
    title: "Threshold Watch",
    tagline: "Set the warding glyphs in sequence.",
    kind: "play",
  },
  {
    building: BuildingType.Infirmary,
    title: "Triage",
    tagline: "Match each ailment to its remedy.",
    kind: "play",
  },
  {
    building: BuildingType.Citadel,
    title: "Watch Report",
    tagline: "Set how your estate stands for the day.",
    kind: "stance",
  },
  {
    building: BuildingType.MeditationChamber,
    title: "Hero Blessing",
    tagline: "Choose a hero to bless for the day.",
    kind: "blessing",
  },
];

export const ACTIVITY_BY_BUILDING = new Map(
  DAILY_ACTIVITIES.map((a) => [a.building, a]),
);

/**
 * The on-chain reward formula per building, mirroring the grading processor.
 * `kind` decides how the raw `base + score·perScore` value reads on the result
 * screen: a `percent` is `value / 100` rounded; a `count` is `base +
 * floor(score·perScore / 100)` items. `{n}` in `text` is the rendered value.
 */
interface RewardFormula {
  base: number;
  perScore: number;
  kind: "percent" | "count";
  text: string;
}

const REWARD_FORMULAS: Partial<Record<BuildingType, RewardFormula>> = {
  [BuildingType.Observatory]: {
    base: 500,
    perScore: 20,
    kind: "percent",
    text: "+{n}% loot find secured for today.",
  },
  [BuildingType.Treasury]: {
    base: 100,
    perScore: 800,
    kind: "count",
    text: "{n} NOVI minted to your treasury.",
  },
  [BuildingType.Workshop]: {
    base: 10,
    perScore: 55,
    kind: "count",
    text: "{n} common materials salvaged.",
  },
  [BuildingType.Dock]: {
    base: 10,
    perScore: 55,
    kind: "count",
    text: "{n} produce hauled in.",
  },
  [BuildingType.Vault]: {
    base: 50,
    perScore: 150,
    kind: "count",
    text: "{n} common materials secured.",
  },
  [BuildingType.Market]: {
    base: 500,
    perScore: 15,
    kind: "percent",
    text: "+{n}% shop discount for today.",
  },
  [BuildingType.Academy]: {
    base: 10,
    perScore: 40,
    kind: "count",
    text: "Research hastened — {n} mastery XP earned.",
  },
  [BuildingType.Arena]: {
    base: 500,
    perScore: 10,
    kind: "percent",
    text: "+{n}% arena damage for today.",
  },
  [BuildingType.Camp]: {
    base: 300,
    perScore: 9,
    kind: "percent",
    text: "+{n}% operative discount for today.",
  },
  [BuildingType.Barracks]: {
    base: 500,
    perScore: 10,
    kind: "percent",
    text: "+{n}% unit effectiveness for today.",
  },
  [BuildingType.Forge]: {
    base: 2500,
    perScore: 75,
    kind: "percent",
    text: "+{n}% mastery XP for today.",
  },
  [BuildingType.Mine]: {
    base: 5,
    perScore: 25,
    kind: "count",
    text: "{n} gems unearthed.",
  },
  [BuildingType.Farm]: {
    base: 10,
    perScore: 55,
    kind: "count",
    text: "{n} produce harvested.",
  },
  [BuildingType.DungeonEntry]: {
    base: 1,
    perScore: 4,
    kind: "count",
    text: "{n} dungeon fragments gathered.",
  },
  [BuildingType.TransportBay]: {
    base: 500,
    perScore: 15,
    kind: "percent",
    text: "+{n}% travel speed for today.",
  },
  [BuildingType.Infirmary]: {
    base: 200,
    perScore: 6,
    kind: "percent",
    text: "+{n}% unit recovery for today.",
  },
};

/** A human reward line for the result screen, from the on-chain reward formula. */
export function rewardSummary(building: number, score: number): string {
  const f = REWARD_FORMULAS[building as BuildingType];
  if (!f) return "Daily activity recorded.";
  const value =
    f.kind === "percent"
      ? ((f.base + score * f.perScore) / 100).toFixed(0)
      : (f.base + Math.floor((score * f.perScore) / 100)).toLocaleString();
  return f.text.replace("{n}", value);
}
