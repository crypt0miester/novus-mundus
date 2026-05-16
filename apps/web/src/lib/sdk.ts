/**
 * Centralized SDK re-exports for the web app.
 *
 * All SDK imports should go through this file so we have one place
 * to manage the dependency and maintain proper TypeScript types.
 *
 * Client, PDAs, and parsers keep their real SDK types.
 * Instruction builders are widened to flexible signatures so pages
 * can pass ad-hoc account shapes without strict interface matching.
 */
import type { TransactionInstruction } from "@solana/web3.js";

// ─── Direct re-exports (real types) ──────────────────────────

// Client
export { NovusMundusClient } from "novus-mundus-sdk";

// Account discriminator + subscription manager
export { GameSubscriptionManager } from "novus-mundus-sdk";
export { deserializeAnyAccount, tryDeserializeAnyAccount, readAccountKey } from "novus-mundus-sdk";

// PDA derivation
export {
  derivePlayerPda,
  deriveUserPda,
  deriveCityPda,
  deriveGameEnginePda,
  deriveCastlePda,
  deriveGarrisonPda,
  deriveCourtPda,
  deriveTeamPda,
  deriveTeamSlotPda,
  deriveTeamInvitePda,
  deriveRallyPda,
  deriveReinforcementPda,
  deriveEncounterPda,
  deriveLootPda,
  deriveEstatePda,
  deriveCraftedEquipmentPda,
  deriveExpeditionPda,
  deriveArenaSeasonPda,
  deriveArenaParticipantPda,
  deriveArenaLoadoutPda,
  deriveDungeonTemplatePda,
  deriveDungeonRunPda,
  deriveResearchPda,
  deriveResearchTemplatePda,
  deriveHeroTemplatePda,
  deriveShopConfigPda,
  deriveShopItemPda,
  deriveBundlePda,
  deriveFlashSalePda,
  derivePlayerPurchasePda,
  deriveLocationPda,
  deriveTreasuryRequestPda,
  deriveHeroMintReceiptPda,
  deriveRallyParticipantPda,
  deriveEventPda,
  deriveEventParticipationPda,
} from "novus-mundus-sdk";

// Event state parsers, helpers, types & enums
export { parseEvent, parseEventParticipation, deserializeEvent, deserializeEventParticipation } from "novus-mundus-sdk";
export { isEventActive, isEventFinalized, getEventLeaderboard, findPlayerRank } from "novus-mundus-sdk";
export { EventStatus, EventPrizeType, EVENT_ACCOUNT_SIZE, EVENT_PARTICIPATION_SIZE } from "novus-mundus-sdk";
export type { EventAccount, EventParticipation, EventLeaderboardEntry } from "novus-mundus-sdk";

// Token ATA helpers (for SPLToken prize claims)
export { getAssociatedTokenAddressSync, getAssociatedTokenAddressSyncForPda } from "novus-mundus-sdk";

// Calculators
export { toGrid } from "novus-mundus-sdk";

// Enums & helpers
export { SubscriptionTier, CityType, TeamMemberRank } from "novus-mundus-sdk";
export { TeamSettings, isTeamPublic, isTeamActive, isTeamFull } from "novus-mundus-sdk";
export { hasTeam } from "novus-mundus-sdk";

// State parsers & helpers
export { parseCastle, parseRally, parseDungeonRun, parseEstate } from "novus-mundus-sdk";
export { parseCourtPosition, parseGarrisonContribution, parseReinforcement } from "novus-mundus-sdk";
export { parseTreasuryRequest, parseTeamInvite } from "novus-mundus-sdk";
export type { CourtPositionAccount, GarrisonContributionAccount, ReinforcementAccount, RallyAccount } from "novus-mundus-sdk";
export type { TreasuryRequest, TeamInviteAccount } from "novus-mundus-sdk";
export { parseResearchTemplate, parseResearchProgress, deserializeResearchTemplate, deserializeResearchProgress } from "novus-mundus-sdk";
export { isResearching, isResearchComplete, getResearchLevel, isResearchAscended, checkResearchPrerequisites } from "novus-mundus-sdk";
export type { ResearchTemplateAccount, ResearchProgressAccount } from "novus-mundus-sdk";
export { parseTeam, parseTeamMemberSlot, parsePlayer } from "novus-mundus-sdk";
export { isSeasonActive, getExpeditionEndTime, getExpeditionDurationSeconds } from "novus-mundus-sdk";
export { isNullPubkey, hasCustomName } from "novus-mundus-sdk";
export { isItemAvailable, isFlashSaleActive, getItemTypeInfo, getShopItemName } from "novus-mundus-sdk";
export { ShopItemCategory, ShopItemRarity, FlashSaleStatus } from "novus-mundus-sdk";
export { isHeroMeditating, isTraveling, getTotalDefensiveUnits, getTotalOperativeUnits } from "novus-mundus-sdk";
export { parseAssetV1 } from "novus-mundus-sdk";
export type { ParsedAssetV1 } from "novus-mundus-sdk";
export { deserializeHeroTemplate, canMintHero, getActiveBuffs } from "novus-mundus-sdk";
export type { HeroTemplateAccount, HeroBuffConfig } from "novus-mundus-sdk";
export { AccountKey } from "novus-mundus-sdk";
export { PROGRAM_ID as NOVUS_PROGRAM_ID } from "novus-mundus-sdk";
export { ExtensionFlags, hasExtension } from "novus-mundus-sdk";
export { findBuilding, hasBuildingAtLevel, BuildingStatus } from "novus-mundus-sdk";
export { getEffectiveTier, isSubscriptionActive } from "novus-mundus-sdk";
export type { DungeonRunAccount } from "novus-mundus-sdk";
export type { TeamAccount, TeamMemberSlot } from "novus-mundus-sdk";
export type { PlayerAccount } from "novus-mundus-sdk";
export type { SubscriptionTierConfig } from "novus-mundus-sdk";
export { RESERVED_NOVI_VESTING_PERIOD } from "novus-mundus-sdk";

