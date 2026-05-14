/**
 * Player Tier Configurations for create-player command.
 *
 * Each tier defines resources, buildings, and research to set up players
 * at different power levels for testing and development.
 */

import { BuildingType } from '../../src/types/enums';

export interface PlayerTierConfig {
  name: string;
  estate: boolean;
  gemPurchases: number;
  buildings: BuildingType[];
  noviAmount: number;
  units: { type: number; noviAmount: number }[];
  equipment: { type: number; quantity: number }[];
  research: { type: number; targetLevel: number }[];
}

export const PLAYER_TIERS: Record<string, PlayerTierConfig> = {
  beginner: {
    name: 'Beginner',
    estate: false,
    gemPurchases: 0,
    buildings: [],
    noviAmount: 0,
    units: [],
    equipment: [],
    research: [],
  },

  advanced: {
    name: 'Advanced',
    estate: true,
    gemPurchases: 10,
    buildings: [
      BuildingType.Mansion,
      BuildingType.Barracks,
      BuildingType.Market,
    ],
    noviAmount: 50_000,
    units: [
      { type: 0, noviAmount: 200 },  // defensive_unit_1
      { type: 2, noviAmount: 200 },  // operative_unit_1
    ],
    equipment: [
      { type: 0, quantity: 50 },   // melee weapons
      { type: 3, quantity: 100 },  // armor
    ],
    research: [
      { type: 0, targetLevel: 1 },  // Attack Lv1
    ],
  },

  epic: {
    name: 'Epic',
    estate: true,
    gemPurchases: 50,
    buildings: [
      BuildingType.Mansion,
      BuildingType.Barracks,
      BuildingType.Market,
      BuildingType.TransportBay,
      BuildingType.Workshop,
      BuildingType.Academy,
      BuildingType.Citadel,
    ],
    noviAmount: 500_000,
    units: [
      { type: 0, noviAmount: 1000 },  // defensive_unit_1
      { type: 1, noviAmount: 500 },   // defensive_unit_2
      { type: 2, noviAmount: 1000 },  // operative_unit_1
      { type: 3, noviAmount: 500 },   // operative_unit_2
    ],
    equipment: [
      { type: 0, quantity: 50 },   // melee weapons
      { type: 1, quantity: 100 },  // ranged weapons
      { type: 2, quantity: 50 },   // siege weapons
      { type: 3, quantity: 100 },  // armor
    ],
    research: [
      { type: 0, targetLevel: 3 },  // Attack Lv3
      { type: 1, targetLevel: 3 },  // Defense Lv3
      { type: 2, targetLevel: 3 },  // Economy Lv3
    ],
  },

  legendary: {
    name: 'Legendary',
    estate: true,
    gemPurchases: 200,
    buildings: [
      BuildingType.Mansion,
      BuildingType.Barracks,
      BuildingType.Workshop,
      BuildingType.Vault,
      BuildingType.Dock,
      BuildingType.Forge,
      BuildingType.Market,
      BuildingType.Academy,
      BuildingType.Arena,
      BuildingType.MeditationChamber,
      BuildingType.Observatory,
      BuildingType.Treasury,
      BuildingType.Citadel,
      BuildingType.Camp,
      BuildingType.Mine,
      BuildingType.DungeonEntry,
      BuildingType.Farm,
      BuildingType.TransportBay,
      BuildingType.Infirmary,
    ],
    noviAmount: 5_000_000,
    units: [
      { type: 0, noviAmount: 5000 },  // defensive_unit_1
      { type: 1, noviAmount: 5000 },  // defensive_unit_2
      { type: 2, noviAmount: 5000 },  // operative_unit_1
      { type: 3, noviAmount: 5000 },  // operative_unit_2
      { type: 4, noviAmount: 5000 },  // specialist_unit_1
      { type: 5, noviAmount: 5000 },  // specialist_unit_2
    ],
    equipment: [
      { type: 0, quantity: 500 },  // melee weapons
      { type: 1, quantity: 500 },  // ranged weapons
      { type: 2, quantity: 200 },  // siege weapons
      { type: 3, quantity: 500 },  // armor
    ],
    research: [
      { type: 0, targetLevel: 5 },  // Attack Lv5
      { type: 1, targetLevel: 5 },  // Defense Lv5
      { type: 2, targetLevel: 5 },  // Economy Lv5
      { type: 3, targetLevel: 5 },  // Logistics Lv5
      { type: 4, targetLevel: 5 },  // Intelligence Lv5
    ],
  },
};
