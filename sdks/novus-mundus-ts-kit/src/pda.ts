/*
 * PDA Derivation Functions
 *
 * All Program Derived Address derivation functions for Novus Mundus.
 *
 * Derivation is async — it goes through `@solana/kit`'s `getProgramDerivedAddress`,
 * which hashes via SubtleCrypto. Every `derive*Pda` returns `Promise<[Address, bump]>`.
*/

import {
  type Address,
  type ReadonlyUint8Array,
  getProgramDerivedAddress,
  getU8Encoder,
  getU16Encoder,
  getU32Encoder,
  getI32Encoder,
  getU64Encoder,
  Endian,
} from '@solana/kit';
import { sha256 } from '@noble/hashes/sha2.js';
import { addressBytes } from './crypto';
import {
  PROGRAM_ID,
  SEEDS,
  ALT_NAME_SERVICE_PROGRAM_ID,
  TLD_HOUSE_PROGRAM_ID,
} from './program';

// Little-endian seed encoders (kit codecs — Solana is little-endian)

const LE = { endian: Endian.Little } as const;
const u8e = getU8Encoder();
const u16e = getU16Encoder(LE);
const u32e = getU32Encoder(LE);
const i32e = getI32Encoder(LE);
const u64e = getU64Encoder(LE);

const utf8 = new TextEncoder();
const u8 = (v: number) => u8e.encode(v);
const u16le = (v: number) => u16e.encode(v);
const u32le = (v: number) => u32e.encode(v);
const i32le = (v: number) => i32e.encode(v);
const u64le = (v: number | bigint) => u64e.encode(BigInt(v));

type Seed = Uint8Array | ReadonlyUint8Array | string;

// Derive a PDA + bump for the given program and seeds.
async function pda(programAddress: Address, seeds: Seed[]): Promise<[Address, number]> {
  const [addr, bump] = await getProgramDerivedAddress({ programAddress, seeds });
  return [addr, bump];
}

// Core Account PDAs

// Derive GameEngine PDA for a specific kingdom
export function deriveGameEnginePda(kingdomId: number): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.GAME_ENGINE, u16le(kingdomId)]);
}

// Derive NOVI Mint PDA
export function deriveNoviMintPda(): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.NOVI_MINT]);
}

// Derive PlayerAccount PDA from game engine and owner wallet
export function derivePlayerPda(gameEngine: Address, owner: Address): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.PLAYER, addressBytes(gameEngine), addressBytes(owner)]);
}

// Derive User PDA from wallet
export function deriveUserPda(wallet: Address): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.USER, addressBytes(wallet)]);
}

// Derive City PDA from game engine and city ID
export function deriveCityPda(gameEngine: Address, cityId: number): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.CITY, addressBytes(gameEngine), u16le(cityId)]);
}

// Team System PDAs

// Derive Team PDA from game engine and team ID
export function deriveTeamPda(gameEngine: Address, teamId: bigint | number): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.TEAM, addressBytes(gameEngine), u64le(teamId)]);
}

// Derive Team Member Slot PDA
export function deriveTeamSlotPda(team: Address, slotIndex: number): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.TEAM_SLOT, addressBytes(team), u16le(slotIndex)]);
}

// Derive Team Invite PDA
export function deriveTeamInvitePda(team: Address, invitee: Address): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.TEAM_INVITE, addressBytes(team), addressBytes(invitee)]);
}

// Derive Treasury Request PDA
export function deriveTreasuryRequestPda(team: Address, requester: Address): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.TREASURY_REQUEST, addressBytes(team), addressBytes(requester)]);
}

// Rally System PDAs

// Derive Rally PDA
export function deriveRallyPda(
  gameEngine: Address,
  creator: Address,
  rallyId: number | bigint
): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.RALLY, addressBytes(gameEngine), addressBytes(creator), u64le(rallyId)]);
}