// ─── Events ─────────────────────────────────────────────────
export { parseEventsFromLogs } from "novus-mundus-sdk";
export type { NovusMundusEvent } from "novus-mundus-sdk";

// Subscriptions (log sub for real-time events)
export { subscribeToGameLogs, createMultiSubscription } from "novus-mundus-sdk";

// ─── Error parsing ──────────────────────────────────────────
export { parseErrorMessage, parseTransactionError, isGameError, getErrorCategory, GameError } from "novus-mundus-sdk";

// ─── Calculators ────────────────────────────────────────────

// Time-of-day system
export {
  calculateLocalTime, getTimeOfDay, getCurrentTimeOfDay,
  isGoldenHour, isNight, isDay, isPeakDay,
  getActivityMultiplier, getActivityMultiplierBps, applyTimeMultiplier,
  getTimeOfDayName, getTimeRange, getSecondsUntilNextPeriod,
} from "novus-mundus-sdk";

// Costs
export {
  calculateHiringCost, calculateTotalHiringCost, calculatePurchaseCost,
  calculateUpgradeCost, calculateCumulativeUpgradeCost, calculateResearchCost,
  calculatePartialSpeedupCost, calculateSpeedupCost, calculateTimeReduced,
  calculateAttackTax, calculateShopPrice, formatCostWithBonus, getCostTimeBonusDescription,
  calculateRecoveryCost,
} from "novus-mundus-sdk";

// Combat
export {
  calculateDamageOutput, inflictDamage,
  calculatePower, calculateDefensivePower, calculateOperativePower,
} from "novus-mundus-sdk";

// Travel
export {
  calculateDistance, calculateDistanceMeters,
  calculateTravelTime, calculateTravelTimeBetween,
  calculateIntercityTravelTime, calculateIntracityTravelTime,
  calculateTeleportCost, applyStablesTravelReduction,
  isValidLatitude, isValidLongitude,
  fixedPointToFloat,
} from "novus-mundus-sdk";

// Stamina
export {
  calculateStaminaRegeneration, calculateSimpleStaminaRegen,
  hasEnoughStamina, getEncounterStaminaCost, consumeStamina,
  getMaxStaminaForTier, calculateMaxStamina,
  timeUntilFullStamina, timeUntilEncounterReady,
} from "novus-mundus-sdk";

// Progression
export {
  xpRequiredForLevel, xpToNextLevel, cumulativeXpForLevel,
  levelFromXp, simulateGrantXp,
  calculateXpWithTimeBonus,
  levelProgressPercent, xpRemainingToNextLevel, formatLevelProgress,
  actionsToLevelUp, estimateXpPerHour,
} from "novus-mundus-sdk";

// Resources
export {
  calculateNetworth, calculateNetworthBreakdown,
  calculateCollectionWithTimeBonus,
  calculateProduceConsumption, calculateProduceDeficit,
  calculateEstateProduction, calculateStorageCapacity,
  formatResourceAmount, formatCoveragePercent,
} from "novus-mundus-sdk";

// NOVI purchase
export {
  calculateNoviStreak, getStreakBonusBps,
  calculateTotalBonusBps, calculateBonusAmount,
  getDailyCap, wouldExceedDailyCap, getRemainingDailyAllowance,
  calculateNoviPurchasePreview,
  formatNoviAmount, formatLamportsAsSol,
  NOVI_PACKAGE_TIERS,
} from "novus-mundus-sdk";

