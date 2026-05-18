/**
 * Arena Season Data
 */

export interface ArenaSeasonData {
  seasonId: number;
  masterPrizePool: number;
  dailyPrizePool: number;
  dailyDistributionCap: number;
  minLevelRequired: number;
}

export const ARENA_SEASON: ArenaSeasonData = {
  seasonId: 1,
  masterPrizePool: 500_000,
  dailyPrizePool: 10_000,
  dailyDistributionCap: 50_000,
  minLevelRequired: 10,
};
