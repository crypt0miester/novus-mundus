/**
 * Account Router
 *
 * Routes raw account bytes to the correct deserializer based on byte 0 (AccountKey).
 */

import { AccountKey } from '../types/enums';

import { deserializeGameEngine, type GameEngine } from './game-engine';
import { deserializePlayer, type PlayerCore } from './player';
import { deserializeUser, type UserAccount } from './user';
import { deserializeCity, type CityAccount } from './city';
import { deserializeTeam, deserializeTeamMemberSlot, deserializeTeamInvite, deserializeTreasuryRequest, type TeamAccount, type TeamMemberSlot, type TeamInviteAccount, type TreasuryRequest } from './team';
import { deserializeEncounter, type EncounterAccount } from './encounter';
import { deserializeLoot, type LootAccount } from './loot';
import { deserializeRally, deserializeRallyParticipant, type RallyAccount, type RallyParticipant } from './rally';
import { deserializeReinforcement, type ReinforcementAccount } from './reinforcement';
import { deserializeEvent, deserializeEventParticipation, type EventAccount, type EventParticipation } from './event';
import { deserializeExpedition, type ExpeditionAccount } from './expedition';
import { deserializeArenaSeason, deserializeArenaParticipant, deserializeArenaLoadout, type ArenaSeasonAccount, type ArenaParticipantAccount, type ArenaLoadoutAccount } from './arena';
import { deserializeShopConfig, deserializeShopItem, deserializeBundle, deserializeFlashSale, deserializeDailyDeal, deserializeWeeklySale, deserializeSeasonalSale, deserializeDaoPromotion, deserializeAllowedToken, deserializePlayerPurchase, type ShopConfigAccount, type ShopItemAccount, type BundleAccount, type FlashSaleAccount, type DailyDealAccount, type WeeklySaleAccount, type SeasonalSaleAccount, type DAOPromotionAccount, type AllowedTokenAccount, type PlayerPurchaseAccount } from './shop';
import { deserializeCastle, deserializeKingRegistry, deserializeCourtPosition, deserializeGarrisonContribution, deserializeTeamCastleReward, type CastleAccount, type KingRegistryAccount, type CourtPositionAccount, type GarrisonContributionAccount, type TeamCastleRewardAccount } from './castle';
import { deserializeDungeonRun, deserializeDungeonTemplate, deserializeDungeonLeaderboard, type DungeonRunAccount, type DungeonTemplateAccount, type DungeonLeaderboardAccount } from './dungeon';
import { deserializeEstate, type EstateAccount } from './estate';
import { deserializeLocation, type LocationAccount } from './location';
import { deserializeResearchTemplate, deserializeResearchProgress, type ResearchTemplateAccount, type ResearchProgressAccount } from './research';
import { deserializeHeroTemplate, type HeroTemplateAccount } from './hero';
import { deserializeBuildingTemplate, type BuildingTemplateAccount } from './building-template';

// Routed Account Types

export type RoutedAccount =
  | { key: AccountKey.GameEngine; account: GameEngine }
  | { key: AccountKey.Player; account: PlayerCore }
  | { key: AccountKey.User; account: UserAccount }
  | { key: AccountKey.City; account: CityAccount }
  | { key: AccountKey.Team; account: TeamAccount }
  | { key: AccountKey.TeamMemberSlot; account: TeamMemberSlot }
  | { key: AccountKey.TeamInvite; account: TeamInviteAccount }
  | { key: AccountKey.TreasuryRequest; account: TreasuryRequest }
  | { key: AccountKey.Encounter; account: EncounterAccount }
  | { key: AccountKey.Loot; account: LootAccount }
  | { key: AccountKey.Rally; account: RallyAccount }
  | { key: AccountKey.RallyParticipant; account: RallyParticipant }
  | { key: AccountKey.Reinforcement; account: ReinforcementAccount }
  | { key: AccountKey.Event; account: EventAccount }
  | { key: AccountKey.EventParticipation; account: EventParticipation }
  | { key: AccountKey.Expedition; account: ExpeditionAccount }
  | { key: AccountKey.ArenaSeason; account: ArenaSeasonAccount }
  | { key: AccountKey.ArenaParticipant; account: ArenaParticipantAccount }
  | { key: AccountKey.ArenaLoadout; account: ArenaLoadoutAccount }
  | { key: AccountKey.ShopConfig; account: ShopConfigAccount }
  | { key: AccountKey.ShopItem; account: ShopItemAccount }
  | { key: AccountKey.ShopBundle; account: BundleAccount }
  | { key: AccountKey.FlashSale; account: FlashSaleAccount }
  | { key: AccountKey.DailyDeal; account: DailyDealAccount }
  | { key: AccountKey.WeeklySale; account: WeeklySaleAccount }
  | { key: AccountKey.SeasonalSale; account: SeasonalSaleAccount }
  | { key: AccountKey.DaoPromotion; account: DAOPromotionAccount }
  | { key: AccountKey.AllowedToken; account: AllowedTokenAccount }
  | { key: AccountKey.PlayerPurchase; account: PlayerPurchaseAccount }
  | { key: AccountKey.Castle; account: CastleAccount }
  | { key: AccountKey.CastleGarrison; account: GarrisonContributionAccount }
  | { key: AccountKey.KingRegistry; account: KingRegistryAccount }
  | { key: AccountKey.CourtPosition; account: CourtPositionAccount }
  | { key: AccountKey.TeamCastleReward; account: TeamCastleRewardAccount }
  | { key: AccountKey.DungeonRun; account: DungeonRunAccount }
  | { key: AccountKey.DungeonTemplate; account: DungeonTemplateAccount }
  | { key: AccountKey.DungeonLeaderboard; account: DungeonLeaderboardAccount }
  | { key: AccountKey.Estate; account: EstateAccount }
  | { key: AccountKey.Location; account: LocationAccount }
  | { key: AccountKey.ResearchTemplate; account: ResearchTemplateAccount }
  | { key: AccountKey.ResearchProgress; account: ResearchProgressAccount }
  | { key: AccountKey.HeroTemplate; account: HeroTemplateAccount }
  | { key: AccountKey.BuildingTemplate; account: BuildingTemplateAccount };