// Rewards
export {
  calculateFragmentAmount, calculateGemAmount,
  calculateXpReward, calculateDailyRewards,
} from "novus-mundus-sdk";

// Basis point helpers
export { applyBps, applyBpsBonus, applyBpsPenalty } from "novus-mundus-sdk";

// ─── Validation ─────────────────────────────────────────────

// Common
export { valid, invalid, combine, allValid, getAllErrors } from "novus-mundus-sdk";
export { validatePositive, validateNonNegative, validateRange, validateMinimum, validateMaximum } from "novus-mundus-sdk";
export { validateNonEmpty, validateStringLength, validateName } from "novus-mundus-sdk";

// Player validation
export {
  validateNotTraveling, validateCanAct, validateCanCombat, validateCanTravel,
  validateHasCash, validateHasVaultCash, validateHasGems, validateHasFragments,
  validateHasStamina, validateMinLevel,
  validateTargetNotProtected, validateProtectionExpired,
  validateCanStartExpedition, validateCanJoinRally,
} from "novus-mundus-sdk";

// Economy validation
export {
  validateTransferAmount, validateCanTransferCash,
  validateHireAmount, validateCanHireUnits, validateHireableUnitType,
  validateCanAffordPurchase, validatePurchaseQuantity,
  validateHasCraftingMaterials,
} from "novus-mundus-sdk";

// Team validation
export {
  validateTeamName, validateTeamActive, validateTeamPublic, validateTeamHasSpace,
  validateCanJoinTeam, validateCanCreateTeam,
  validateTreasuryBalance,
  validateCanKickMember,
} from "novus-mundus-sdk";

// ─── Constants ──────────────────────────────────────────────
export {
  SECONDS_PER_DAY, SECONDS_PER_HOUR,
  MAX_TEAM_MEMBERS, MAX_RALLY_PARTICIPANTS, MIN_RALLY_PARTICIPANTS,
  ENCOUNTER_STAMINA_COSTS, STAMINA_REGEN_INTERVAL,
  MAX_STAMINA_BY_TIER, MAX_LEVEL,
  ATTACK_SUCCESS_THRESHOLD, MAX_STEAL_PERCENTAGE,
  UNIT_LOSS_PERCENTAGE_WINNER, UNIT_LOSS_PERCENTAGE_LOSER,
  ARENA_MAX_DAILY_BATTLES, ARENA_MIN_BATTLES_FOR_DAILY_REWARD,
  MAX_TEAM_NAME_LENGTH,
} from "novus-mundus-sdk";

// ─── Widened instruction builders ────────────────────────────
// Pages pass ad-hoc account objects that don't match the SDK's
// strict per-instruction interfaces. Cast to a flexible signature
// so pages compile as-is.

type FlexIxBuilder = (
  accounts: Record<string, any>,
  params?: Record<string, any>,
) => TransactionInstruction;

// Initialization
import { createInitUserInstruction as _initUser } from "novus-mundus-sdk";
import { createInitPlayerInstruction as _initPlayer } from "novus-mundus-sdk";
export const createInitUserInstruction = _initUser as unknown as FlexIxBuilder;
export const createInitPlayerInstruction = _initPlayer as unknown as FlexIxBuilder;

// Economy
import { createHireUnitsInstruction as _hireUnits } from "novus-mundus-sdk";
import { createCollectResourcesInstruction as _collectResources } from "novus-mundus-sdk";
import { createPurchaseEquipmentInstruction as _purchaseEquipment } from "novus-mundus-sdk";
import { createPurchaseStaminaInstruction as _purchaseStamina } from "novus-mundus-sdk";
import { createTransferCashInstruction as _transferCash } from "novus-mundus-sdk";
import { createUpdateLockedNoviInstruction as _updateLockedNovi } from "novus-mundus-sdk";
import { createVaultTransferInstruction as _vaultTransfer } from "novus-mundus-sdk";
export const createHireUnitsInstruction = _hireUnits as unknown as FlexIxBuilder;
export const createCollectResourcesInstruction = _collectResources as unknown as FlexIxBuilder;
export const createPurchaseEquipmentInstruction = _purchaseEquipment as unknown as FlexIxBuilder;
export const createPurchaseStaminaInstruction = _purchaseStamina as unknown as FlexIxBuilder;
export const createTransferCashInstruction = _transferCash as unknown as FlexIxBuilder;
export const createUpdateLockedNoviInstruction = _updateLockedNovi as unknown as FlexIxBuilder;
export const createVaultTransferInstruction = _vaultTransfer as unknown as FlexIxBuilder;

