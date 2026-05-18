/**
 * Subscription Tier Config Data — 4 tiers
 */

export interface RallyCapsData {
  maxActiveRalliesJoined: number;
  maxRalliesCreatedPerDay: number;
  maxRallyTroopContribution: number;
  maxRallySize: number;
  maxRallyDurationSeconds: number;
}

export interface SubscriptionTierData {
  name: string;
  tierIndex: number;
  costInUsdCents: number;
  durationDays: number;
  generationMultiplier: number;
  maxLockedNovi: number;
  dailyRewardMultiplier: number;
  synchronyBonus: number;
  novi: number;
  cash: number;
  du1: number;
  du2: number;
  du3: number;
  op1: number;
  op2: number;
  op3: number;
  meleeWeapons: number;
  rangedWeapons: number;
  siegeWeapons: number;
  armor: number;
  produce: number;
  vehicles: number;
  reputation: number;
  xp: number;
  rallyCaps: RallyCapsData;
  maxTeamMembers: number;
  maxDailyTransferAmount: number;
  maxDailyTransferCount: number;
  travelSpeedBonusBps: number;
}

export const SUBSCRIPTION_TIERS: SubscriptionTierData[] = [
  {
    name: 'Rookie',
    tierIndex: 0,
    costInUsdCents: 0,
    durationDays: 0,
    generationMultiplier: 100,
    maxLockedNovi: 100_000,
    dailyRewardMultiplier: 100,
    synchronyBonus: 0,
    novi: 0,
    cash: 0,
    du1: 0, du2: 0, du3: 0,
    op1: 0, op2: 0, op3: 0,
    meleeWeapons: 0, rangedWeapons: 0, siegeWeapons: 0,
    armor: 0, produce: 0, vehicles: 0,
    reputation: 0, xp: 0,
    rallyCaps: {
      maxActiveRalliesJoined: 1,
      maxRalliesCreatedPerDay: 1,
      maxRallyTroopContribution: 1000,
      maxRallySize: 5,
      maxRallyDurationSeconds: 3600,
    },
    maxTeamMembers: 5,
    maxDailyTransferAmount: 10_000,
    maxDailyTransferCount: 3,
    travelSpeedBonusBps: 0,
  },
  {
    name: 'Expert',
    tierIndex: 1,
    costInUsdCents: 999,
    durationDays: 30,
    generationMultiplier: 150,
    maxLockedNovi: 1_000_000,
    dailyRewardMultiplier: 150,
    synchronyBonus: 500,
    novi: 10_000,
    cash: 50_000,
    du1: 100, du2: 50, du3: 25,
    op1: 100, op2: 50, op3: 25,
    meleeWeapons: 50, rangedWeapons: 50, siegeWeapons: 10,
    armor: 50, produce: 200, vehicles: 10,
    reputation: 500, xp: 1000,
    rallyCaps: {
      maxActiveRalliesJoined: 3,
      maxRalliesCreatedPerDay: 3,
      maxRallyTroopContribution: 5000,
      maxRallySize: 10,
      maxRallyDurationSeconds: 7200,
    },
    maxTeamMembers: 15,
    maxDailyTransferAmount: 100_000,
    maxDailyTransferCount: 10,
    travelSpeedBonusBps: 1000,
  },
  {
    name: 'Epic',
    tierIndex: 2,
    costInUsdCents: 4999,
    durationDays: 30,
    generationMultiplier: 250,
    maxLockedNovi: 10_000_000,
    dailyRewardMultiplier: 200,
    synchronyBonus: 1500,
    novi: 100_000,
    cash: 500_000,
    du1: 500, du2: 250, du3: 100,
    op1: 500, op2: 250, op3: 100,
    meleeWeapons: 250, rangedWeapons: 250, siegeWeapons: 50,
    armor: 250, produce: 1000, vehicles: 50,
    reputation: 2500, xp: 5000,
    rallyCaps: {
      maxActiveRalliesJoined: 5,
      maxRalliesCreatedPerDay: 5,
      maxRallyTroopContribution: 20000,
      maxRallySize: 20,
      maxRallyDurationSeconds: 14400,
    },
    maxTeamMembers: 30,
    maxDailyTransferAmount: 1_000_000,
    maxDailyTransferCount: 25,
    travelSpeedBonusBps: 2500,
  },
  {
    name: 'Legendary',
    tierIndex: 3,
    costInUsdCents: 24999,
    durationDays: 30,
    generationMultiplier: 500,
    maxLockedNovi: 100_000_000,
    dailyRewardMultiplier: 300,
    synchronyBonus: 3000,
    novi: 1_000_000,
    cash: 5_000_000,
    du1: 2000, du2: 1000, du3: 500,
    op1: 2000, op2: 1000, op3: 500,
    meleeWeapons: 1000, rangedWeapons: 1000, siegeWeapons: 200,
    armor: 1000, produce: 5000, vehicles: 200,
    reputation: 10000, xp: 25000,
    rallyCaps: {
      maxActiveRalliesJoined: 10,
      maxRalliesCreatedPerDay: 10,
      maxRallyTroopContribution: 100000,
      maxRallySize: 50,
      maxRallyDurationSeconds: 28800,
    },
    maxTeamMembers: 50,
    maxDailyTransferAmount: 10_000_000,
    maxDailyTransferCount: 50,
    travelSpeedBonusBps: 5000,
  },
];