// Router

/**
 * Deserialize any Novus Mundus account by reading byte 0 as AccountKey
 * and dispatching to the correct deserializer.
 *
 * @param data - Raw account bytes
 * @returns Discriminated union of { key, account }
 * @throws Error if account key is unknown or deserialization fails
 */
export function deserializeAnyAccount(data: Uint8Array): RoutedAccount {
  if (data.length === 0) {
    throw new Error('Empty account data');
  }

  const key = data[0] as AccountKey;

  switch (key) {
    case AccountKey.GameEngine:
      return { key, account: deserializeGameEngine(data) };
    case AccountKey.Player:
      return { key, account: deserializePlayer(data) };
    case AccountKey.User:
      return { key, account: deserializeUser(data) };
    case AccountKey.City:
      return { key, account: deserializeCity(data) };
    case AccountKey.Team:
      return { key, account: deserializeTeam(data) };
    case AccountKey.TeamMemberSlot:
      return { key, account: deserializeTeamMemberSlot(data) };
    case AccountKey.TeamInvite:
      return { key, account: deserializeTeamInvite(data) };
    case AccountKey.TreasuryRequest:
      return { key, account: deserializeTreasuryRequest(data) };
    case AccountKey.Encounter:
      return { key, account: deserializeEncounter(data) };
    case AccountKey.Loot:
      return { key, account: deserializeLoot(data) };
    case AccountKey.Rally:
      return { key, account: deserializeRally(data) };
    case AccountKey.RallyParticipant:
      return { key, account: deserializeRallyParticipant(data) };
    case AccountKey.Reinforcement:
      return { key, account: deserializeReinforcement(data) };
    case AccountKey.Event:
      return { key, account: deserializeEvent(data) };
    case AccountKey.EventParticipation:
      return { key, account: deserializeEventParticipation(data) };
    case AccountKey.Expedition:
      return { key, account: deserializeExpedition(data) };
    case AccountKey.ArenaSeason:
      return { key, account: deserializeArenaSeason(data) };
    case AccountKey.ArenaParticipant:
      return { key, account: deserializeArenaParticipant(data) };
    case AccountKey.ArenaLoadout:
      return { key, account: deserializeArenaLoadout(data) };
    case AccountKey.ShopConfig:
      return { key, account: deserializeShopConfig(data) };
    case AccountKey.ShopItem:
      return { key, account: deserializeShopItem(data) };
    case AccountKey.ShopBundle:
      return { key, account: deserializeBundle(data) };
    case AccountKey.FlashSale:
      return { key, account: deserializeFlashSale(data) };
    case AccountKey.DailyDeal:
      return { key, account: deserializeDailyDeal(data) };
    case AccountKey.WeeklySale:
      return { key, account: deserializeWeeklySale(data) };
    case AccountKey.SeasonalSale:
      return { key, account: deserializeSeasonalSale(data) };
    case AccountKey.DaoPromotion:
      return { key, account: deserializeDaoPromotion(data) };
    case AccountKey.AllowedToken:
      return { key, account: deserializeAllowedToken(data) };
    case AccountKey.PlayerPurchase:
      return { key, account: deserializePlayerPurchase(data) };
    case AccountKey.Castle:
      return { key, account: deserializeCastle(data) };
    case AccountKey.CastleGarrison:
      return { key, account: deserializeGarrisonContribution(data) };
    case AccountKey.KingRegistry:
      return { key, account: deserializeKingRegistry(data) };
    case AccountKey.CourtPosition:
      return { key, account: deserializeCourtPosition(data) };
    case AccountKey.TeamCastleReward:
      return { key, account: deserializeTeamCastleReward(data) };
    case AccountKey.DungeonRun:
      return { key, account: deserializeDungeonRun(data) };
    case AccountKey.DungeonTemplate:
      return { key, account: deserializeDungeonTemplate(data) };
    case AccountKey.DungeonLeaderboard:
      return { key, account: deserializeDungeonLeaderboard(data) };
    case AccountKey.Estate:
      return { key, account: deserializeEstate(data) };
    case AccountKey.Location:
      return { key, account: deserializeLocation(data) };
    case AccountKey.ResearchTemplate:
      return { key, account: deserializeResearchTemplate(data) };
    case AccountKey.ResearchProgress:
      return { key, account: deserializeResearchProgress(data) };
    case AccountKey.BuildingTemplate:
      return { key, account: deserializeBuildingTemplate(data) };
    case AccountKey.HeroTemplate:
      return { key, account: deserializeHeroTemplate(data) };
    default:
      throw new Error(`Unknown AccountKey: ${key}`);
  }
}

/**
 * Try to deserialize any account, returning null instead of throwing.
 */
export function tryDeserializeAnyAccount(data: Uint8Array): RoutedAccount | null {
  try {
    return deserializeAnyAccount(data);
  } catch {
    return null;
  }
}

/**
 * Read the AccountKey from raw bytes without full deserialization.
 */
export function readAccountKey(data: Uint8Array): AccountKey {
  if (data.length === 0) {
    throw new Error('Empty account data');
  }
  return data[0] as AccountKey;
}