// Combat
import { createAttackPlayerInstruction as _attackPlayer } from "novus-mundus-sdk";
import { createAttackEncounterInstruction as _attackEncounter } from "novus-mundus-sdk";
export const createAttackPlayerInstruction = _attackPlayer as unknown as FlexIxBuilder;
export const createAttackEncounterInstruction = _attackEncounter as unknown as FlexIxBuilder;

// Travel
import { createIntercityStartInstruction as _intercityStart } from "novus-mundus-sdk";
import { createIntercityCompleteInstruction as _intercityComplete } from "novus-mundus-sdk";
import { createIntercityCancelInstruction as _intercityCancel } from "novus-mundus-sdk";
import { createIntercityTeleportInstruction as _intercityTeleport } from "novus-mundus-sdk";
import { createIntracityStartInstruction as _intracityStart } from "novus-mundus-sdk";
import { createIntracityCompleteInstruction as _intracityComplete } from "novus-mundus-sdk";
import { createIntracityCancelInstruction as _intracityCancel } from "novus-mundus-sdk";
import { createTravelSpeedupInstruction as _travelSpeedup } from "novus-mundus-sdk";
export const createIntercityStartInstruction = _intercityStart as unknown as FlexIxBuilder;
export const createIntercityCompleteInstruction = _intercityComplete as unknown as FlexIxBuilder;
export const createIntercityCancelInstruction = _intercityCancel as unknown as FlexIxBuilder;
export const createIntercityTeleportInstruction = _intercityTeleport as unknown as FlexIxBuilder;
export const createIntracityStartInstruction = _intracityStart as unknown as FlexIxBuilder;
export const createIntracityCompleteInstruction = _intracityComplete as unknown as FlexIxBuilder;
export const createIntracityCancelInstruction = _intracityCancel as unknown as FlexIxBuilder;
export const createTravelSpeedupInstruction = _travelSpeedup as unknown as FlexIxBuilder;

// Estate
import { createCreateEstateInstruction as _createEstate } from "novus-mundus-sdk";
import { createBuildBuildingInstruction as _buildBuilding } from "novus-mundus-sdk";
import { createUpgradeBuildingInstruction as _upgradeBuilding } from "novus-mundus-sdk";
import { createDailyActivityInstruction as _dailyActivity } from "novus-mundus-sdk";
import { createBuyPlotInstruction as _buyPlot } from "novus-mundus-sdk";
import { createBuildingSpeedupInstruction as _buildingSpeedup } from "novus-mundus-sdk";
import { createCompleteBuildingInstruction as _completeBuilding } from "novus-mundus-sdk";
import { createRecoverTroopsInstruction as _recoverTroops } from "novus-mundus-sdk";
import { createConvertMaterialsInstruction as _convertMaterials } from "novus-mundus-sdk";
export const createCreateEstateInstruction = _createEstate as unknown as FlexIxBuilder;
export const createBuildBuildingInstruction = _buildBuilding as unknown as FlexIxBuilder;
export const createUpgradeBuildingInstruction = _upgradeBuilding as unknown as FlexIxBuilder;
export const createDailyActivityInstruction = _dailyActivity as unknown as FlexIxBuilder;
export const createBuyPlotInstruction = _buyPlot as unknown as FlexIxBuilder;
export const createBuildingSpeedupInstruction = _buildingSpeedup as unknown as FlexIxBuilder;
export const createCompleteBuildingInstruction = _completeBuilding as unknown as FlexIxBuilder;
export const createRecoverTroopsInstruction = _recoverTroops as unknown as FlexIxBuilder;
export const createConvertMaterialsInstruction = _convertMaterials as unknown as FlexIxBuilder;

// Progression
import { createClaimDailyRewardInstruction as _claimDailyReward } from "novus-mundus-sdk";
export const createClaimDailyRewardInstruction = _claimDailyReward as unknown as FlexIxBuilder;

// Dungeon
import { createEnterDungeonInstruction as _enterDungeon } from "novus-mundus-sdk";
import { createAttackInstruction as _dungeonAttack } from "novus-mundus-sdk";
import { createFleeInstruction as _flee } from "novus-mundus-sdk";
import { createClaimDungeonInstruction as _claimDungeon } from "novus-mundus-sdk";
export const createEnterDungeonInstruction = _enterDungeon as unknown as FlexIxBuilder;
export const createDungeonAttackInstruction = _dungeonAttack as unknown as FlexIxBuilder;
export const createFleeInstruction = _flee as unknown as FlexIxBuilder;
export const createClaimDungeonInstruction = _claimDungeon as unknown as FlexIxBuilder;

