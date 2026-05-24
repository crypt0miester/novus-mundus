/**
 * Subscription Tier Config Data — 4 tiers
 *
 * Mirrors the on-chain defaults in
 * `programs/novus_mundus/src/processor/initialization/game_engine.rs`.
 *
 * NOVI-denominated fields (`generationMultiplier`, `maxLockedNovi`, `novi`)
 * are stored on-chain with 1 decimal of precision — raw token-units =
 * display NOVI × 10. The values below are the raw counts that get written
 * straight into the GameEngine account. Run `bun run novus update
 * subscriptions` to push them to the live engine after edits here.
 *
 * Scaling guide:
 *   Cost ladder         $5 / $10 / $50 / $250         = 1 : 2 : 10 : 50
 *   NOVI perks          generation / cap / grant      = 1 : 2 : 10 : 50  (cost-linear)
 *   Standard stats      cash, DUs, OUs, weapons, armor = 1 : 2 : 5 : 12
 *   Superlinear         produce, vehicles              = 1 : 5 : 25 : 125
 *   Free stats          XP, reputation                 = 1 : 10 : 100 : 1000
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
    costInUsdCents: 500,                  // $5/month
    durationDays: 30,
    generationMultiplier: 500,            // 50 NOVI per 5 min
    maxLockedNovi: 30_000,                // 3,000 NOVI vault cap
    dailyRewardMultiplier: 10_000,        // 1.0×
    synchronyBonus: 0,
    novi: 25_000,                         // 2,500 NOVI sign-on bounty
    cash: 10_000_000,
    du1: 10_000, du2: 10_000, du3: 5_000,            // DU total 25k
    op1: 30_000, op2: 20_000, op3: 10_000,           // OU total 60k
    meleeWeapons: 20_000, rangedWeapons: 5_000, siegeWeapons: 0,  // weapons total 25k
    armor: 25_000,                        // = DU total
    produce: 50_000,
    vehicles: 50,
    reputation: 100,
    xp: 100,
    rallyCaps: {
      maxActiveRalliesJoined: 1,
      maxRalliesCreatedPerDay: 1,
      maxRallyTroopContribution: 10_000,
      maxRallySize: 3,
      maxRallyDurationSeconds: 3_600,
    },
    maxTeamMembers: 5,
    maxDailyTransferAmount: 0,            // Rookie: no transfers
    maxDailyTransferCount: 0,
    travelSpeedBonusBps: 0,
  },
  {
    name: 'Expert',
    tierIndex: 1,
    costInUsdCents: 1_000,                // $10/month
    durationDays: 30,
    generationMultiplier: 1_000,          // 100 NOVI per 5 min
    maxLockedNovi: 60_000,                // 6,000 NOVI vault cap
    dailyRewardMultiplier: 15_000,        // 1.5×
    synchronyBonus: 500,
    novi: 50_000,                         // 5,000 NOVI sign-on bounty
    cash: 50_000_000,
    du1: 20_000, du2: 20_000, du3: 10_000,           // DU total 50k
    op1: 60_000, op2: 40_000, op3: 20_000,           // OU total 120k
    meleeWeapons: 40_000, rangedWeapons: 8_000, siegeWeapons: 2_000,  // weapons total 50k
    armor: 50_000,
    produce: 250_000,
    vehicles: 250,
    reputation: 1_000,
    xp: 1_000,
    rallyCaps: {
      maxActiveRalliesJoined: 3,
      maxRalliesCreatedPerDay: 3,
      maxRallyTroopContribution: 50_000,
      maxRallySize: 5,
      maxRallyDurationSeconds: 7_200,
    },
    maxTeamMembers: 10,
    maxDailyTransferAmount: 1_000_000_000,            // 1B cash/day
    maxDailyTransferCount: 25,
    travelSpeedBonusBps: 1_000,                       // 10% faster travel
  },
  {
    name: 'Epic',
    tierIndex: 2,
    costInUsdCents: 5_000,                // $50/month
    durationDays: 30,
    generationMultiplier: 5_000,          // 500 NOVI per 5 min
    maxLockedNovi: 300_000,               // 30,000 NOVI vault cap
    dailyRewardMultiplier: 20_000,        // 2.0×
    synchronyBonus: 1_000,
    novi: 250_000,                        // 25,000 NOVI sign-on bounty
    cash: 200_000_000,
    du1: 50_000, du2: 50_000, du3: 25_000,           // DU total 125k
    op1: 150_000, op2: 100_000, op3: 50_000,         // OU total 300k
    meleeWeapons: 100_000, rangedWeapons: 20_000, siegeWeapons: 5_000,  // weapons total 125k
    armor: 125_000,
    produce: 1_250_000,
    vehicles: 1_250,
    reputation: 10_000,
    xp: 10_000,
    rallyCaps: {
      maxActiveRalliesJoined: 5,
      maxRalliesCreatedPerDay: 5,
      maxRallyTroopContribution: 200_000,
      maxRallySize: 10,
      maxRallyDurationSeconds: 21_600,
    },
    maxTeamMembers: 25,
    maxDailyTransferAmount: 25_000_000_000,           // 25B cash/day
    maxDailyTransferCount: 100,
    travelSpeedBonusBps: 2_500,                       // 25% faster travel
  },
  {
    name: 'Legendary',
    tierIndex: 3,
    costInUsdCents: 25_000,               // $250/month
    durationDays: 30,
    generationMultiplier: 25_000,         // 2,500 NOVI per 5 min
    maxLockedNovi: 1_500_000,             // 150,000 NOVI vault cap
    dailyRewardMultiplier: 30_000,        // 3.0×
    synchronyBonus: 1_500,
    novi: 1_250_000,                      // 125,000 NOVI sign-on bounty
    cash: 1_000_000_000,
    du1: 120_000, du2: 120_000, du3: 60_000,         // DU total 300k
    op1: 360_000, op2: 240_000, op3: 120_000,        // OU total 720k
    meleeWeapons: 240_000, rangedWeapons: 50_000, siegeWeapons: 10_000,  // weapons total 300k
    armor: 300_000,
    produce: 6_250_000,
    vehicles: 6_250,
    reputation: 100_000,
    xp: 100_000,
    rallyCaps: {
      maxActiveRalliesJoined: 10,
      maxRalliesCreatedPerDay: 10,
      maxRallyTroopContribution: 500_000,
      maxRallySize: 20,
      maxRallyDurationSeconds: 86_400,
    },
    maxTeamMembers: 50,
    // Rust source uses u64::MAX for an "unlimited" cap; JS number maxes out at
    // 2^53−1, well past any cash balance a player will ever realistically hold.
    maxDailyTransferAmount: Number.MAX_SAFE_INTEGER,
    maxDailyTransferCount: 255,                       // u8 max (effectively unlimited)
    travelSpeedBonusBps: 5_000,                       // 50% faster travel
  },
];