// Derive Rally Participant PDA
export function deriveRallyParticipantPda(
  gameEngine: Address,
  rallyCreator: Address,
  rallyId: number | bigint,
  participant: Address
): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [
    SEEDS.RALLY_PARTICIPANT,
    addressBytes(gameEngine),
    addressBytes(rallyCreator),
    u64le(rallyId),
    addressBytes(participant),
  ]);
}

// Reinforcement System PDAs

// Derive Reinforcement PDA (player-to-player)
export function deriveReinforcementPda(
  gameEngine: Address,
  sender: Address,
  receiver: Address
): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [
    SEEDS.REINFORCEMENT,
    addressBytes(gameEngine),
    addressBytes(sender),
    addressBytes(receiver),
  ]);
}

// Derive Garrison Reinforcement PDA (player-to-castle)
export function deriveGarrisonReinforcementPda(
  gameEngine: Address,
  sender: Address,
  castle: Address
): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [
    SEEDS.GARRISON,
    addressBytes(gameEngine),
    addressBytes(sender),
    addressBytes(castle),
  ]);
}

// Derive Garrison Contribution PDA
export function deriveGarrisonPda(castle: Address, player: Address): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.GARRISON, addressBytes(castle), addressBytes(player)]);
}

// Location PDAs

// Derive Location PDA from game engine, city and grid coordinates
export function deriveLocationPda(
  gameEngine: Address,
  cityId: number,
  gridLat: number,
  gridLong: number
): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [
    SEEDS.LOCATION,
    addressBytes(gameEngine),
    u16le(cityId),
    i32le(gridLat),
    i32le(gridLong),
  ]);
}

// Encounter & Loot PDAs

// Derive Encounter PDA
export function deriveEncounterPda(
  gameEngine: Address,
  cityId: number,
  encounterId: bigint | number
): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.ENCOUNTER, addressBytes(gameEngine), u16le(cityId), u64le(encounterId)]);
}

// Derive Loot PDA: [b"loot", player_pda, loot_id_le]
export function deriveLootPda(playerPda: Address, lootId: number | bigint): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.LOOT, addressBytes(playerPda), u64le(lootId)]);
}

// Event System PDAs

// Derive Event PDA
export function deriveEventPda(gameEngine: Address, eventId: bigint | number): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.EVENT, addressBytes(gameEngine), u64le(eventId)]);
}

// Derive Event Participation PDA
export function deriveEventParticipationPda(
  gameEngine: Address,
  eventId: bigint | number,
  playerOwner: Address
): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [
    SEEDS.EVENT_PARTICIPATION,
    addressBytes(gameEngine),
    u64le(eventId),
    addressBytes(playerOwner),
  ]);
}

// Progression System PDAs

// Derive Progression PDA
export function deriveProgressionPda(player: Address): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.PROGRESSION, addressBytes(player)]);
}

// Research System PDAs

// Derive Research Template PDA
export function deriveResearchTemplatePda(templateId: number): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.RESEARCH_TEMPLATE, u8(templateId)]);
}

// Derive Research Progress PDA
export function deriveResearchPda(player: Address): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.RESEARCH, addressBytes(player)]);
}

// Hero System PDAs

// Derive Hero Template PDA
export function deriveHeroTemplatePda(templateId: number): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.HERO_TEMPLATE, u16le(templateId)]);
}

// Derive Hero Collection PDA
export function deriveHeroCollectionPda(): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.HERO_COLLECTION]);
}

// Derive Hero Mint Receipt PDA (existence = player already minted this template)
export function deriveHeroMintReceiptPda(
  playerPda: Address,
  templateId: number
): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.HERO_MINT_RECEIPT, addressBytes(playerPda), u16le(templateId)]);
}

// Shop System PDAs

// Derive Shop Config PDA
export function deriveShopConfigPda(gameEngine: Address): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.SHOP_CONFIG, addressBytes(gameEngine)]);
}

// Derive Shop Item PDA
export function deriveShopItemPda(gameEngine: Address, itemId: number): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.SHOP_ITEM, addressBytes(gameEngine), u32le(itemId)]);
}