// Expedition
import { createExpeditionStartInstruction as _expeditionStart } from "novus-mundus-sdk";
import { createExpeditionClaimInstruction as _expeditionClaim } from "novus-mundus-sdk";
import { createExpeditionAbortInstruction as _expeditionAbort } from "novus-mundus-sdk";
import { createExpeditionSpeedupInstruction as _expeditionSpeedup } from "novus-mundus-sdk";
export const createExpeditionStartInstruction = _expeditionStart as unknown as FlexIxBuilder;
export const createExpeditionClaimInstruction = _expeditionClaim as unknown as FlexIxBuilder;
export const createExpeditionAbortInstruction = _expeditionAbort as unknown as FlexIxBuilder;
export const createExpeditionSpeedupInstruction = _expeditionSpeedup as unknown as FlexIxBuilder;

// Arena
import { createJoinSeasonInstruction as _joinSeason } from "novus-mundus-sdk";
import { createChallengePlayerInstruction as _challengePlayer } from "novus-mundus-sdk";
import { createUpdateLoadoutInstruction as _updateLoadout } from "novus-mundus-sdk";
import { createClaimArenaDailyRewardInstruction as _claimArenaDailyReward } from "novus-mundus-sdk";
import { createClaimMasterRewardInstruction as _claimMasterReward } from "novus-mundus-sdk";
export const createJoinSeasonInstruction = _joinSeason as unknown as FlexIxBuilder;
export const createChallengePlayerInstruction = _challengePlayer as unknown as FlexIxBuilder;
export const createUpdateLoadoutInstruction = _updateLoadout as unknown as FlexIxBuilder;
export const createClaimArenaDailyRewardInstruction = _claimArenaDailyReward as unknown as FlexIxBuilder;
export const createClaimMasterRewardInstruction = _claimMasterReward as unknown as FlexIxBuilder;

// Castle
import { createClaimVacantCastleInstruction as _claimVacantCastle } from "novus-mundus-sdk";
import { createJoinGarrisonInstruction as _joinGarrison } from "novus-mundus-sdk";
import { createLeaveGarrisonInstruction as _leaveGarrison } from "novus-mundus-sdk";
import { createClaimCastleRewardsInstruction as _claimCastleRewards } from "novus-mundus-sdk";
import { createAppointCourtInstruction as _appointCourt } from "novus-mundus-sdk";
import { createDismissCourtInstruction as _dismissCourt } from "novus-mundus-sdk";
import { createResignCourtInstruction as _resignCourt } from "novus-mundus-sdk";
import { createInitiateUpgradeInstruction as _initiateUpgrade } from "novus-mundus-sdk";
import { createCancelUpgradeInstruction as _cancelUpgrade } from "novus-mundus-sdk";
import { createCompleteUpgradeInstruction as _completeUpgrade } from "novus-mundus-sdk";
import { createRelieveGarrisonInstruction as _relieveGarrison } from "novus-mundus-sdk";
import { createClaimGarrisonLootInstruction as _claimGarrisonLoot } from "novus-mundus-sdk";
import { createAttackCastleInstruction as _attackCastle } from "novus-mundus-sdk";
export const createClaimVacantCastleInstruction = _claimVacantCastle as unknown as FlexIxBuilder;
export const createJoinGarrisonInstruction = _joinGarrison as unknown as FlexIxBuilder;
export const createLeaveGarrisonInstruction = _leaveGarrison as unknown as FlexIxBuilder;
export const createClaimCastleRewardsInstruction = _claimCastleRewards as unknown as FlexIxBuilder;
export const createAppointCourtInstruction = _appointCourt as unknown as FlexIxBuilder;
export const createDismissCourtInstruction = _dismissCourt as unknown as FlexIxBuilder;
export const createResignCourtInstruction = _resignCourt as unknown as FlexIxBuilder;
export const createInitiateUpgradeInstruction = _initiateUpgrade as unknown as FlexIxBuilder;
export const createCancelUpgradeInstruction = _cancelUpgrade as unknown as FlexIxBuilder;
export const createCompleteUpgradeInstruction = _completeUpgrade as unknown as FlexIxBuilder;
export const createRelieveGarrisonInstruction = _relieveGarrison as unknown as FlexIxBuilder;
export const createClaimGarrisonLootInstruction = _claimGarrisonLoot as unknown as FlexIxBuilder;
export const createAttackCastleInstruction = _attackCastle as unknown as FlexIxBuilder;

