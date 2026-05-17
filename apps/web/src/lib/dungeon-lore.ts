/**
 * Dungeon lore — display data for the dungeon UI.
 *
 * Mechanical values mirror the program (`constants.rs`: RELIC_SYNERGY_TAGS,
 * RELIC_EFFECTS, SYNERGY_*_BONUS_BPS; `state/dungeon.rs`: RoomType,
 * DungeonTheme). The program refers to relics/themes/rooms by id only — the
 * names and flavor live here, the UI's lore layer.
 */

export interface SynergyInfo {
  id: number;
  name: string;
  blurb: string;
}

/** The 9 synergy tags relics are grouped under. */
export const SYNERGIES: SynergyInfo[] = [
  { id: 0, name: "Offense", blurb: "Raw damage." },
  { id: 1, name: "Defense", blurb: "Soak and survive." },
  { id: 2, name: "Crit", blurb: "Devastating strikes." },
  { id: 3, name: "Sustain", blurb: "Outlast the dungeon." },
  { id: 4, name: "Darkness", blurb: "Hold back the dark." },
  { id: 5, name: "Loot", blurb: "Richer spoils." },
  { id: 6, name: "Boss", blurb: "Giant-slaying." },
  { id: 7, name: "Hero", blurb: "Amplify your champion." },
  { id: 8, name: "Meta", blurb: "Bend the run's rules." },
];

/** 2-piece / 3-piece synergy bonus text, indexed by synergy id. */
const SYNERGY_BONUS: { two: string; three: string }[] = [
  { two: "+10% attack", three: "+25% attack, +10% crit" },
  { two: "+15% defense", three: "+30% defense, +10% unit HP" },
  { two: "+15% crit damage", three: "+40% crit damage" },
  { two: "+5% lifesteal", three: "+10% lifesteal" },
  { two: "−20% darkness", three: "darkness fully negated" },
  { two: "+20% loot", three: "+50% loot" },
  { two: "−10% boss power", three: "−25% boss power" },
  { two: "+10% hero effect", three: "+20% hero effect" },
  { two: "—", three: "—" },
];

export interface RelicInfo {
  id: number;
  name: string;
  /** Human-readable mechanical effect. */
  effect: string;
  /** Synergy tag id — mirrors the program's RELIC_SYNERGY_TAGS. */
  synergy: number;
  /** A one-shot or passive flag relic rather than a percentage buff. */
  flag?: boolean;
}

/** The 20 relics, by id. */
export const RELICS: RelicInfo[] = [
  { id: 0, name: "Whetstone Charm", effect: "+15% attack", synergy: 0 },
  { id: 1, name: "Aegis Sliver", effect: "+10% damage reduction", synergy: 1 },
  { id: 2, name: "Hawk-Eye Lens", effect: "+20% crit chance", synergy: 2 },
  { id: 3, name: "Cruel Edge", effect: "+30% crit damage", synergy: 2 },
  { id: 4, name: "Bloodroot Sigil", effect: "5% lifesteal", synergy: 3 },
  { id: 5, name: "Lantern Core", effect: "−30% darkness", synergy: 4 },
  { id: 6, name: "Magpie's Token", effect: "+25% loot", synergy: 5 },
  { id: 7, name: "Giant-Bane Rune", effect: "−15% boss power", synergy: 6 },
  { id: 8, name: "Bulwark Totem", effect: "+15% unit survival", synergy: 1 },
  { id: 9, name: "Champion's Banner", effect: "+25% hero effectiveness", synergy: 7 },
  { id: 10, name: "Prospector's Map", effect: "Guaranteed rare find", synergy: 5, flag: true },
  { id: 11, name: "Phoenix Feather", effect: "Revives you once on a wipe", synergy: 3, flag: true },
  { id: 12, name: "Berserker's Mask", effect: "+30% attack, +15% damage taken", synergy: 0 },
  { id: 13, name: "Unbreakable Oath", effect: "Cannot be one-shot", synergy: 1, flag: true },
  { id: 14, name: "Twin-Strike Glyph", effect: "15% chance to strike twice", synergy: 0 },
  { id: 15, name: "Midas Coin", effect: "Doubles NOVI rewards", synergy: 5 },
  { id: 16, name: "Void-Touched Eye", effect: "Immune to darkness crit penalty", synergy: 4, flag: true },
  { id: 17, name: "Glass Cannon", effect: "+50% attack, −30% defense", synergy: 0 },
  { id: 18, name: "Last Stand Idol", effect: "+40% attack below half units", synergy: 3 },
  { id: 19, name: "Seer's Dice", effect: "+1 relic choice next time", synergy: 8, flag: true },
];

/** Relic lookup by id. */
export function relicById(id: number): RelicInfo | undefined {
  return RELICS[id];
}

/** Decode a relic bitmask into the collected relics. */
export function relicsFromMask(mask: number): RelicInfo[] {
  return RELICS.filter((r) => (mask & (1 << r.id)) !== 0);
}

export interface SynergyState {
  id: number;
  name: string;
  count: number;
  /** 0 = inactive, 2 = 2-piece active, 3 = 3-piece active. */
  tier: 0 | 2 | 3;
  /** Active bonus text, empty when inactive. */
  bonus: string;
}

/** Per-synergy counts and the active tier for a set of collected relics. */
export function synergyStates(relics: RelicInfo[]): SynergyState[] {
  return SYNERGIES.map((s) => {
    const count = relics.filter((r) => r.synergy === s.id).length;
    const tier: 0 | 2 | 3 = count >= 3 ? 3 : count >= 2 ? 2 : 0;
    const bonus =
      tier === 3
        ? SYNERGY_BONUS[s.id].three
        : tier === 2
          ? SYNERGY_BONUS[s.id].two
          : "";
    return { id: s.id, name: s.name, count, tier, bonus };
  });
}

/** Dungeon themes, by DungeonTheme id. */
export const THEMES: Record<number, { name: string; blurb: string }> = {
  0: {
    name: "Hallowed Depths",
    blurb: "Foes recoil from light, but their aura sears you. Radiant damage cuts deepest.",
  },
  1: {
    name: "The Swarm Warren",
    blurb: "Quick, frenzied enemies. Trap-sense and speed win here.",
  },
  2: {
    name: "The Black Reach",
    blurb: "The dark itself feeds the enemies. Resist the darkness or be devoured.",
  },
  3: {
    name: "The Iron Vault",
    blurb: "Heavily plated foes. Siege and armor-piercing carry the day.",
  },
};

/** Room types, by RoomType id. */
export const ROOM_INFO: Record<
  number,
  { name: string; icon: string; blurb: string; combat: boolean }
> = {
  0: { name: "Combat", icon: "⚔", blurb: "A foe blocks the way — strike it down.", combat: true },
  1: { name: "Treasure", icon: "💰", blurb: "An untouched cache. Take the loot — no fight.", combat: false },
  2: { name: "Camp", icon: "⛺", blurb: "An abandoned camp. Found supplies grant a temporary buff.", combat: false },
  3: { name: "Rest", icon: "🛏", blurb: "A moment's safety — heal 20% of your fallen units.", combat: false },
  4: { name: "Trap", icon: "⚡", blurb: "A sprung trap. Take damage, but the ordeal grants bonus XP.", combat: false },
};