// Derive Bundle PDA
export function deriveBundlePda(gameEngine: Address, bundleId: number): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.BUNDLE, addressBytes(gameEngine), u32le(bundleId)]);
}

// Derive Daily Deal PDA
export function deriveDailyDealPda(gameEngine: Address, slotIndex: number): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.DAILY_DEAL, addressBytes(gameEngine), u8(slotIndex)]);
}

// Derive Flash Sale PDA
export function deriveFlashSalePda(gameEngine: Address, saleId: bigint | number): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.FLASH_SALE, addressBytes(gameEngine), u64le(saleId)]);
}

// Derive Weekly Sale PDA
export function deriveWeeklySalePda(
  gameEngine: Address,
  weekNumber: bigint | number
): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.WEEKLY_SALE, addressBytes(gameEngine), u64le(weekNumber)]);
}

// Derive Seasonal Sale PDA
export function deriveSeasonalSalePda(gameEngine: Address, event: Address): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.SEASONAL_SALE, addressBytes(gameEngine), addressBytes(event)]);
}

// Derive DAO Promotion PDA
export function deriveDaoPromotionPda(
  gameEngine: Address,
  proposalId: bigint | number
): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.DAO_PROMOTION, addressBytes(gameEngine), u64le(proposalId)]);
}

// Derive Player Purchase PDA
export function derivePlayerPurchasePda(player: Address, itemId: number): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.PLAYER_PURCHASE, addressBytes(player), u32le(itemId)]);
}

/*
 * Build a reverse lookup (PlayerPurchase PDA base58 -> itemId) for a wallet,
 * covering item ids 0..maxItemId. PlayerPurchase accounts store no itemId, so
 * this map is how a fetched account is matched back to its item.
 */
export async function derivePlayerPurchaseIndex(
  wallet: Address,
  maxItemId: number = 200
): Promise<Map<string, number>> {
  const entries = await Promise.all(
    Array.from({ length: maxItemId }, async (_, i): Promise<[string, number]> => {
      const [addr] = await derivePlayerPurchasePda(wallet, i);
      return [addr, i];
    })
  );
  return new Map(entries);
}

// Derive Inventory PDA
export function deriveInventoryPda(player: Address): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.INVENTORY, addressBytes(player)]);
}

// Derive Allowed Token PDA
export function deriveAllowedTokenPda(
  gameEngine: Address,
  tokenMint: Address
): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.ALLOWED_TOKEN, addressBytes(gameEngine), addressBytes(tokenMint)]);
}

// Derive the program-owned Switchboard oracle-quote PDA, keyed by queue.
// Layout on-chain: ["oracle_quote", switchboard_queue].
export function deriveOracleQuotePda(switchboardQueue: Address): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.ORACLE_QUOTE, addressBytes(switchboardQueue)]);
}

// Estate System PDAs

// Derive Estate PDA (scoped to player PDA)
export function deriveEstatePda(playerPda: Address): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.ESTATE, addressBytes(playerPda)]);
}

// Derive Crafted Equipment PDA
export function deriveCraftedEquipmentPda(owner: Address): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.CRAFTED_EQUIPMENT, addressBytes(owner)]);
}

// Derive Building Template PDA (one per building type)
export function deriveBuildingTemplatePda(buildingType: number): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.BUILDING_TEMPLATE, u8(buildingType)]);
}

// Expedition System PDAs

// Derive Expedition PDA for a player
export function deriveExpeditionPda(owner: Address): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.EXPEDITION, addressBytes(owner)]);
}

// Arena System PDAs

// Derive Arena Season PDA
export function deriveArenaSeasonPda(gameEngine: Address, seasonId: number): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.ARENA_SEASON, addressBytes(gameEngine), u32le(seasonId)]);
}

// Derive Arena Participant PDA
export function deriveArenaParticipantPda(
  gameEngine: Address,
  seasonId: number,
  player: Address
): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [
    SEEDS.ARENA_PARTICIPANT,
    addressBytes(gameEngine),
    u32le(seasonId),
    addressBytes(player),
  ]);
}