// Team
import { createTeamCreateInstruction as _teamCreate } from "novus-mundus-sdk";
import { createTeamJoinInstruction as _teamJoin } from "novus-mundus-sdk";
import { createTeamLeaveInstruction as _teamLeave } from "novus-mundus-sdk";
import { createTeamDisbandInstruction as _teamDisband } from "novus-mundus-sdk";
import { createTeamInviteInstruction as _teamInvite } from "novus-mundus-sdk";
import { createTeamAcceptInviteInstruction as _teamAcceptInvite } from "novus-mundus-sdk";
import { createTeamDeclineInviteInstruction as _teamDeclineInvite } from "novus-mundus-sdk";
import { createTeamKickMemberInstruction as _teamKick } from "novus-mundus-sdk";
import { createTeamSetMotdInstruction as _teamSetMotd } from "novus-mundus-sdk";
import { createTeamDepositTreasuryInstruction as _teamDepositTreasury } from "novus-mundus-sdk";
import { createTeamWithdrawTreasuryInstruction as _teamWithdrawTreasury } from "novus-mundus-sdk";
import { createTeamCancelInviteInstruction as _teamCancelInvite } from "novus-mundus-sdk";
import { createTeamPromoteMemberInstruction as _teamPromote } from "novus-mundus-sdk";
import { createTeamDemoteMemberInstruction as _teamDemote } from "novus-mundus-sdk";
import { createTeamTransferLeadershipInstruction as _teamTransferLeadership } from "novus-mundus-sdk";
import { createTeamUpdateSettingsInstruction as _teamUpdateSettings } from "novus-mundus-sdk";
import { createTeamTreasuryRequestWithdrawInstruction as _teamTreasuryRequestWithdraw } from "novus-mundus-sdk";
import { createTeamTreasuryApproveRequestInstruction as _teamTreasuryApproveRequest } from "novus-mundus-sdk";
import { createTeamTreasuryRejectRequestInstruction as _teamTreasuryRejectRequest } from "novus-mundus-sdk";
import { createTeamTreasuryExecuteRequestInstruction as _teamTreasuryExecuteRequest } from "novus-mundus-sdk";
import { createTeamTreasuryCancelRequestInstruction as _teamTreasuryCancelRequest } from "novus-mundus-sdk";
import { createTeamUpdateTreasurySettingsInstruction as _teamUpdateTreasurySettings } from "novus-mundus-sdk";
export const createTeamCreateInstruction = _teamCreate as unknown as FlexIxBuilder;
export const createTeamJoinInstruction = _teamJoin as unknown as FlexIxBuilder;
export const createTeamLeaveInstruction = _teamLeave as unknown as FlexIxBuilder;
export const createTeamDisbandInstruction = _teamDisband as unknown as FlexIxBuilder;
export const createTeamInviteInstruction = _teamInvite as unknown as FlexIxBuilder;
export const createTeamAcceptInviteInstruction = _teamAcceptInvite as unknown as FlexIxBuilder;
export const createTeamDeclineInviteInstruction = _teamDeclineInvite as unknown as FlexIxBuilder;
export const createTeamKickMemberInstruction = _teamKick as unknown as FlexIxBuilder;
export const createTeamSetMotdInstruction = _teamSetMotd as unknown as FlexIxBuilder;
export const createTeamDepositTreasuryInstruction = _teamDepositTreasury as unknown as FlexIxBuilder;
export const createTeamWithdrawTreasuryInstruction = _teamWithdrawTreasury as unknown as FlexIxBuilder;
export const createTeamCancelInviteInstruction = _teamCancelInvite as unknown as FlexIxBuilder;
export const createTeamPromoteMemberInstruction = _teamPromote as unknown as FlexIxBuilder;
export const createTeamDemoteMemberInstruction = _teamDemote as unknown as FlexIxBuilder;
export const createTeamTransferLeadershipInstruction = _teamTransferLeadership as unknown as FlexIxBuilder;
export const createTeamUpdateSettingsInstruction = _teamUpdateSettings as unknown as FlexIxBuilder;
export const createTeamTreasuryRequestWithdrawInstruction = _teamTreasuryRequestWithdraw as unknown as FlexIxBuilder;
export const createTeamTreasuryApproveRequestInstruction = _teamTreasuryApproveRequest as unknown as FlexIxBuilder;
export const createTeamTreasuryRejectRequestInstruction = _teamTreasuryRejectRequest as unknown as FlexIxBuilder;
export const createTeamTreasuryExecuteRequestInstruction = _teamTreasuryExecuteRequest as unknown as FlexIxBuilder;
export const createTeamTreasuryCancelRequestInstruction = _teamTreasuryCancelRequest as unknown as FlexIxBuilder;
export const createTeamUpdateTreasurySettingsInstruction = _teamUpdateTreasurySettings as unknown as FlexIxBuilder;

