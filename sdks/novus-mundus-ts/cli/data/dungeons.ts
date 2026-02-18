/**
 * Dungeon Template Data
 */

export interface DungeonTemplateData {
  templateId: number;
  name: string;
  theme: number;           // 0=Crypts, 1=Caverns, 2=Abyss, 3=Forge
  totalFloors: number;
  roomsPerFloor: number;
  checkpointInterval: number;
  minPlayerLevel: number;
  requiredBuildingLevel: number;
  staminaCost: number;
  bossPowerMultiplier: number;
  floorPower: number[];
  combatWeight: number;
  treasureWeight: number;
  campWeight: number;
  restWeight: number;
  trapWeight: number;
  darknessBaseBps: number;
  darknessPerFloorBps: number;
  timeLimitSeconds: number;
  baseXpPerRoom: number;
  baseNoviPerFloor: number;
  completionBonusBps: number;
  rewardScalingBps: number;
}

export const DUNGEONS: DungeonTemplateData[] = [
  {
    templateId: 1,
    name: 'Goblin Caves',
    theme: 0,
    totalFloors: 5,
    roomsPerFloor: 4,
    checkpointInterval: 2,
    minPlayerLevel: 5,
    requiredBuildingLevel: 0,
    staminaCost: 10,
    bossPowerMultiplier: 15000,
    floorPower: [100, 150, 200, 250, 350],
    combatWeight: 4000,
    treasureWeight: 2000,
    campWeight: 1500,
    restWeight: 1500,
    trapWeight: 1000,
    darknessBaseBps: 500,
    darknessPerFloorBps: 200,
    timeLimitSeconds: 1800,
    baseXpPerRoom: 50,
    baseNoviPerFloor: 100,
    completionBonusBps: 5000,
    rewardScalingBps: 1500,
  },
  {
    templateId: 2,
    name: 'Shadow Crypt',
    theme: 1,
    totalFloors: 8,
    roomsPerFloor: 5,
    checkpointInterval: 3,
    minPlayerLevel: 15,
    requiredBuildingLevel: 0,
    staminaCost: 20,
    bossPowerMultiplier: 20000,
    floorPower: [200, 280, 360, 440, 520, 600, 700, 850],
    combatWeight: 4500,
    treasureWeight: 1500,
    campWeight: 1000,
    restWeight: 1500,
    trapWeight: 1500,
    darknessBaseBps: 1000,
    darknessPerFloorBps: 300,
    timeLimitSeconds: 2700,
    baseXpPerRoom: 100,
    baseNoviPerFloor: 250,
    completionBonusBps: 6000,
    rewardScalingBps: 2000,
  },
  {
    templateId: 3,
    name: "Dragon's Lair",
    theme: 2,
    totalFloors: 10,
    roomsPerFloor: 6,
    checkpointInterval: 3,
    minPlayerLevel: 30,
    requiredBuildingLevel: 0,
    staminaCost: 35,
    bossPowerMultiplier: 30000,
    floorPower: [400, 500, 600, 720, 850, 1000, 1200, 1400, 1650, 2000],
    combatWeight: 5000,
    treasureWeight: 1500,
    campWeight: 500,
    restWeight: 1000,
    trapWeight: 2000,
    darknessBaseBps: 1500,
    darknessPerFloorBps: 400,
    timeLimitSeconds: 3600,
    baseXpPerRoom: 200,
    baseNoviPerFloor: 500,
    completionBonusBps: 7500,
    rewardScalingBps: 2500,
  },
  {
    templateId: 4,
    name: 'Abyssal Depths',
    theme: 3,
    totalFloors: 10,
    roomsPerFloor: 7,
    checkpointInterval: 4,
    minPlayerLevel: 50,
    requiredBuildingLevel: 0,
    staminaCost: 50,
    bossPowerMultiplier: 40000,
    floorPower: [800, 1000, 1250, 1500, 1800, 2200, 2600, 3100, 3700, 4500],
    combatWeight: 5500,
    treasureWeight: 1000,
    campWeight: 500,
    restWeight: 500,
    trapWeight: 2500,
    darknessBaseBps: 2000,
    darknessPerFloorBps: 500,
    timeLimitSeconds: 5400,
    baseXpPerRoom: 400,
    baseNoviPerFloor: 1000,
    completionBonusBps: 10000,
    rewardScalingBps: 3000,
  },
];