// Derive Arena Loadout PDA (per-player, kingdom-scoped)
export function deriveArenaLoadoutPda(gameEngine: Address, player: Address): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.ARENA_LOADOUT, addressBytes(gameEngine), addressBytes(player)]);
}

// Dungeon System PDAs

// Derive Dungeon Template PDA
export function deriveDungeonTemplatePda(templateId: number): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.DUNGEON_TEMPLATE, u16le(templateId)]);
}

// Derive Dungeon Run PDA
export function deriveDungeonRunPda(player: Address): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.DUNGEON_RUN, addressBytes(player)]);
}

// Derive Dungeon Leaderboard PDA
export function deriveDungeonLeaderboardPda(
  gameEngine: Address,
  dungeonId: number,
  weekNumber: number
): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [
    SEEDS.DUNGEON_LEADERBOARD,
    addressBytes(gameEngine),
    u16le(dungeonId),
    u16le(weekNumber),
  ]);
}

// Castle System PDAs

// Derive Castle PDA from game engine, city ID and castle ID
export function deriveCastlePda(
  gameEngine: Address,
  cityId: number,
  castleId: number
): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.CASTLE, addressBytes(gameEngine), u16le(cityId), u16le(castleId)]);
}

// Derive Court Position PDA
export function deriveCourtPda(castle: Address, position: number): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.COURT, addressBytes(castle), u8(position)]);
}

// Derive King Registry PDA
export function deriveKingRegistryPda(king: Address): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.KING_REGISTRY, addressBytes(king)]);
}

// Derive Team Castle Reward PDA
export function deriveTeamCastleRewardPda(castle: Address, team: Address): Promise<[Address, number]> {
  return pda(PROGRAM_ID, [SEEDS.TEAM_CASTLE_REWARD, addressBytes(castle), addressBytes(team)]);
}

// Name Service PDAs (ANS / TLD House)

// Hash prefix for ALT Name Service
const ANS_HASH_PREFIX = 'ALT Name Service';

// Null pubkey (32 zero bytes) used as a seed by the name service
const NULL_ADDRESS_BYTES = new Uint8Array(32);

// Derive ANS name account PDA (forward lookup)
export function deriveNameAccountPda(
  domainName: string,
  nameParent: Address
): Promise<[Address, number]> {
  const hashedName = sha256(utf8.encode(ANS_HASH_PREFIX + domainName));
  return pda(ALT_NAME_SERVICE_PROGRAM_ID, [hashedName, NULL_ADDRESS_BYTES, addressBytes(nameParent)]);
}

// Derive ANS reverse name account PDA
export function deriveReverseNameAccountPda(
  nameAccount: Address,
  tldHouse: Address
): Promise<[Address, number]> {
  const hashedReverse = sha256(utf8.encode(ANS_HASH_PREFIX + nameAccount));
  return pda(ALT_NAME_SERVICE_PROGRAM_ID, [hashedReverse, addressBytes(tldHouse), NULL_ADDRESS_BYTES]);
}

// Derive TLD House MainDomain PDA
export function deriveMainDomainPda(owner: Address): Promise<[Address, number]> {
  return pda(TLD_HOUSE_PROGRAM_ID, ['main_domain', addressBytes(owner)]);
}

// Derive TLD State PDA
export function deriveTldStatePda(): Promise<[Address, number]> {
  return pda(TLD_HOUSE_PROGRAM_ID, ['tld_pda']);
}

// Derive TLD House PDA for a specific TLD
export function deriveTldHousePda(tld: string): Promise<[Address, number]> {
  return pda(TLD_HOUSE_PROGRAM_ID, ['tld_house', tld.toLowerCase()]);
}

// Helper: Hash domain name for ANS

// Get hashed name bytes for ANS operations
export function getHashedName(domainName: string): Uint8Array {
  return sha256(utf8.encode(ANS_HASH_PREFIX + domainName));
}