// Rally
import { createRallyCreateInstruction as _rallyCreate } from "novus-mundus-sdk";
import { createRallyCancelInstruction as _rallyCancel } from "novus-mundus-sdk";
import { createRallyJoinInstruction as _rallyJoin } from "novus-mundus-sdk";
import { createRallySpeedupInstruction as _rallySpeedup } from "novus-mundus-sdk";
import { createRallyLeaveInstruction as _rallyLeave } from "novus-mundus-sdk";
import { createRallyExecuteInstruction as _rallyExecute } from "novus-mundus-sdk";
import { createRallyProcessReturnInstruction as _rallyProcessReturn } from "novus-mundus-sdk";
export const createRallyCreateInstruction = _rallyCreate as unknown as FlexIxBuilder;
export const createRallyCancelInstruction = _rallyCancel as unknown as FlexIxBuilder;
export const createRallyJoinInstruction = _rallyJoin as unknown as FlexIxBuilder;
export const createRallySpeedupInstruction = _rallySpeedup as unknown as FlexIxBuilder;
export const createRallyLeaveInstruction = _rallyLeave as unknown as FlexIxBuilder;
export const createRallyExecuteInstruction = _rallyExecute as unknown as FlexIxBuilder;
export const createRallyProcessReturnInstruction = _rallyProcessReturn as unknown as FlexIxBuilder;
export { RallySpeedupType } from "novus-mundus-sdk";

import { createRallyCloseInstruction as _rallyClose } from "novus-mundus-sdk";
export const createRallyCloseInstruction = _rallyClose as unknown as FlexIxBuilder;

// Reinforcement
import { createSendReinforcementInstruction as _sendReinforcement } from "novus-mundus-sdk";
import { createRecallReinforcementInstruction as _recallReinforcement } from "novus-mundus-sdk";
import { createProcessReturnInstruction as _processReturn } from "novus-mundus-sdk";
import { createReinforcementSpeedupInstruction as _reinforcementSpeedup } from "novus-mundus-sdk";
import { createProcessArrivalInstruction as _processArrival } from "novus-mundus-sdk";
import { createRelieveReinforcementInstruction as _relieveReinforcement } from "novus-mundus-sdk";
export const createSendReinforcementInstruction = _sendReinforcement as unknown as FlexIxBuilder;
export const createRecallReinforcementInstruction = _recallReinforcement as unknown as FlexIxBuilder;
export const createProcessReturnInstruction = _processReturn as unknown as FlexIxBuilder;
export const createReinforcementSpeedupInstruction = _reinforcementSpeedup as unknown as FlexIxBuilder;
export const createProcessArrivalInstruction = _processArrival as unknown as FlexIxBuilder;
export const createRelieveReinforcementInstruction = _relieveReinforcement as unknown as FlexIxBuilder;

// Research
import { createCreateProgressInstruction as _createProgress } from "novus-mundus-sdk";
import { createStartResearchInstruction as _startResearch } from "novus-mundus-sdk";
import { createCompleteResearchInstruction as _completeResearch } from "novus-mundus-sdk";
import { createSpeedUpResearchInstruction as _speedUpResearch } from "novus-mundus-sdk";
import { createCancelResearchInstruction as _cancelResearch } from "novus-mundus-sdk";
import { createAscendInstruction as _ascend } from "novus-mundus-sdk";
export const createCreateProgressInstruction = _createProgress as unknown as FlexIxBuilder;
export const createStartResearchInstruction = _startResearch as unknown as FlexIxBuilder;
export const createCompleteResearchInstruction = _completeResearch as unknown as FlexIxBuilder;
export const createSpeedUpResearchInstruction = _speedUpResearch as unknown as FlexIxBuilder;
export const createCancelResearchInstruction = _cancelResearch as unknown as FlexIxBuilder;
export const createAscendInstruction = _ascend as unknown as FlexIxBuilder;

// Hero
import { createMintHeroInstruction as _mintHero } from "novus-mundus-sdk";
import { createLockHeroInstruction as _lockHero } from "novus-mundus-sdk";
import { createUnlockHeroInstruction as _unlockHero } from "novus-mundus-sdk";
import { createLevelUpHeroInstruction as _levelUpHero } from "novus-mundus-sdk";
import { createBurnHeroInstruction as _burnHero } from "novus-mundus-sdk";
export const createMintHeroInstruction = _mintHero as unknown as FlexIxBuilder;
export const createLockHeroInstruction = _lockHero as unknown as FlexIxBuilder;
export const createUnlockHeroInstruction = _unlockHero as unknown as FlexIxBuilder;
export const createLevelUpHeroInstruction = _levelUpHero as unknown as FlexIxBuilder;
export const createBurnHeroInstruction = _burnHero as unknown as FlexIxBuilder;

import { createAssignDefensiveHeroInstruction as _assignDefensiveHero } from "novus-mundus-sdk";
export const createAssignDefensiveHeroInstruction = _assignDefensiveHero as unknown as FlexIxBuilder;

// Forge
import { createStartCraftInstruction as _startCraft } from "novus-mundus-sdk";
import { createStrikeInstruction as _strike } from "novus-mundus-sdk";
import { createEquipInstruction as _equip } from "novus-mundus-sdk";
import { createAbandonCraftInstruction as _abandonCraft } from "novus-mundus-sdk";
export const createStartCraftInstruction = _startCraft as unknown as FlexIxBuilder;
export const createStrikeInstruction = _strike as unknown as FlexIxBuilder;
export const createEquipInstruction = _equip as unknown as FlexIxBuilder;
export const createAbandonCraftInstruction = _abandonCraft as unknown as FlexIxBuilder;

// Sanctuary
import { createStartMeditationInstruction as _startMeditation } from "novus-mundus-sdk";
import { createClaimMeditationInstruction as _claimMeditation } from "novus-mundus-sdk";
import { createSpeedupMeditationInstruction as _speedupMeditation } from "novus-mundus-sdk";
export const createStartMeditationInstruction = _startMeditation as unknown as FlexIxBuilder;
export const createClaimMeditationInstruction = _claimMeditation as unknown as FlexIxBuilder;
export const createSpeedupMeditationInstruction = _speedupMeditation as unknown as FlexIxBuilder;

// Shop
import { createPurchaseItemInstruction as _purchaseItem } from "novus-mundus-sdk";
import { createPurchaseNoviInstruction as _purchaseNovi } from "novus-mundus-sdk";
import { createPurchaseBundleInstruction as _purchaseBundle } from "novus-mundus-sdk";
import { createPurchaseFlashSaleInstruction as _purchaseFlashSale } from "novus-mundus-sdk";
export const createPurchaseItemInstruction = _purchaseItem as unknown as FlexIxBuilder;
export const createPurchaseNoviInstruction = _purchaseNovi as unknown as FlexIxBuilder;
export const createPurchaseBundleInstruction = _purchaseBundle as unknown as FlexIxBuilder;
export const createPurchaseFlashSaleInstruction = _purchaseFlashSale as unknown as FlexIxBuilder;

// Subscription
import { createPurchaseSubscriptionInstruction as _purchaseSubscription } from "novus-mundus-sdk";
export const createPurchaseSubscriptionInstruction = _purchaseSubscription as unknown as FlexIxBuilder;

// Loot
import { createClaimLootInstruction as _claimLoot } from "novus-mundus-sdk";
export const createClaimLootInstruction = _claimLoot as unknown as FlexIxBuilder;

// Token
import { createReservedToLockedInstruction as _reservedToLocked } from "novus-mundus-sdk";
import { createWithdrawReservedInstruction as _withdrawReserved } from "novus-mundus-sdk";
export const createReservedToLockedInstruction = _reservedToLocked as unknown as FlexIxBuilder;
export const createWithdrawReservedInstruction = _withdrawReserved as unknown as FlexIxBuilder;

// Name — Player
import { createSetPlayerNameInstruction as _setName } from "novus-mundus-sdk";
import { createUpdatePlayerNameInstruction as _updateName } from "novus-mundus-sdk";
import { createRemovePlayerNameInstruction as _removeName } from "novus-mundus-sdk";
export const createSetPlayerNameInstruction = _setName as unknown as FlexIxBuilder;
export const createUpdatePlayerNameInstruction = _updateName as unknown as FlexIxBuilder;
export const createRemovePlayerNameInstruction = _removeName as unknown as FlexIxBuilder;

// Event
import { createJoinEventInstruction as _joinEvent } from "novus-mundus-sdk";
import { createFinalizeEventInstruction as _finalizeEvent } from "novus-mundus-sdk";
import { createClaimPrizeInstruction as _claimPrize } from "novus-mundus-sdk";
export const createJoinEventInstruction = _joinEvent as unknown as FlexIxBuilder;
export const createFinalizeEventInstruction = _finalizeEvent as unknown as FlexIxBuilder;
export const createClaimPrizeInstruction = _claimPrize as unknown as FlexIxBuilder;

// Name — Team
import { createSetTeamNameInstruction as _setTeamName } from "novus-mundus-sdk";
import { createUpdateTeamNameInstruction as _updateTeamName } from "novus-mundus-sdk";
import { createRemoveTeamNameInstruction as _removeTeamName } from "novus-mundus-sdk";
export const createSetTeamNameInstruction = _setTeamName as unknown as FlexIxBuilder;
export const createUpdateTeamNameInstruction = _updateTeamName as unknown as FlexIxBuilder;
export const createRemoveTeamNameInstruction = _removeTeamName as unknown as FlexIxBuilder;
